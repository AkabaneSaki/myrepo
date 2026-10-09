"""Incrementally copy a verified production backup into the personal staging resources.

The production database and bucket are never contacted. Run with --apply only after
reviewing the printed plan. Existing staging-only rows and objects are preserved.
"""

import argparse
from concurrent.futures import ThreadPoolExecutor
import hashlib
import json
import os
from pathlib import Path
import sqlite3
import subprocess
from datetime import datetime, timezone

TABLE_POLICY = {
    "users": "copy-core",
    "projects": "copy-core",
    "public_project_counts": "derived",
    "devteam_curators": "copy-curation",
    "devteam_recommendations": "copy-curation",
    "character_references": "mapped-reference",
    "character_reference_versions": "mapped-reference",
    "character_reference_items": "mapped-reference",
    "project_metadata_audit_logs": "staging-local",
    "project_rank_snapshots": "derived",
    "project_ranking_days": "derived",
    "project_daily_rankings": "derived",
    "project_ranking_builds": "derived",
    "discovery_feature_history": "derived",
    "daily_random_draw_state": "staging-local",
    "project_likes": "copy-interaction",
    "project_like_daily_usage": "staging-local",
    "download_daily_usage": "staging-local",
    "project_metric_daily": "staging-local",
    "project_period_tracking_meta": "staging-local",
    "project_period_popularity": "derived",
    "project_ratings": "copy-interaction",
    "project_subscribes": "copy-interaction",
    "repair_resolve_daily_usage": "staging-local",
    "site_settings": "copy-setting",
    "admin_action_logs": "staging-local",
    "super_admins": "staging-local",
    "admins": "staging-local",
    "project_search": "derived",
    "project_search_short": "derived",
    "project_search_tags": "derived",
}

OPTIONAL_COPY_TABLES = {
    "project_ratings",
    "devteam_curators",
    "devteam_recommendations",
    "site_settings",
}
SYNC_SITE_SETTING_KEYS = {"discover_banner"}
DERIVED_TABLE_PREFIXES = ("project_search_",)
D1_INTERNAL_TABLES = {"d1_migrations"}
D1_INTERNAL_PREFIXES = ("_cf_",)


def fail(message):
    raise SystemExit(message)


def run(command, *, env=None):
    result = subprocess.run(command, capture_output=True, text=True, encoding="utf-8", errors="replace", env=env)
    if result.returncode:
        fail(f"Command failed ({result.returncode}): {command[0]} {command[1]}\n{result.stderr[-1200:]}")
    return result.stdout


def age_seconds(path):
    return datetime.now(timezone.utc).timestamp() - path.stat().st_mtime


def load_database(path):
    db = sqlite3.connect(":memory:")
    db.row_factory = sqlite3.Row
    # SQL exports contain literal newlines inside text values. Text-mode I/O on
    # Windows silently converts them and would change stored descriptions.
    db.executescript(path.read_bytes().decode("utf-8-sig"))
    return db


def rows(db, table):
    return {row["id"]: dict(row) for row in db.execute(f"SELECT * FROM {table}")}


def table_exists(db, table):
    return db.execute(
        "SELECT 1 FROM sqlite_master WHERE type IN ('table', 'view') AND name = ?",
        (table,),
    ).fetchone() is not None


def table_columns(db, table):
    return {row["name"]: dict(row) for row in db.execute(f'PRAGMA table_info("{table}")')}


def application_tables(db):
    names = {
        row["name"]
        for row in db.execute(
            "SELECT name FROM sqlite_master "
            "WHERE type = 'table' AND name NOT LIKE 'sqlite_%'"
        )
    }
    return {
        name for name in names
        if name not in D1_INTERNAL_TABLES
        and not any(name.startswith(prefix) for prefix in D1_INTERNAL_PREFIXES)
        and not any(name.startswith(prefix) and name not in TABLE_POLICY for prefix in DERIVED_TABLE_PREFIXES)
    }


def validate_table_policy(source, stage):
    source_tables = application_tables(source)
    stage_tables = application_tables(stage)
    unknown = sorted((source_tables | stage_tables) - set(TABLE_POLICY))
    if unknown:
        fail(f"Unclassified application tables: {', '.join(unknown)}")

    for table in ("users", "projects"):
        if table not in source_tables or table not in stage_tables:
            fail(f"Required table missing: {table}")

    for table in sorted(source_tables):
        policy = TABLE_POLICY[table]
        if not policy.startswith("copy-") and policy != "mapped-reference":
            continue
        if table not in stage_tables:
            fail(f"Staging schema is missing production table: {table}")
        source_columns = table_columns(source, table)
        stage_columns = table_columns(stage, table)
        missing_in_stage = sorted(set(source_columns) - set(stage_columns))
        if missing_in_stage:
            fail(
                f"Staging schema is behind production for {table}: "
                f"{', '.join(missing_in_stage)}"
            )
        for name, info in stage_columns.items():
            if name in source_columns or info["pk"]:
                continue
            if info["notnull"] and info["dflt_value"] is None:
                fail(
                    f"Staging-only {table} column cannot accept production inserts: "
                    f"{name}"
                )

    return sorted(table for table in OPTIONAL_COPY_TABLES if table not in source_tables)


def keyed_rows(db, table, key_fields):
    if not table_exists(db, table):
        return {}
    return {
        tuple(row[field] for field in key_fields): dict(row)
        for row in db.execute(f"SELECT * FROM {table}")
    }


def quoted(db, value):
    return db.execute("SELECT quote(?)", (value,)).fetchone()[0]


def insert_ignore(db, table, row):
    row = dict(row)
    columns = list(row)
    names = ", ".join(f'"{key}"' for key in columns)
    values = ", ".join(quoted(db, row[key]) for key in columns)
    return f"INSERT OR IGNORE INTO {table} ({names}) VALUES ({values});"


def upsert_newer(db, table, row, key_fields):
    row = dict(row)
    columns = list(row)
    names = ", ".join(f'"{key}"' for key in columns)
    values = ", ".join(quoted(db, row[key]) for key in columns)
    conflict = ", ".join(f'"{key}"' for key in key_fields)
    updates = ", ".join(
        f'"{key}" = excluded."{key}"'
        for key in columns if key not in key_fields
    )
    if not updates:
        return insert_ignore(db, table, row)
    where = (
        f" WHERE COALESCE(excluded.updated_at, '') > COALESCE({table}.updated_at, '')"
        if "updated_at" in row
        else ""
    )
    return (
        f"INSERT INTO {table} ({names}) VALUES ({values}) "
        f"ON CONFLICT({conflict}) DO UPDATE SET {updates}{where};"
    )


def discover_banner_image_key(row):
    if not row or row.get("key") != "discover_banner":
        return None
    try:
        value = json.loads(row.get("value") or "{}")
    except json.JSONDecodeError:
        fail("Production discover_banner setting contains invalid JSON")
    image_key = value.get("imageKey")
    if image_key is None:
        return None
    if not isinstance(image_key, str) or not image_key.startswith("site/discover-banner-"):
        fail("Production discover_banner imageKey is invalid")
    return image_key


def source_row_is_newer(row, previous):
    if previous is None:
        return True
    if dict(row) == dict(previous):
        return False
    if "updated_at" not in row or "updated_at" not in previous:
        return False
    return (row.get("updated_at") or "") > (previous.get("updated_at") or "")


def project_changed_fields(row, previous):
    if previous is None:
        return set(row)
    counters = {"downloads_count", "likes_count"}
    return {key for key in row if key != "id" and row[key] != previous[key]
            and (key not in counters or row[key] > previous[key])}


def upsert(db, table, row, previous=None, *, new_user=False):
    row = dict(row)
    if new_user:
        row["is_admin"] = 0
        row["guilds"] = None
    columns = list(row)
    values = ", ".join(quoted(db, row[key]) for key in columns)
    names = ", ".join(f'"{key}"' for key in columns)
    if table == "users":
        return f"INSERT OR IGNORE INTO users ({names}) VALUES ({values});"
    if previous is None:
        return f"INSERT OR IGNORE INTO projects ({names}) VALUES ({values});"
    changed = project_changed_fields(row, previous)
    if not changed:
        fail("Project update contains no changes")
    assignments = []
    for key in columns:
        if key not in changed:
            continue
        if key in ("downloads_count", "likes_count"):
            assignments.append(f'"{key}" = MAX("{key}", {quoted(db, row[key])})')
        else:
            assignments.append(f'"{key}" = {quoted(db, row[key])}')
    return (f"UPDATE projects SET {', '.join(assignments)} "
            f"WHERE id = {quoted(db, row['id'])} "
            f"AND updated_at <= {quoted(db, row['updated_at'])};")


def add_like(db, row, project):
    project_id = quoted(db, row["project_id"])
    user_id = quoted(db, row["user_id"])
    created_at = quoted(db, row["created_at"])
    # The insert trigger increments likes_count. Reconcile it immediately so
    # copied likes do not double count the production total.
    return ("INSERT OR IGNORE INTO project_likes (project_id, user_id, created_at) "
            f"VALUES ({project_id}, {user_id}, {created_at});\n"
            "UPDATE projects SET likes_count = MAX("
            f"{quoted(db, project['likes_count'])}, "
            f"(SELECT COUNT(*) FROM project_likes WHERE project_id = {project_id})) "
            f"WHERE id = {project_id};")


def reference_mapping(source, stage):
    """Map equivalent reference IDs and refresh only metadata that changes behavior."""
    stage_refs = {row["name"]: dict(row) for row in stage.execute("SELECT * FROM character_references")}
    stage_versions = {
        (row["character_reference_id"], row["version_label"]): dict(row)
        for row in stage.execute("SELECT * FROM character_reference_versions")
    }
    ref_ids = {}
    version_ids = {}
    item_ids = {}
    version_updates = []
    item_updates = []
    for row in source.execute("SELECT * FROM character_references"):
        target = stage_refs.get(row["name"])
        if target is None:
            fail("Production reference has no staging counterpart; stop before syncing dependent projects")
        ref_ids[row["id"]] = target["id"]
    for row in source.execute("SELECT * FROM character_reference_versions"):
        target = stage_versions.get((ref_ids[row["character_reference_id"]], row["version_label"]))
        if target is None or target["version_ordinal"] != row["version_ordinal"]:
            fail("Production reference version differs from staging")
        version_ids[row["id"]] = target["id"]
        if target["grace_until"] != row["grace_until"]:
            version_updates.append(
                "UPDATE character_reference_versions SET "
                f"grace_until = {quoted(source, row['grace_until'])} "
                f"WHERE id = {quoted(source, target['id'])} "
                f"AND grace_until IS {quoted(source, target['grace_until'])};")
    stage_items = {}
    for row in stage.execute("SELECT * FROM character_reference_items"):
        key = (row["reference_version_id"], row["kind"], row["normalized_content_hash"], row["display_name"])
        if key in stage_items:
            fail("Staging reference items are ambiguous")
        stage_items[key] = dict(row)
    for row in source.execute("SELECT * FROM character_reference_items"):
        key = (version_ids[row["reference_version_id"]], row["kind"], row["normalized_content_hash"], row["display_name"])
        target = stage_items.get(key)
        if target is None or any(row[field] != target[field] for field in ("source_key", "name_hash", "structure_hash")):
            fail("Reference content differs; an explicit bootstrap is required")
        item_ids[row["id"]] = target["id"]
        if row["exact_hash"] != target["exact_hash"] or row["keys_hash"] != target["keys_hash"]:
            item_updates.append(
                "UPDATE character_reference_items SET "
                f"exact_hash = {quoted(source, row['exact_hash'])}, "
                f"keys_hash = {quoted(source, row['keys_hash'])} "
                f"WHERE id = {quoted(source, target['id'])};")
    return ref_ids, version_ids, item_ids, version_updates, item_updates


def map_project_references(row, ref_ids, version_ids, item_ids):
    mapped = dict(row)
    for field, mapping in (("character_reference_id", ref_ids),
                           ("built_for_reference_version_id", version_ids),
                           ("tested_through_reference_version_id", version_ids)):
        if mapped[field] is not None:
            if mapped[field] not in mapping:
                fail(f"Project references an unknown production {field}")
            mapped[field] = mapping[mapped[field]]
    conflicts = json.loads(mapped["original_conflict_reference_item_ids"] or "[]")
    if not isinstance(conflicts, list) or any(item not in item_ids for item in conflicts):
        fail("Project contains an unknown reference-item ID")
    if conflicts:
        mapped["original_conflict_reference_item_ids"] = json.dumps(
            [item_ids[item] for item in conflicts], separators=(",", ":"))
    return mapped


def file_sizes(path):
    result = {}
    for line in path.read_text(encoding="utf-8-sig").splitlines():
        name, size = line.rsplit("|", 1)
        if name.startswith("/") or ".." in Path(name).parts or "\\" in name:
            fail(f"Unsafe R2 object path: {name}")
        result[name] = int(size)
    return result


def r2_hash_mismatches(source_dir, destination, names):
    if not names:
        return set()
    result = subprocess.run(
        ["rclone", "check", str(source_dir), destination, "--files-from", "-",
         "--one-way", "--combined", "-", "--checkers", "8"],
        input="\n".join(names) + "\n", capture_output=True, text=True,
        encoding="utf-8", errors="replace")
    statuses = {}
    for line in result.stdout.splitlines():
        if len(line) < 3 or line[1] != " " or line[0] not in "=+*!-":
            fail("R2 hash check returned an unrecognized report")
        statuses[line[2:]] = line[0]
    if set(statuses) != set(names) or any(mark in "!-" for mark in statuses.values()):
        fail("R2 hash check was incomplete or had an object error")
    if result.returncode not in (0, 1):
        fail(f"R2 hash check failed: {result.stderr[-800:]}")
    mismatches = {name for name, mark in statuses.items() if mark in "+*"}
    if bool(mismatches) != bool(result.returncode):
        fail("R2 hash check exit status disagrees with its report")
    return mismatches


def account_info(args, env, identity):
    databases = json.loads(run(["node", str(args.wrangler), "d1", "list",
                                "--config", str(args.staging_config), "--json"], env=env))
    known = {entry["name"]: entry["uuid"] for entry in databases}
    if known.get(identity["database_name"]) != identity["database_id"]:
        fail("Staging D1 is not in the configured account")

    def inspect(entry):
        raw = run(["node", str(args.wrangler), "d1", "info", entry["name"],
                   "--config", str(args.staging_config), "--json"], env=env)
        info = json.loads(raw)
        if info.get("uuid") != entry["uuid"] or info.get("name") != entry["name"]:
            fail("Account D1 inventory changed during cost check")
        return info

    with ThreadPoolExecutor(max_workers=4) as pool:
        infos = list(pool.map(inspect, databases))
    target = next(info for info in infos if info["uuid"] == identity["database_id"])
    return {"target": target,
            "rows_read_24h": sum(info["rows_read_24h"] for info in infos),
            "rows_written_24h": sum(info["rows_written_24h"] for info in infos)}


def save_json(path, value):
    temporary = path.with_suffix(path.suffix + ".tmp")
    temporary.write_bytes((json.dumps(value, indent=2) + "\n").encode("utf-8"))
    temporary.replace(path)


def effective_usage(ledger, info, metric):
    observed = f"observedRows{metric}24h"
    own = f"toolRows{metric}"
    reported = f"rows_{metric.lower()}_24h"
    accounted = ledger[observed] + ledger[own]
    if info[reported] > accounted:
        ledger[observed] += info[reported] - accounted
    return ledger[observed] + ledger[own]


def batch_metrics(output):
    json_start = output.find("\n[")
    if json_start < 0 and output.startswith("["):
        json_start = -1
    if json_start < -1 or (json_start == -1 and not output.startswith("[")):
        fail("D1 batch returned no JSON metrics; ledger is pending")
    results = json.loads(output[json_start + 1:])
    if not isinstance(results, list) or not results or any(
            not item.get("success") or "rows_written" not in item.get("meta", {})
            or "rows_read" not in item.get("meta", {}) for item in results):
        fail("D1 batch returned incomplete metrics; ledger is pending")
    return (sum(item["meta"]["rows_read"] for item in results),
            sum(item["meta"]["rows_written"] for item in results))


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--backup", type=Path, required=True)
    parser.add_argument("--staging-snapshot", type=Path, required=True)
    parser.add_argument("--staging-config", type=Path, required=True)
    parser.add_argument("--token-file", type=Path, required=True)
    parser.add_argument("--wrangler", type=Path, required=True)
    parser.add_argument("--r2-remote", required=True)
    parser.add_argument("--source-r2-list", type=Path, required=True)
    parser.add_argument("--staging-r2-list", type=Path, required=True)
    parser.add_argument("--output-dir", type=Path, required=True)
    parser.add_argument("--ledger-file", type=Path)
    parser.add_argument("--policy", type=Path, default=Path(__file__).resolve().parent.parent / "staging-sync.policy.json")
    parser.add_argument("--apply", action="store_true")
    args = parser.parse_args()

    policy = json.loads(args.policy.read_text(encoding="utf-8"))
    required_limits = (
        "maxBackupAgeHours", "maxStagingSnapshotAgeMinutes",
        "accountD1RowsRead24hCeiling", "d1ReadSafetyMarginPerBatch",
        "accountD1RowsWritten24hCeiling", "d1WriteSafetyMarginPerBatch",
        "maxR2ObjectsPerRun", "maxR2HashChecksPerRun",
        "maxR2UploadBytesPerRun", "maxStatementsPerD1Batch")
    if any(type(policy.get(key)) is not int or policy[key] <= 0 for key in required_limits):
        fail("Sync policy must contain positive integer limits")
    required_weights = (
        "reference", "user", "projectLineEndings", "projectContent", "projectCounter",
        "like", "rating", "subscription", "curator", "recommendation", "siteSetting")
    weights = policy.get("writeWeights") or {}
    if any(type(weights.get(key)) is not int or weights[key] <= 0 for key in required_weights):
        fail("Sync policy must contain positive integer writeWeights")
    if policy["d1WriteSafetyMarginPerBatch"] < max(weights.values()) * policy["maxStatementsPerD1Batch"]:
        fail("D1 write safety margin is too small for the configured batch size")
    manifest = json.loads((args.backup / "manifest.json").read_text(encoding="utf-8-sig"))
    if not all(manifest["verified"].values()):
        fail("Production backup verification is incomplete")
    source_sql = args.backup / manifest["production"]["d1"]["exportFile"]
    digest = hashlib.sha256(source_sql.read_bytes()).hexdigest()
    if digest != manifest["production"]["d1"]["sha256"]:
        fail("Production D1 backup hash mismatch")
    if age_seconds(source_sql) > policy["maxBackupAgeHours"] * 3600:
        fail("Production backup is too old")
    max_stage_age = policy["maxStagingSnapshotAgeMinutes"] * 60
    if age_seconds(args.staging_snapshot) > max_stage_age or age_seconds(args.staging_r2_list) > max_stage_age:
        fail("Staging snapshot/list is too old; export and list staging again")
    config = json.loads(args.staging_config.read_text(encoding="utf-8"))
    if len(config["d1_databases"]) != 1 or len(config["r2_buckets"]) != 1:
        fail("Expected exactly one staging D1 and R2 binding")
    identity = config["d1_databases"][0]
    bucket = config["r2_buckets"][0]["bucket_name"]
    account = config["account_id"]
    if "staging" not in identity["database_name"] or "staging" not in bucket:
        fail("Target bindings are not staging resources")
    if identity["database_id"] == manifest["production"]["d1"]["id"] or account == manifest["production"]["accountId"]:
        fail("Target overlaps production")
    remote_config = run(["rclone", "config", "show", args.r2_remote])
    if f"https://{account}.r2.cloudflarestorage.com" not in remote_config:
        fail("R2 remote endpoint does not match staging account")
    if not args.token_file.is_file():
        fail("Staging credential file missing")
    env = dict(os.environ)
    env.pop("CLOUDFLARE_API_KEY", None)
    env.pop("CLOUDFLARE_EMAIL", None)
    env["CLOUDFLARE_API_TOKEN"] = args.token_file.read_text(encoding="utf-8").strip()
    env["CLOUDFLARE_ACCOUNT_ID"] = account
    info = account_info(args, env, identity)
    ledger_path = args.ledger_file or (args.backup.parent / "_staging-sync-ledger.json")
    if ledger_path.exists():
        ledger = json.loads(ledger_path.read_text(encoding="utf-8"))
        if ledger.get("stagingD1") != identity["database_id"]:
            fail("Sync ledger belongs to another staging database")
        if ledger.get("pending"):
            fail("Previous D1 batch has unknown outcome; reconcile the ledger before rerunning")
        if datetime.now(timezone.utc).timestamp() - ledger["startedAtUtc"] >= 86400:
            ledger = None
    else:
        ledger = None
    if ledger is None:
        ledger = {"stagingD1": identity["database_id"],
                  "startedAtUtc": datetime.now(timezone.utc).timestamp(),
                  "observedRowsRead24h": info["rows_read_24h"],
                  "toolRowsRead": 0,
                  "observedRowsWritten24h": info["rows_written_24h"],
                  "toolRowsWritten": 0, "pending": False}
    read_usage = effective_usage(ledger, info, "Read")
    usage = effective_usage(ledger, info, "Written")
    if read_usage + policy["d1ReadSafetyMarginPerBatch"] >= policy["accountD1RowsRead24hCeiling"]:
        fail("Account D1 24-hour read ceiling already reached")
    if usage + policy["d1WriteSafetyMarginPerBatch"] >= policy["accountD1RowsWritten24hCeiling"]:
        fail("Account D1 24-hour write ceiling already reached")

    source = load_database(source_sql)
    stage = load_database(args.staging_snapshot)
    source_missing_optional_tables = validate_table_policy(source, stage)
    ref_ids, version_ids, item_ids, version_updates, item_updates = reference_mapping(source, stage)
    reference_statements = version_updates + item_updates
    source_projects = {
        row["id"]: map_project_references(dict(row), ref_ids, version_ids, item_ids)
        for row in source.execute("SELECT * FROM projects")
    }
    stage_projects = rows(stage, "projects")
    stage_users = rows(stage, "users")
    source_users = rows(source, "users")
    stage_likes = {
        (row["project_id"], row["user_id"])
        for row in stage.execute("SELECT project_id, user_id FROM project_likes")
    }
    stage_subscriptions = {
        (row["project_id"], row["user_id"])
        for row in stage.execute("SELECT project_id, user_id FROM project_subscribes")
    }
    stage_ratings = keyed_rows(stage, "project_ratings", ("project_id", "user_id"))
    source_ratings = keyed_rows(source, "project_ratings", ("project_id", "user_id"))
    stage_curators = keyed_rows(stage, "devteam_curators", ("user_id",))
    source_curators = keyed_rows(source, "devteam_curators", ("user_id",))
    stage_recommendations = keyed_rows(stage, "devteam_recommendations", ("curator_id", "project_id"))
    source_recommendations = keyed_rows(source, "devteam_recommendations", ("curator_id", "project_id"))
    stage_settings = keyed_rows(stage, "site_settings", ("key",))
    source_settings = keyed_rows(source, "site_settings", ("key",))

    source_files = file_sizes(args.source_r2_list)
    stage_files = file_sizes(args.staging_r2_list)
    if len(source_files) != manifest["production"]["r2"]["objectCount"] or sum(source_files.values()) != manifest["production"]["r2"]["bytes"]:
        fail("Source R2 listing does not match the verified backup manifest")
    source_r2_dir = args.backup / manifest["production"]["r2"]["snapshotDir"]

    source_banner_setting = source_settings.get(("discover_banner",))
    stage_banner_setting = stage_settings.get(("discover_banner",))
    banner_setting_candidate = None
    banner_source_row = None
    if source_banner_setting:
        if stage_banner_setting is None or source_row_is_newer(source_banner_setting, stage_banner_setting):
            banner_setting_candidate = source_banner_setting
            banner_source_row = source_banner_setting
        elif stage_banner_setting.get("value") == source_banner_setting.get("value"):
            banner_source_row = source_banner_setting
    banner_image_key = discover_banner_image_key(banner_source_row)
    if banner_image_key and banner_image_key not in source_files:
        fail("Production discover_banner R2 object is missing from the verified backup listing")

    categories = {"line_endings": [], "content": [], "counters": []}
    for project_id, row in source_projects.items():
        previous = stage_projects.get(project_id)
        if previous and all(previous.get(key) == value for key, value in row.items()):
            continue
        if previous and (row["updated_at"] or "") < (previous["updated_at"] or ""):
            continue
        counter_fields = {"downloads_count", "likes_count"}
        text_fields = {"description", "precautions"}
        changed = project_changed_fields(row, previous)
        if not changed:
            continue
        if previous and changed & text_fields and changed <= text_fields | counter_fields and all(
                (row[key] or "").replace("\r\n", "\n") == (previous[key] or "").replace("\r\n", "\n")
                for key in changed & text_fields):
            category = "line_endings"
        else:
            category = "counters" if previous and changed <= counter_fields else "content"
        categories[category].append(row)
    for group in categories.values():
        group.sort(key=lambda row: (row["updated_at"] or "", row["id"]), reverse=True)

    content_ids = {row["id"] for row in categories["content"]}
    same_size_content = [name for name, size in source_files.items()
                         if name.startswith("projects/") and name.split("/")[1] in content_ids
                         and stage_files.get(name) == size]
    if banner_image_key and stage_files.get(banner_image_key) == source_files[banner_image_key]:
        same_size_content.append(banner_image_key)
    same_size_content = list(dict.fromkeys(same_size_content))
    if len(same_size_content) > policy["maxR2HashChecksPerRun"]:
        fail("R2 hash-check ceiling reached; reduce the source window or adjust policy")
    hash_different = r2_hash_mismatches(source_r2_dir, f"{args.r2_remote}:{bucket}", same_size_content)

    # Project writes now fire FTS/tag maintenance and public-count triggers. Keep
    # weights explicit and conservative, then reconcile actual D1 usage after each batch.
    budget = policy["accountD1RowsWritten24hCeiling"] - usage - policy["d1WriteSafetyMarginPerBatch"]
    reference_weight = weights["reference"] * len(reference_statements)
    if reference_weight > budget:
        fail("Reference metadata cannot fit the configured D1 budget")
    budget -= reference_weight

    chosen_users = []
    chosen_user_ids = set()
    chosen_projects = []
    chosen_likes = []
    chosen_ratings = []
    chosen_subscriptions = []
    chosen_curators = []
    chosen_recommendations = []
    chosen_site_settings = []
    chosen_files = []
    uploaded_bytes = 0

    project_weights = {
        "line_endings": weights["projectLineEndings"],
        "content": weights["projectContent"],
        "counters": weights["projectCounter"],
    }

    for group_name in ("line_endings", "content", "counters"):
        for row in categories[group_name]:
            project_id = row["id"]
            object_names = [name for name, size in source_files.items()
                            if name.startswith(f"projects/{project_id}/")
                            and (stage_files.get(name) != size or name in hash_different)]
            new_user = None
            if row["author_id"] not in stage_users and row["author_id"] not in chosen_user_ids:
                new_user = source_users.get(row["author_id"])
                if new_user is None:
                    continue
            weight = project_weights[group_name] + (weights["user"] if new_user else 0)
            extra_bytes = sum(source_files[name] for name in object_names)
            if weight > budget:
                continue
            if len(chosen_files) + len(object_names) > policy["maxR2ObjectsPerRun"]:
                continue
            if len(same_size_content) + len(chosen_files) + len(object_names) > policy["maxR2HashChecksPerRun"]:
                continue
            if uploaded_bytes + extra_bytes > policy["maxR2UploadBytesPerRun"]:
                continue
            budget -= weight
            if new_user:
                chosen_users.append(new_user)
                chosen_user_ids.add(new_user["id"])
            chosen_projects.append((group_name, row))
            chosen_files.extend(object_names)
            uploaded_bytes += extra_bytes

    available_projects = set(stage_projects) | {row["id"] for _, row in chosen_projects}

    def pending_user(user_id):
        if user_id in stage_users or user_id in chosen_user_ids:
            return None
        return source_users.get(user_id)

    def accept_user(row):
        if row is not None:
            chosen_users.append(row)
            chosen_user_ids.add(row["id"])

    for row in source.execute("SELECT project_id, user_id, created_at FROM project_likes ORDER BY created_at DESC"):
        key = (row["project_id"], row["user_id"])
        if key in stage_likes or key[0] not in available_projects or key[0] not in source_projects:
            continue
        if key[1] not in source_users:
            continue
        new_user = pending_user(key[1])
        weight = weights["like"] + (weights["user"] if new_user else 0)
        if weight > budget:
            continue
        budget -= weight
        accept_user(new_user)
        chosen_likes.append(dict(row))

    for key, row in sorted(source_ratings.items(), key=lambda item: item[1].get("updated_at") or "", reverse=True):
        if key in stage_ratings or key[0] not in available_projects or key[0] not in source_projects:
            continue
        if key[1] not in source_users:
            continue
        new_user = pending_user(key[1])
        weight = weights["rating"] + (weights["user"] if new_user else 0)
        if weight > budget:
            continue
        budget -= weight
        accept_user(new_user)
        chosen_ratings.append(row)

    for row in source.execute("SELECT project_id, user_id, created_at FROM project_subscribes ORDER BY created_at DESC"):
        key = (row["project_id"], row["user_id"])
        if key in stage_subscriptions or key[0] not in available_projects or key[0] not in source_projects:
            continue
        if key[1] not in source_users:
            continue
        new_user = pending_user(key[1])
        weight = weights["subscription"] + (weights["user"] if new_user else 0)
        if weight > budget:
            continue
        budget -= weight
        accept_user(new_user)
        chosen_subscriptions.append(dict(row))

    for key, row in sorted(source_curators.items(), key=lambda item: item[1].get("updated_at") or "", reverse=True):
        if not source_row_is_newer(row, stage_curators.get(key)):
            continue
        user_id = key[0]
        if user_id not in source_users:
            continue
        new_user = pending_user(user_id)
        weight = weights["curator"] + (weights["user"] if new_user else 0)
        if weight > budget:
            continue
        budget -= weight
        accept_user(new_user)
        chosen_curators.append(row)

    for key, row in sorted(source_recommendations.items(), key=lambda item: item[1].get("updated_at") or "", reverse=True):
        if not source_row_is_newer(row, stage_recommendations.get(key)):
            continue
        curator_id, project_id = key
        if project_id not in available_projects or project_id not in source_projects or curator_id not in source_users:
            continue
        new_user = pending_user(curator_id)
        weight = weights["recommendation"] + (weights["user"] if new_user else 0)
        if weight > budget:
            continue
        budget -= weight
        accept_user(new_user)
        chosen_recommendations.append(row)

    banner_object_needed = bool(
        banner_image_key and (
            stage_files.get(banner_image_key) != source_files[banner_image_key]
            or banner_image_key in hash_different
        )
    )
    if banner_setting_candidate and weights["siteSetting"] <= budget:
        object_names = [banner_image_key] if banner_object_needed else []
        extra_bytes = sum(source_files[name] for name in object_names)
        if (len(chosen_files) + len(object_names) <= policy["maxR2ObjectsPerRun"]
                and uploaded_bytes + extra_bytes <= policy["maxR2UploadBytesPerRun"]):
            budget -= weights["siteSetting"]
            chosen_site_settings.append(banner_setting_candidate)
            chosen_files.extend(object_names)
            uploaded_bytes += extra_bytes
    elif (not banner_setting_candidate and banner_source_row and banner_object_needed
          and stage_banner_setting and stage_banner_setting.get("value") == banner_source_row.get("value")):
        if (len(chosen_files) + 1 <= policy["maxR2ObjectsPerRun"]
                and uploaded_bytes + source_files[banner_image_key] <= policy["maxR2UploadBytesPerRun"]):
            chosen_files.append(banner_image_key)
            uploaded_bytes += source_files[banner_image_key]

    chosen_files = list(dict.fromkeys(chosen_files))
    if not (reference_statements or chosen_projects or chosen_likes or chosen_ratings
            or chosen_subscriptions or chosen_curators or chosen_recommendations
            or chosen_site_settings or chosen_files):
        fail("No changes fit the configured budget")

    plan = {"sourceBackup": str(args.backup), "stagingD1": identity["database_id"],
            "stagingR2": bucket, "stagingRowsRead24hBefore": info["target"]["rows_read_24h"],
            "accountRowsRead24hBefore": info["rows_read_24h"],
            "accountedRowsRead24hBefore": read_usage,
            "stagingRowsWritten24hBefore": info["target"]["rows_written_24h"],
            "accountRowsWritten24hBefore": info["rows_written_24h"],
            "accountedRowsWritten24hBefore": usage,
            "sourceMissingOptionalTables": source_missing_optional_tables,
            "projectsSelected": len(chosen_projects),
            "lineEndingRepairsSelected": sum(kind == "line_endings" for kind, _ in chosen_projects),
            "contentProjectsSelected": sum(kind == "content" for kind, _ in chosen_projects),
            "counterProjectsSelected": sum(kind == "counters" for kind, _ in chosen_projects),
            "projectsDeferred": sum(map(len, categories.values())) - len(chosen_projects),
            "referenceMetadataUpdates": len(reference_statements),
            "usersSelected": len(chosen_users),
            "likesSelected": len(chosen_likes),
            "ratingsSelected": len(chosen_ratings),
            "subscriptionsSelected": len(chosen_subscriptions),
            "curatorsSelected": len(chosen_curators),
            "recommendationsSelected": len(chosen_recommendations),
            "siteSettingsSelected": len(chosen_site_settings),
            "r2ObjectsSelected": len(chosen_files),
            "r2HashChecksEstimated": len(same_size_content) + len(chosen_files),
            "r2UploadBytesEstimated": uploaded_bytes,
            "applied": False}

    statements = list(version_updates)
    statements.extend(upsert(source, "users", row, new_user=True) for row in chosen_users)
    statements.extend(upsert(source, "projects", row, stage_projects.get(row["id"])) for _, row in chosen_projects)
    statements.extend(item_updates)
    statements.extend(add_like(source, row, source_projects[row["project_id"]]) for row in chosen_likes)
    statements.extend(insert_ignore(source, "project_ratings", row) for row in chosen_ratings)
    statements.extend(insert_ignore(source, "project_subscribes", row) for row in chosen_subscriptions)
    statements.extend(upsert_newer(source, "devteam_curators", row, ("user_id",)) for row in chosen_curators)
    statements.extend(upsert_newer(source, "devteam_recommendations", row, ("curator_id", "project_id"))
                      for row in chosen_recommendations)
    statements.extend(upsert_newer(source, "site_settings", row, ("key",)) for row in chosen_site_settings)

    selected_weights = [weights["reference"]] * len(version_updates)
    selected_weights.extend([weights["user"]] * len(chosen_users))
    selected_weights.extend([project_weights[kind] for kind, _ in chosen_projects])
    selected_weights.extend([weights["reference"]] * len(item_updates))
    selected_weights.extend([weights["like"]] * len(chosen_likes))
    selected_weights.extend([weights["rating"]] * len(chosen_ratings))
    selected_weights.extend([weights["subscription"]] * len(chosen_subscriptions))
    selected_weights.extend([weights["curator"]] * len(chosen_curators))
    selected_weights.extend([weights["recommendation"]] * len(chosen_recommendations))
    selected_weights.extend([weights["siteSetting"]] * len(chosen_site_settings))
    # Catch schema drift and missing authors before uploading any file.
    stage.execute("PRAGMA foreign_keys = ON")
    try:
        stage.executescript("\n".join(statements))
    except sqlite3.Error as error:
        fail(f"Local staging-SQL simulation failed: {error}")
    if stage.execute("PRAGMA foreign_key_check").fetchone():
        fail("Local staging-SQL simulation has a foreign-key violation")
    print(json.dumps(plan, indent=2), flush=True)
    if not args.apply:
        return

    if args.output_dir.exists() and any(args.output_dir.iterdir()):
        fail("Output directory is not empty; choose a new run directory")
    args.output_dir.mkdir(parents=True, exist_ok=True)
    list_path = args.output_dir / "r2-files.txt"
    list_path.write_text("\n".join(chosen_files) + "\n", encoding="utf-8")
    if chosen_files:
        run(["rclone", "copy", str(source_r2_dir),
             f"{args.r2_remote}:{bucket}", "--files-from", str(list_path),
             "--ignore-times", "--transfers", "4", "--checkers", "8"])
        mismatches = r2_hash_mismatches(source_r2_dir, f"{args.r2_remote}:{bucket}", chosen_files)
        if mismatches:
            fail(f"R2 copy verification failed for {len(mismatches)} objects; D1 was not changed")

    completed_batches = 0
    for start in range(0, len(statements), policy["maxStatementsPerD1Batch"]):
        current_info = account_info(args, env, identity)
        read_usage = effective_usage(ledger, current_info, "Read")
        if read_usage + policy["d1ReadSafetyMarginPerBatch"] >= policy["accountD1RowsRead24hCeiling"]:
            break
        usage = effective_usage(ledger, current_info, "Written")
        batch_weight = sum(selected_weights[start:start + policy["maxStatementsPerD1Batch"]])
        if usage + batch_weight + policy["d1WriteSafetyMarginPerBatch"] > policy["accountD1RowsWritten24hCeiling"]:
            break
        batch_path = args.output_dir / f"d1-batch-{start:04d}.sql"
        batch_path.write_bytes(("\n".join(statements[start:start + policy["maxStatementsPerD1Batch"]]) + "\n").encode("utf-8"))
        ledger["pending"] = True
        save_json(ledger_path, ledger)
        raw = run(["node", str(args.wrangler), "d1", "execute", identity["database_name"],
                   "--remote", "--config", str(args.staging_config), "--file", str(batch_path), "--yes", "--json"], env=env)
        batch_read, batch_written = batch_metrics(raw)
        ledger["toolRowsRead"] += batch_read
        ledger["toolRowsWritten"] += batch_written
        ledger["pending"] = False
        save_json(ledger_path, ledger)
        completed_batches += 1
    final_info = account_info(args, env, identity)
    plan.update({"applied": True, "completedBatches": completed_batches,
                 "totalBatches": (len(statements) + policy["maxStatementsPerD1Batch"] - 1) // policy["maxStatementsPerD1Batch"],
                 "stagingRowsRead24hAfter": final_info["target"]["rows_read_24h"],
                 "stagingRowsWritten24hAfter": final_info["target"]["rows_written_24h"],
                 "accountRowsRead24hAfter": final_info["rows_read_24h"],
                 "accountRowsWritten24hAfter": final_info["rows_written_24h"]})
    plan["accountedRowsRead24hAfter"] = effective_usage(ledger, final_info, "Read")
    plan["accountedRowsWritten24hAfter"] = effective_usage(ledger, final_info, "Written")
    save_json(ledger_path, ledger)
    save_json(args.output_dir / "result.json", plan)
    print(json.dumps(plan, indent=2), flush=True)
    if completed_batches != plan["totalBatches"]:
        fail("D1 budget reached: remaining rows were deferred; inspect result.json")


if __name__ == "__main__":
    main()
