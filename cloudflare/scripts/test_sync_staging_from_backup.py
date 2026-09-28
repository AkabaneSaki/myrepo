import importlib.util
import json
from pathlib import Path
import re
import sqlite3
import subprocess
import tempfile
import unittest
from unittest.mock import patch


spec = importlib.util.spec_from_file_location(
    "sync_staging_from_backup", Path(__file__).with_name("sync-staging-from-backup.py"))
sync = importlib.util.module_from_spec(spec)
spec.loader.exec_module(sync)


class StagingSyncSafetyTests(unittest.TestCase):
    def test_sql_dump_preserves_literal_newlines(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "snapshot.sql"
            path.write_bytes(b"CREATE TABLE t(value TEXT); INSERT INTO t VALUES ('a\nb');")
            db = sync.load_database(path)
            self.assertEqual(db.execute("SELECT hex(value) FROM t").fetchone()[0], "610A62")

    def test_existing_project_updates_only_changed_fields(self):
        db = sqlite3.connect(":memory:")
        db.execute("CREATE TABLE projects(id TEXT PRIMARY KEY, name TEXT, description TEXT, updated_at TEXT, downloads_count INTEGER)")
        before = {"id": "p1", "name": "stage", "description": "old", "updated_at": "2026-09-01", "downloads_count": 7}
        after = dict(before, description="line 1\nline 2")
        db.execute("INSERT INTO projects VALUES (?, ?, ?, ?, ?)", tuple(before.values()))
        statement = sync.upsert(db, "projects", after, before)
        self.assertNotIn('"name" =', statement)
        db.executescript(statement)
        self.assertEqual(db.execute("SELECT description FROM projects").fetchone()[0], "line 1\nline 2")

    def test_higher_staging_counter_is_not_rewritten(self):
        db = sqlite3.connect(":memory:")
        db.execute("CREATE TABLE projects(id TEXT PRIMARY KEY, description TEXT, updated_at TEXT, likes_count INTEGER)")
        stage = {"id": "p1", "description": "old", "updated_at": "2026-09-01", "likes_count": 15}
        source = dict(stage, description="new", likes_count=10)
        self.assertEqual(sync.project_changed_fields(dict(stage, description="old", likes_count=10), stage), set())
        self.assertEqual(sync.project_changed_fields(source, stage), {"description"})
        statement = sync.upsert(db, "projects", source, stage)
        self.assertNotIn('"likes_count" =', statement)

    def test_delayed_account_metrics_do_not_hide_batch_usage(self):
        ledger = {"observedRowsWritten24h": 100, "toolRowsWritten": 20}
        self.assertEqual(sync.effective_usage(ledger, {"rows_written_24h": 105}, "Written"), 120)
        self.assertEqual(sync.effective_usage(ledger, {"rows_written_24h": 130}, "Written"), 130)
        ledger["toolRowsWritten"] += 10
        self.assertEqual(sync.effective_usage(ledger, {"rows_written_24h": 130}, "Written"), 140)

    def test_copied_like_does_not_double_count(self):
        db = sqlite3.connect(":memory:")
        db.executescript("""
            CREATE TABLE projects(id TEXT PRIMARY KEY, likes_count INTEGER);
            CREATE TABLE project_likes(project_id TEXT, user_id TEXT,
                created_at TEXT, PRIMARY KEY(project_id, user_id));
            CREATE TRIGGER on_like AFTER INSERT ON project_likes BEGIN
                UPDATE projects SET likes_count = likes_count + 1 WHERE id = NEW.project_id;
            END;
            INSERT INTO projects VALUES ('p1', 10);
            INSERT INTO project_likes VALUES ('p1', 'u1', 'old');
            UPDATE projects SET likes_count = 10;
        """)
        sql = sync.add_like(db, {"project_id": "p1", "user_id": "u2", "created_at": "new"},
                            {"likes_count": 10})
        db.executescript(sql)
        db.executescript(sql)
        self.assertEqual(db.execute("SELECT likes_count FROM projects").fetchone()[0], 10)
        self.assertEqual(db.execute("SELECT COUNT(*) FROM project_likes").fetchone()[0], 2)

    def test_wrangler_file_progress_and_json_metrics(self):
        output = '├ Uploading complete.\n[\n{"success":true,"meta":{"rows_read":2,"rows_written":7}}\n]'
        self.assertEqual(sync.batch_metrics(output), (2, 7))
        with self.assertRaises(SystemExit):
            sync.batch_metrics('[{"success":true,"meta":{"rows_read":2}}]')

    def test_same_size_r2_hash_difference_is_selected(self):
        report = subprocess.CompletedProcess([], 1, "= same\n* changed\n", "1 difference")
        with patch.object(sync.subprocess, "run", return_value=report):
            self.assertEqual(sync.r2_hash_mismatches(Path("."), "stage:bucket", ["same", "changed"]), {"changed"})

    def test_equivalent_reference_ids_are_mapped_without_copying_items(self):
        source = sqlite3.connect(":memory:")
        stage = sqlite3.connect(":memory:")
        for db in (source, stage):
            db.row_factory = sqlite3.Row
            db.executescript("""
                CREATE TABLE character_references(id TEXT, name TEXT);
                CREATE TABLE character_reference_versions(
                    id TEXT, character_reference_id TEXT, version_label TEXT,
                    version_ordinal INTEGER, grace_until TEXT);
                CREATE TABLE character_reference_items(
                    id TEXT, reference_version_id TEXT, kind TEXT,
                    normalized_content_hash TEXT, display_name TEXT,
                    source_key TEXT, name_hash TEXT, structure_hash TEXT,
                    exact_hash TEXT, keys_hash TEXT);
            """)
        source.executescript("""
            INSERT INTO character_references VALUES ('prod-ref', 'same name');
            INSERT INTO character_reference_versions VALUES ('prod-ver', 'prod-ref', '1', 1, 'new');
            INSERT INTO character_reference_items VALUES
                ('prod-item', 'prod-ver', 'regex', 'same-content', 'same item',
                 'key', 'name-hash', 'structure-hash', 'new-exact', 'new-keys');
        """)
        stage.executescript("""
            INSERT INTO character_references VALUES ('stage-ref', 'same name');
            INSERT INTO character_reference_versions VALUES ('stage-ver', 'stage-ref', '1', 1, 'old');
            INSERT INTO character_reference_items VALUES
                ('stage-item', 'stage-ver', 'regex', 'same-content', 'same item',
                 'key', 'name-hash', 'structure-hash', 'old-exact', 'old-keys');
        """)
        refs, versions, items, version_updates, item_updates = sync.reference_mapping(source, stage)
        self.assertEqual((len(version_updates), len(item_updates)), (1, 1))
        mapped = sync.map_project_references({
            "character_reference_id": "prod-ref",
            "built_for_reference_version_id": "prod-ver",
            "tested_through_reference_version_id": "prod-ver",
            "original_conflict_reference_item_ids": '["prod-item"]'}, refs, versions, items)
        self.assertEqual(mapped["character_reference_id"], "stage-ref")
        self.assertEqual(mapped["built_for_reference_version_id"], "stage-ver")
        self.assertEqual(mapped["original_conflict_reference_item_ids"], '["stage-item"]')


    def test_table_policy_covers_current_schema(self):
        schema_path = Path(__file__).resolve().parent.parent / "schema.sql"
        schema = schema_path.read_text(encoding="utf-8")
        names = set(re.findall(
            r"CREATE\s+(?:VIRTUAL\s+)?TABLE(?:\s+IF\s+NOT\s+EXISTS)?\s+([A-Za-z0-9_]+)",
            schema,
            flags=re.IGNORECASE,
        ))
        unclassified = {
            name for name in names
            if name not in sync.TABLE_POLICY
            and not any(name.startswith(prefix) for prefix in sync.DERIVED_TABLE_PREFIXES)
        }
        self.assertEqual(unclassified, set())
        self.assertEqual(sync.TABLE_POLICY["daily_random_draw_state"], "staging-local")
        self.assertEqual(sync.TABLE_POLICY["public_project_counts"], "derived")
        self.assertEqual(sync.TABLE_POLICY["project_like_daily_usage"], "staging-local")
        self.assertEqual(sync.TABLE_POLICY["download_daily_usage"], "staging-local")
        self.assertEqual(sync.TABLE_POLICY["project_ratings"], "copy-interaction")
        self.assertEqual(sync.TABLE_POLICY["devteam_curators"], "copy-curation")
        self.assertEqual(sync.TABLE_POLICY["devteam_recommendations"], "copy-curation")
        self.assertEqual(sync.TABLE_POLICY["site_settings"], "copy-setting")

    def test_staging_schema_may_be_ahead_when_new_columns_have_defaults(self):
        source = sqlite3.connect(":memory:")
        stage = sqlite3.connect(":memory:")
        self.addCleanup(source.close)
        self.addCleanup(stage.close)
        for db in (source, stage):
            db.row_factory = sqlite3.Row
            db.execute("CREATE TABLE users(id TEXT PRIMARY KEY, username TEXT NOT NULL)")
        source.execute(
            "CREATE TABLE projects(id TEXT PRIMARY KEY, author_id TEXT NOT NULL, updated_at TEXT)"
        )
        stage.execute(
            "CREATE TABLE projects("
            "id TEXT PRIMARY KEY, author_id TEXT NOT NULL, updated_at TEXT, "
            "worldbook_ejs_length_estimates TEXT NOT NULL DEFAULT '{}', "
            "discord_thread_url TEXT)"
        )
        missing = sync.validate_table_policy(source, stage)
        self.assertIn("project_ratings", missing)

    def test_source_schema_ahead_of_staging_fails_closed(self):
        source = sqlite3.connect(":memory:")
        stage = sqlite3.connect(":memory:")
        self.addCleanup(source.close)
        self.addCleanup(stage.close)
        for db in (source, stage):
            db.row_factory = sqlite3.Row
            db.execute("CREATE TABLE users(id TEXT PRIMARY KEY, username TEXT NOT NULL)")
        source.execute(
            "CREATE TABLE projects(id TEXT PRIMARY KEY, author_id TEXT NOT NULL, updated_at TEXT, prod_only TEXT)"
        )
        stage.execute(
            "CREATE TABLE projects(id TEXT PRIMARY KEY, author_id TEXT NOT NULL, updated_at TEXT)"
        )
        with self.assertRaises(SystemExit):
            sync.validate_table_policy(source, stage)

    def test_unknown_future_table_fails_closed(self):
        source = sqlite3.connect(":memory:")
        stage = sqlite3.connect(":memory:")
        self.addCleanup(source.close)
        self.addCleanup(stage.close)
        for db in (source, stage):
            db.row_factory = sqlite3.Row
            db.execute("CREATE TABLE users(id TEXT PRIMARY KEY, username TEXT NOT NULL)")
            db.execute("CREATE TABLE projects(id TEXT PRIMARY KEY, author_id TEXT NOT NULL, updated_at TEXT)")
        stage.execute("CREATE TABLE future_feature_state(id TEXT PRIMARY KEY)")
        with self.assertRaises(SystemExit):
            sync.validate_table_policy(source, stage)

    def test_d1_internal_tables_are_ignored_by_schema_gate(self):
        db = sqlite3.connect(":memory:")
        self.addCleanup(db.close)
        db.row_factory = sqlite3.Row
        db.execute("CREATE TABLE users(id TEXT PRIMARY KEY, username TEXT NOT NULL)")
        db.execute("CREATE TABLE projects(id TEXT PRIMARY KEY, author_id TEXT NOT NULL, updated_at TEXT)")
        db.execute("CREATE TABLE d1_migrations(id INTEGER PRIMARY KEY, name TEXT)")
        db.execute("CREATE TABLE _cf_METADATA(key TEXT PRIMARY KEY, value TEXT)")
        self.assertEqual(sync.application_tables(db), {"users", "projects"})

    def test_insert_ignore_preserves_existing_rating(self):
        db = sqlite3.connect(":memory:")
        self.addCleanup(db.close)
        db.row_factory = sqlite3.Row
        db.execute(
            "CREATE TABLE project_ratings("
            "project_id TEXT, user_id TEXT, rating INTEGER, comment_text TEXT, "
            "created_at TEXT, updated_at TEXT, PRIMARY KEY(project_id, user_id))"
        )
        db.execute(
            "INSERT INTO project_ratings VALUES ('p1','u1',5,'stage','a','b')"
        )
        sql = sync.insert_ignore(db, "project_ratings", {
            "project_id": "p1",
            "user_id": "u1",
            "rating": 2,
            "comment_text": "prod",
            "created_at": "a",
            "updated_at": "c",
        })
        db.executescript(sql)
        row = db.execute(
            "SELECT rating, comment_text FROM project_ratings WHERE project_id='p1' AND user_id='u1'"
        ).fetchone()
        self.assertEqual((row["rating"], row["comment_text"]), (5, "stage"))

    def test_newer_curator_content_updates_but_older_source_does_not(self):
        db = sqlite3.connect(":memory:")
        self.addCleanup(db.close)
        db.row_factory = sqlite3.Row
        db.execute(
            "CREATE TABLE devteam_curators("
            "user_id TEXT PRIMARY KEY, title TEXT, updated_at TEXT)"
        )
        db.execute("INSERT INTO devteam_curators VALUES ('u1','stage','2026-09-20')")
        older = {"user_id": "u1", "title": "old", "updated_at": "2026-09-19"}
        db.executescript(sync.upsert_newer(db, "devteam_curators", older, ("user_id",)))
        self.assertEqual(
            db.execute("SELECT title FROM devteam_curators WHERE user_id='u1'").fetchone()["title"],
            "stage",
        )
        newer = {"user_id": "u1", "title": "prod", "updated_at": "2026-09-21"}
        db.executescript(sync.upsert_newer(db, "devteam_curators", newer, ("user_id",)))
        self.assertEqual(
            db.execute("SELECT title FROM devteam_curators WHERE user_id='u1'").fetchone()["title"],
            "prod",
        )

    def test_discover_banner_key_validation(self):
        self.assertEqual(
            sync.discover_banner_image_key({
                "key": "discover_banner",
                "value": '{"imageKey":"site/discover-banner-123.webp"}',
            }),
            "site/discover-banner-123.webp",
        )
        self.assertIsNone(sync.discover_banner_image_key({
            "key": "discover_banner",
            "value": '{"imageKey":null}',
        }))
        with self.assertRaises(SystemExit):
            sync.discover_banner_image_key({
                "key": "discover_banner",
                "value": '{"imageKey":"projects/not-a-banner.webp"}',
            })

    def test_default_policy_margin_covers_heaviest_full_batch(self):
        policy_path = Path(__file__).resolve().parent.parent / "staging-sync.policy.json"
        policy = json.loads(policy_path.read_text(encoding="utf-8"))
        heaviest = max(policy["writeWeights"].values())
        self.assertGreaterEqual(
            policy["d1WriteSafetyMarginPerBatch"],
            heaviest * policy["maxStatementsPerD1Batch"],
        )
        self.assertGreaterEqual(policy["writeWeights"]["projectContent"], 80)


if __name__ == "__main__":
    unittest.main()
