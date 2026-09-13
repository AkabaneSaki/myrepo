#!/usr/bin/env python3
"""Local scale/cost guard for D1 hot-path queries.

This intentionally measures SQLite VM work, not Cloudflare D1 billable rows.
The purpose is to catch queries whose work grows with the whole dataset before
we spend remote D1 quota. Real D1 rows_read/rows_written remains a later gate.
"""

from __future__ import annotations

import json
import sqlite3
import sys
from pathlib import Path
from typing import Any

SCHEMA_PATH = Path(__file__).resolve().parents[1] / "schema.sql"
PROGRESS_INTERVAL = 100


def project_id(index: int) -> str:
    return f"p{index:06d}"


def make_connection(size: int, profile: str, with_snapshot: bool, calls: list[dict[str, Any]]) -> sqlite3.Connection:
    conn = sqlite3.connect(":memory:")
    conn.executescript(SCHEMA_PATH.read_text(encoding="utf-8"))
    conn.execute(
        "INSERT INTO users (id, username, global_name, avatar, discriminator, guilds) VALUES (?, ?, ?, ?, ?, ?)",
        ("author", "author", "Author", "", "0", "[]"),
    )
    conn.execute(
        "INSERT INTO users (id, username, global_name, avatar, discriminator, guilds) VALUES (?, ?, ?, ?, ?, ?)",
        ("viewer", "viewer", "Viewer", "", "0", "[]"),
    )

    rows = []
    types = ["角色", "扩展", "系统核心", "事件"]
    for index in range(1, size + 1):
        ptype = types[(index - 1) % len(types)]
        visibility = 1
        if profile == "rareType":
            ptype = "事件" if index <= max(1, size // 100) else "角色"
        elif profile == "noMatch":
            ptype = "角色"
        elif profile == "manyHidden":
            visibility = 1 if index % 10 == 0 else 0
        rows.append(
            (
                project_id(index),
                f"Project {index}",
                "battle project" if index % 7 == 0 else "project",
                "author",
                "Author",
                ptype,
                visibility,
                f"2026-09-{1 + (index % 12):02d}T00:{index % 60:02d}:00.000Z",
                index * 10,
                index % 17,
            )
        )

    conn.executemany(
        """
        INSERT INTO projects (
          id, name, description, author_id, author_name, status, project_type,
          visibility, is_published, latest_approved_at, downloads_count, likes_count
        ) VALUES (?, ?, ?, ?, ?, 'approved', ?, ?, 1, ?, ?, ?)
        """,
        rows,
    )
    conn.executemany(
        "INSERT INTO project_likes (project_id, user_id) VALUES (?, ?)",
        [(project_id(index), "viewer") for index in range(1, min(size, 13) + 1)],
    )

    if with_snapshot:
        payload = json.dumps([project_id(index) for index in range(1, size + 1)], separators=(",", ":"))
        seen: set[tuple[str, int]] = set()
        for call in calls:
            sql = call["sql"].upper()
            values = call.get("values", [])
            if "FROM PROJECT_RANK_SNAPSHOTS" not in sql or "KIND = ?" not in sql or "BUCKET = ?" not in sql:
                continue
            if len(values) < 2 or values[0] not in ("discover", "rating"):
                continue
            key = (str(values[0]), int(values[1]))
            if key in seen:
                continue
            seen.add(key)
            conn.execute(
                "INSERT OR IGNORE INTO project_rank_snapshots (kind, bucket, project_ids) VALUES (?, ?, ?)",
                (key[0], key[1], payload),
            )

    conn.execute("ANALYZE")
    return conn


def rewrite_values(sql: str, values: list[Any], size: int) -> list[Any]:
    del sql  # Scale JSON parameters by their content, not by brittle SQL table/join order.
    all_ids = [project_id(index) for index in range(1, size + 1)]
    rewritten = list(values)

    for index, value in enumerate(rewritten):
        if not isinstance(value, str) or not value.lstrip().startswith("["):
            continue
        try:
            parsed = json.loads(value)
        except json.JSONDecodeError:
            continue
        if not isinstance(parsed, list) or not parsed or not all(isinstance(item, str) for item in parsed):
            continue
        if not all(item.startswith("p") for item in parsed):
            continue
        if len(parsed) > 14:
            rewritten[index] = json.dumps(all_ids, separators=(",", ":"))
    return rewritten


def explain_plan(conn: sqlite3.Connection, sql: str, values: list[Any]) -> list[str]:
    stripped = sql.lstrip().upper()
    if not (stripped.startswith("SELECT") or stripped.startswith("WITH")):
        return []
    try:
        return [str(row[3]) for row in conn.execute("EXPLAIN QUERY PLAN " + sql, values).fetchall()]
    except sqlite3.Error as exc:
        return [f"EXPLAIN ERROR: {exc}"]


def execute_measured(
    conn: sqlite3.Connection,
    operation: str,
    sql: str,
    values: list[Any],
    hard_step_limit: int,
) -> dict[str, Any]:
    steps = 0
    interrupted = False

    def progress() -> int:
        nonlocal steps
        steps += PROGRESS_INTERVAL
        return 1 if steps > hard_step_limit else 0

    plan = explain_plan(conn, sql, values)
    conn.set_progress_handler(progress, PROGRESS_INTERVAL)
    row_count = 0
    try:
        cursor = conn.execute(sql, values)
        if operation in ("all", "first"):
            if operation == "first":
                row_count = 1 if cursor.fetchone() is not None else 0
            else:
                row_count = len(cursor.fetchall())
        else:
            row_count = max(0, cursor.rowcount)
    except sqlite3.OperationalError as exc:
        if "interrupted" not in str(exc).lower():
            raise
        interrupted = True
    finally:
        conn.set_progress_handler(None, 0)

    return {
        "steps": steps,
        "interrupted": interrupted,
        "rowsReturned": row_count,
        "plan": plan,
    }


def run_scenario(size: int, scenario: dict[str, Any], budgets: dict[str, int]) -> dict[str, Any]:
    conn = make_connection(size, scenario.get("profile", "default"), bool(scenario.get("withSnapshot", True)), scenario["calls"])
    query_results: list[dict[str, Any]] = []
    total_steps = 0
    violations: list[str] = []
    try:
        for query_index, call in enumerate(scenario["calls"], start=1):
            sql = call["sql"]
            values = rewrite_values(sql, call.get("values", []), size)
            measured = execute_measured(
                conn,
                call["operation"],
                sql,
                values,
                budgets["singleQuerySteps"],
            )
            total_steps += measured["steps"]
            query_results.append({
                "index": query_index,
                "steps": measured["steps"],
                "interrupted": measured["interrupted"],
                "rowsReturned": measured["rowsReturned"],
                "plan": measured["plan"],
                "sql": sql[:220],
            })
            if measured["interrupted"] or measured["steps"] > budgets["singleQuerySteps"]:
                violations.append(
                    f"query {query_index} exceeded {budgets['singleQuerySteps']} SQLite steps"
                )
            if total_steps > budgets["requestSteps"]:
                violations.append(
                    f"request exceeded {budgets['requestSteps']} aggregate SQLite steps"
                )
                break
    finally:
        conn.close()

    return {
        "size": size,
        "totalSteps": total_steps,
        "queries": query_results,
        "violations": violations,
    }


def measure_fixture(size: int, bad: bool, budget: int) -> int:
    conn = make_connection(size, "default", False, [])
    try:
        if bad:
            ids = json.dumps([project_id(index) for index in range(1, size + 1)], separators=(",", ":"))
            sql = """
                WITH ranked AS (
                  SELECT CAST(key AS INTEGER) AS rank_index, value AS project_id
                  FROM json_each(?)
                )
                SELECT p.id
                FROM ranked r
                JOIN projects p ON p.id = r.project_id
                WHERE p.status = 'approved' AND p.is_published = 1 AND p.visibility = 1
                ORDER BY r.rank_index
                LIMIT 13 OFFSET 0
            """
            result = execute_measured(conn, "all", sql, [ids], budget)
            return result["steps"]

        conn.executescript(
            """
            CREATE TABLE daily_project_rankings (
              ranking_day TEXT NOT NULL,
              project_id TEXT NOT NULL,
              discovery_rank INTEGER NOT NULL,
              PRIMARY KEY (ranking_day, project_id)
            );
            CREATE UNIQUE INDEX idx_daily_discovery_rank
              ON daily_project_rankings(ranking_day, discovery_rank);
            """
        )
        conn.executemany(
            "INSERT INTO daily_project_rankings (ranking_day, project_id, discovery_rank) VALUES (?, ?, ?)",
            [("2026-09-14", project_id(index), index) for index in range(1, size + 1)],
        )
        conn.execute("ANALYZE")
        sql = """
            SELECT p.id
            FROM daily_project_rankings r
            JOIN projects p ON p.id = r.project_id
            WHERE r.ranking_day = ? AND r.discovery_rank BETWEEN ? AND ?
            ORDER BY r.discovery_rank
        """
        result = execute_measured(conn, "all", sql, ["2026-09-14", 1, 13], budget)
        return result["steps"]
    finally:
        conn.close()


def main() -> int:
    manifest = json.load(sys.stdin)
    budgets = manifest["budgets"]
    sizes = [int(value) for value in manifest["sizes"]]
    failures: list[str] = []

    bad_steps = {size: measure_fixture(size, True, budgets["singleQuerySteps"]) for size in sizes}
    good_steps = {size: measure_fixture(size, False, budgets["singleQuerySteps"]) for size in sizes}

    bad_1k = bad_steps.get(1_000, 0)
    bad_10k = bad_steps.get(10_000, 0)
    bad_detected = (
        bad_10k > budgets["singleQuerySteps"]
        or bad_10k > bad_1k * budgets["scaleMultiplier"] + budgets["scaleSlack"]
    )
    if not bad_detected:
        failures.append("guard self-test failed: incident-style JSON ranking query was not detected as expensive")

    good_1k = good_steps.get(1_000, 0)
    good_10k = good_steps.get(10_000, 0)
    good_passes = (
        good_10k <= budgets["singleQuerySteps"]
        and good_10k <= good_1k * budgets["scaleMultiplier"] + budgets["scaleSlack"]
    )
    if not good_passes:
        failures.append("guard self-test failed: bounded indexed ranking query exceeded the scale budget")

    print("D1 cost scale self-test:")
    print(f"  incident JSON ranking steps: {bad_steps}")
    print(f"  bounded indexed ranking steps: {good_steps}")

    scenario_reports: dict[str, dict[int, dict[str, Any]]] = {}
    for scenario in manifest["scenarios"]:
        per_size: dict[int, dict[str, Any]] = {}
        for size in sizes:
            result = run_scenario(size, scenario, budgets)
            per_size[size] = result
            for violation in result["violations"]:
                failures.append(f"{scenario['name']} @ {size}: {violation}")
        scenario_reports[scenario["name"]] = per_size

        one_k = per_size.get(1_000, {"totalSteps": 0})["totalSteps"]
        ten_k = per_size.get(10_000, {"totalSteps": 0})["totalSteps"]
        if ten_k > one_k * budgets["scaleMultiplier"] + budgets["scaleSlack"]:
            failures.append(
                f"{scenario['name']}: 10k request steps {ten_k} exceed scale budget "
                f"({one_k} * {budgets['scaleMultiplier']} + {budgets['scaleSlack']})"
            )

    print("\nBusiness-query scale summary:")
    for name, per_size in scenario_reports.items():
        totals = {size: report["totalSteps"] for size, report in per_size.items()}
        print(f"  {name}: {totals}")
        worst = per_size[max(sizes)]
        for query in worst["queries"]:
            if query["steps"] >= budgets["singleQuerySteps"] or query["interrupted"]:
                print(f"    expensive query #{query['index']}: {query['steps']} steps")
                for plan_line in query["plan"]:
                    print(f"      PLAN {plan_line}")

    if failures:
        print("\nD1 cost scale gate: FAIL", file=sys.stderr)
        for failure in dict.fromkeys(failures):
            print(f"- {failure}", file=sys.stderr)
        return 1

    print("\nD1 cost scale gate: PASS")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
