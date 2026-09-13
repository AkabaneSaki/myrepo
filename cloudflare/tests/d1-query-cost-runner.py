#!/usr/bin/env python3
"""Local scale/cost guard for D1 hot-path queries.

This measures SQLite VM work, not Cloudflare D1 billable rows. It is the local
zero-quota guard; real D1 meta.rows_read/meta.rows_written is verified later on
staging with a deliberately small remote probe.
"""

from __future__ import annotations

import json
import sqlite3
import sys
from pathlib import Path
from typing import Any

SCHEMA_PATH = Path(__file__).resolve().parents[1] / "schema.sql"
PROGRESS_INTERVAL = 100
PAGE_SIZE = 13


def project_id(index: int) -> str:
    return f"p{index:06d}"


def project_shape(index: int, size: int, profile: str) -> tuple[str, int]:
    types = ["角色", "扩展", "系统核心", "事件"]
    ptype = types[(index - 1) % len(types)]
    visibility = 1
    if profile == "rareType":
        ptype = "事件" if index <= max(1, size // 100) else "角色"
    elif profile == "noMatch":
        ptype = "角色"
    elif profile == "manyHidden":
        visibility = 1 if index % 10 == 0 else 0
    return ptype, visibility


def build_daily_rank_rows(size: int, profile: str) -> list[dict[str, Any]]:
    rows: list[dict[str, Any]] = []
    discover_type_counter: dict[str, int] = {}
    rating_type_counter: dict[str, int] = {}
    discover_rank = 0
    rating_rank = 0

    for index in range(1, size + 1):
        ptype, visibility = project_shape(index, size, profile)
        if not visibility:
            continue
        discover_rank += 1
        discover_type_counter[ptype] = discover_type_counter.get(ptype, 0) + 1
        row: dict[str, Any] = {
            "projectId": project_id(index),
            "projectType": ptype,
            "discoverRank": discover_rank,
            "discoverTypeRank": discover_type_counter[ptype],
            "ratingRank": None,
            "ratingTypeRank": None,
        }
        if index * 10 >= 100:
            rating_rank += 1
            rating_type_counter[ptype] = rating_type_counter.get(ptype, 0) + 1
            row["ratingRank"] = rating_rank
            row["ratingTypeRank"] = rating_type_counter[ptype]
        rows.append(row)
    return rows


def seed_daily_board(conn: sqlite3.Connection, size: int, profile: str, ranking_day: str) -> None:
    rows = build_daily_rank_rows(size, profile)
    conn.execute(
        "INSERT INTO project_ranking_days (ranking_day, generated_at, project_count) VALUES (?, ?, ?)",
        (ranking_day, f"{ranking_day}T00:00:00.000Z", len(rows)),
    )
    conn.executemany(
        """
        INSERT INTO project_daily_rankings (
          ranking_day, project_id, project_type,
          discover_rank, discover_type_rank, rating_rank, rating_type_rank
        ) VALUES (?, ?, ?, ?, ?, ?, ?)
        """,
        [
            (
                ranking_day,
                row["projectId"],
                row["projectType"],
                row["discoverRank"],
                row["discoverTypeRank"],
                row["ratingRank"],
                row["ratingTypeRank"],
            )
            for row in rows
        ],
    )


def make_connection(
    size: int,
    profile: str,
    with_ranking_day: bool,
    ranking_day: str,
) -> sqlite3.Connection:
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
    for index in range(1, size + 1):
        ptype, visibility = project_shape(index, size, profile)
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
        [(project_id(index), "viewer") for index in range(1, min(size, PAGE_SIZE) + 1)],
    )

    if with_ranking_day:
        seed_daily_board(conn, size, profile, ranking_day)

    conn.execute("ANALYZE")
    return conn


def rewrite_values(values: list[Any], size: int, profile: str) -> list[Any]:
    all_ids = [project_id(index) for index in range(1, size + 1)]
    rewritten = list(values)

    for index, value in enumerate(rewritten):
        if not isinstance(value, str) or not value.lstrip().startswith("["):
            continue
        try:
            parsed = json.loads(value)
        except json.JSONDecodeError:
            continue
        if not isinstance(parsed, list) or len(parsed) <= PAGE_SIZE + 1:
            continue

        if all(isinstance(item, str) and item.startswith("p") for item in parsed):
            rewritten[index] = json.dumps(all_ids, separators=(",", ":"))
            continue

        if all(isinstance(item, dict) and "projectId" in item for item in parsed):
            rewritten[index] = json.dumps(build_daily_rank_rows(size, profile), separators=(",", ":"))

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
    rows_returned = 0
    rows_changed = 0
    try:
        cursor = conn.execute(sql, values)
        if operation in ("all", "first"):
            if operation == "first":
                rows_returned = 1 if cursor.fetchone() is not None else 0
            else:
                rows_returned = len(cursor.fetchall())
        else:
            rows_changed = max(0, cursor.rowcount)
    except sqlite3.OperationalError as exc:
        if "interrupted" not in str(exc).lower():
            raise
        interrupted = True
    finally:
        conn.set_progress_handler(None, 0)

    return {
        "steps": steps,
        "interrupted": interrupted,
        "rowsReturned": rows_returned,
        "rowsChanged": rows_changed,
        "plan": plan,
    }


def run_scenario(size: int, scenario: dict[str, Any], budgets: dict[str, int]) -> dict[str, Any]:
    cost_class = scenario.get("costClass", "ordinary")
    conn = make_connection(
        size,
        scenario.get("profile", "default"),
        bool(scenario.get("withRankingDay", True)),
        scenario["rankingDay"],
    )
    query_results: list[dict[str, Any]] = []
    total_steps = 0
    total_writes = 0
    violations: list[str] = []

    query_budget = budgets["generationQuerySteps"] if cost_class in ("generation", "search") else budgets["singleQuerySteps"]
    request_budget = budgets["generationRequestSteps"] if cost_class in ("generation", "search") else budgets["requestSteps"]

    try:
        for query_index, call in enumerate(scenario["calls"], start=1):
            sql = call["sql"]
            values = rewrite_values(call.get("values", []), size, scenario.get("profile", "default"))
            measured = execute_measured(conn, call["operation"], sql, values, query_budget)
            total_steps += measured["steps"]
            total_writes += measured["rowsChanged"]
            query_results.append({
                "index": query_index,
                "steps": measured["steps"],
                "interrupted": measured["interrupted"],
                "rowsReturned": measured["rowsReturned"],
                "rowsChanged": measured["rowsChanged"],
                "plan": measured["plan"],
                "sql": sql[:220],
            })

            if cost_class != "search" and (measured["interrupted"] or measured["steps"] > query_budget):
                violations.append(f"query {query_index} exceeded {query_budget} SQLite steps")
            if cost_class != "search" and total_steps > request_budget:
                violations.append(f"request exceeded {request_budget} aggregate SQLite steps")
                break
            if cost_class == "hot-ranking":
                if any("USE TEMP B-TREE" in line.upper() for line in measured["plan"]):
                    violations.append(f"query {query_index} uses a temporary B-tree on the ranking hot path")
                if any("SCAN R" in line.upper() for line in measured["plan"]):
                    violations.append(f"query {query_index} scans the ranking table instead of using its rank index")
    finally:
        conn.close()

    if cost_class == "generation" and total_writes > budgets["generationWriteRows"]:
        violations.append(
            f"daily generation wrote {total_writes} rows (budget: {budgets['generationWriteRows']})"
        )

    return {
        "size": size,
        "totalSteps": total_steps,
        "totalWrites": total_writes,
        "queries": query_results,
        "violations": violations,
    }


def measure_fixture(size: int, bad: bool, budget: int) -> int:
    ranking_day = "2026-09-14"
    conn = make_connection(size, "default", not bad, ranking_day)
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
            return execute_measured(conn, "all", sql, [ids], budget)["steps"]

        sql = """
            SELECT p.id
            FROM project_daily_rankings r
            JOIN projects p ON p.id = r.project_id
            WHERE r.ranking_day = ? AND r.discover_rank BETWEEN ? AND ?
            ORDER BY r.discover_rank
        """
        return execute_measured(conn, "all", sql, [ranking_day, 1, 13], budget)["steps"]
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
    if not (
        bad_10k > budgets["singleQuerySteps"]
        or bad_10k > bad_1k * budgets["scaleMultiplier"] + budgets["scaleSlack"]
    ):
        failures.append("guard self-test failed: incident-style JSON ranking query was not detected as expensive")

    good_1k = good_steps.get(1_000, 0)
    good_10k = good_steps.get(10_000, 0)
    if not (
        good_10k <= budgets["singleQuerySteps"]
        and good_10k <= good_1k * budgets["scaleMultiplier"] + budgets["scaleSlack"]
    ):
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

        if scenario.get("costClass") == "search":
            continue
        one_k = per_size.get(1_000, {"totalSteps": 0})["totalSteps"]
        ten_k = per_size.get(10_000, {"totalSteps": 0})["totalSteps"]
        multiplier = (
            budgets["generationScaleMultiplier"]
            if scenario.get("costClass") == "generation"
            else budgets["scaleMultiplier"]
        )
        if ten_k > one_k * multiplier + budgets["scaleSlack"]:
            failures.append(
                f"{scenario['name']}: 10k request steps {ten_k} exceed scale budget "
                f"({one_k} * {multiplier} + {budgets['scaleSlack']})"
            )

    print("\nBusiness-query scale summary:")
    for name, per_size in scenario_reports.items():
        totals = {size: report["totalSteps"] for size, report in per_size.items()}
        writes = {size: report["totalWrites"] for size, report in per_size.items() if report["totalWrites"]}
        print(f"  {name}: steps={totals}" + (f" writes={writes}" if writes else ""))
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
