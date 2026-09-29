PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS schema_meta (
  key         TEXT PRIMARY KEY,
  value       TEXT NOT NULL,
  updated_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

INSERT INTO schema_meta (key, value)
VALUES ('schema_version', '1')
ON CONFLICT (key) DO NOTHING;

INSERT INTO schema_meta (key, value)
VALUES ('schema_name', 'test-forge')
ON CONFLICT (key) DO NOTHING;

CREATE TABLE IF NOT EXISTS projects (
  project_key    TEXT PRIMARY KEY,
  short_name     TEXT NOT NULL,
  remote_url     TEXT,
  root_path      TEXT NOT NULL,
  scopes_in_use  TEXT NOT NULL DEFAULT '[]',
  created_at     TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE TABLE IF NOT EXISTS codex_versions (
  id                 INTEGER PRIMARY KEY AUTOINCREMENT,
  project_key        TEXT NOT NULL REFERENCES projects (project_key) ON DELETE CASCADE,
  scope              TEXT NOT NULL CHECK (scope IN ('backend', 'frontend')),
  aspect             TEXT NOT NULL,
  rule_id            TEXT NOT NULL,
  version            INTEGER NOT NULL CHECK (version >= 1),
  severity           TEXT NOT NULL CHECK (severity IN ('blocking', 'advisory')),
  mechanization      TEXT NOT NULL CHECK (mechanization IN ('full', 'partial', 'judgment')),
  statement          TEXT NOT NULL,
  rationale          TEXT NOT NULL,
  archaeology        TEXT NOT NULL DEFAULT '',
  applies_when_json  TEXT NOT NULL,
  detect_json        TEXT NOT NULL,
  violates_json      TEXT NOT NULL,
  rubric_json        TEXT NOT NULL DEFAULT '[]',
  verdict_space_json TEXT NOT NULL DEFAULT '["pass","violation","not-applicable"]',
  evidence_json      TEXT NOT NULL DEFAULT '{}',
  decided_by         TEXT NOT NULL,
  created_at         TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  superseded_by      INTEGER REFERENCES codex_versions (id) ON DELETE SET NULL,
  retired_at         TEXT,
  retired_reason     TEXT,
  UNIQUE (project_key, scope, aspect, rule_id, version)
);

CREATE INDEX IF NOT EXISTS idx_codex_current
  ON codex_versions (project_key, scope, aspect, rule_id, version DESC);

CREATE INDEX IF NOT EXISTS idx_codex_live
  ON codex_versions (project_key, retired_at, scope, aspect);

CREATE VIEW IF NOT EXISTS codex_current AS
SELECT c.*
FROM codex_versions c
WHERE c.retired_at IS NULL
  AND c.version = (
    SELECT MAX(v.version)
    FROM codex_versions v
    WHERE v.project_key = c.project_key
      AND v.scope = c.scope
      AND v.aspect = c.aspect
      AND v.rule_id = c.rule_id
      AND v.retired_at IS NULL
  );

CREATE TABLE IF NOT EXISTS taxonomy_ext (
  project_key  TEXT NOT NULL REFERENCES projects (project_key) ON DELETE CASCADE,
  scope        TEXT NOT NULL CHECK (scope IN ('backend', 'frontend')),
  aspect       TEXT NOT NULL,
  applies_when TEXT NOT NULL,
  blocking_bar TEXT NOT NULL,
  created_at   TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  PRIMARY KEY (project_key, scope, aspect)
);

CREATE TABLE IF NOT EXISTS fixtures (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  project_key  TEXT NOT NULL REFERENCES projects (project_key) ON DELETE CASCADE,
  rule_id      TEXT NOT NULL,
  file_path    TEXT NOT NULL,
  file_hash    TEXT NOT NULL,
  label        TEXT NOT NULL CHECK (label IN ('follows', 'violates', 'not-applicable')),
  is_near_miss INTEGER NOT NULL DEFAULT 0 CHECK (is_near_miss IN (0, 1)),
  why          TEXT NOT NULL,
  labelled_by  TEXT NOT NULL,
  created_at   TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE INDEX IF NOT EXISTS idx_fixtures_rule
  ON fixtures (project_key, rule_id, is_near_miss);

CREATE TABLE IF NOT EXISTS acceptance (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  project_key     TEXT NOT NULL REFERENCES projects (project_key) ON DELETE CASCADE,
  rule_id         TEXT NOT NULL,
  rule_version    INTEGER NOT NULL,
  fixture_count   INTEGER NOT NULL DEFAULT 0,
  near_miss_count INTEGER NOT NULL DEFAULT 0,
  score_passed    INTEGER NOT NULL DEFAULT 0,
  score_total     INTEGER NOT NULL DEFAULT 0,
  accepted_at     TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  UNIQUE (project_key, rule_id, rule_version)
);

CREATE TABLE IF NOT EXISTS runs (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  project_key TEXT NOT NULL REFERENCES projects (project_key) ON DELETE CASCADE,
  focus       TEXT NOT NULL,
  scope       TEXT NOT NULL CHECK (scope IN ('backend', 'frontend')),
  started_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  ended_at    TEXT,
  exit_kind   TEXT CHECK (exit_kind IN ('DONE', 'BLOCKED', 'STALLED')),
  exit_reason TEXT
);

CREATE INDEX IF NOT EXISTS idx_runs_project
  ON runs (project_key, started_at DESC);

CREATE TABLE IF NOT EXISTS passes (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  run_id     INTEGER NOT NULL REFERENCES runs (id) ON DELETE CASCADE,
  pass_no    INTEGER NOT NULL CHECK (pass_no >= 1),
  d1         INTEGER NOT NULL DEFAULT 0 CHECK (d1 IN (0, 1)),
  d2         INTEGER NOT NULL DEFAULT 0 CHECK (d2 IN (0, 1)),
  d3         INTEGER NOT NULL DEFAULT 0 CHECK (d3 IN (0, 1)),
  d4         INTEGER NOT NULL DEFAULT 0 CHECK (d4 IN (0, 1)),
  d5         INTEGER NOT NULL DEFAULT 0 CHECK (d5 IN (0, 1)),
  d6         INTEGER NOT NULL DEFAULT 0 CHECK (d6 IN (0, 1)),
  d7         INTEGER NOT NULL DEFAULT 0 CHECK (d7 IN (0, 1)),
  d8         INTEGER NOT NULL DEFAULT 0 CHECK (d8 IN (0, 1)),
  d9         INTEGER NOT NULL DEFAULT 0 CHECK (d9 IN (0, 1)),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  UNIQUE (run_id, pass_no)
);

CREATE TABLE IF NOT EXISTS units (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  run_id          INTEGER NOT NULL REFERENCES runs (id) ON DELETE CASCADE,
  project_key     TEXT NOT NULL REFERENCES projects (project_key) ON DELETE CASCADE,
  file_path       TEXT NOT NULL,
  author_callsign TEXT NOT NULL,
  state           TEXT NOT NULL DEFAULT 'assigned'
    CHECK (state IN ('assigned', 'drafted', 'reviewed', 'revised', 'accepted', 'abandoned')),
  UNIQUE (run_id, file_path)
);

CREATE INDEX IF NOT EXISTS idx_units_run
  ON units (run_id, state);

CREATE TABLE IF NOT EXISTS findings (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  project_key  TEXT NOT NULL REFERENCES projects (project_key) ON DELETE CASCADE,
  run_id       INTEGER NOT NULL REFERENCES runs (id) ON DELETE CASCADE,
  finding_key  TEXT NOT NULL,
  severity     TEXT NOT NULL CHECK (severity IN ('blocking', 'advisory')),
  title        TEXT NOT NULL,
  location     TEXT NOT NULL,
  evidence     TEXT NOT NULL,
  proposed_fix TEXT NOT NULL DEFAULT '',
  status       TEXT NOT NULL DEFAULT 'open'
    CHECK (status IN ('open', 'fixed', 'waived', 'confirmed-defect', 'confirmed-but-known', 'rejected', 'superseded')),
  created_at   TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  UNIQUE (run_id, finding_key)
);

CREATE INDEX IF NOT EXISTS idx_findings_key
  ON findings (finding_key);

CREATE INDEX IF NOT EXISTS idx_findings_status
  ON findings (project_key, status, created_at DESC);

CREATE TABLE IF NOT EXISTS verdicts (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  run_id         INTEGER NOT NULL REFERENCES runs (id) ON DELETE CASCADE,
  project_key    TEXT NOT NULL REFERENCES projects (project_key) ON DELETE CASCADE,
  subject_kind   TEXT NOT NULL CHECK (subject_kind IN ('file', 'test', 'finding', 'mutant', 'matrix-cell', 'radius-node', 'focus-item')),
  subject_ref    TEXT NOT NULL,
  agent_callsign TEXT NOT NULL,
  post           TEXT NOT NULL,
  rule_id        TEXT,
  verdict        TEXT NOT NULL CHECK (verdict IN ('pass', 'violation', 'not-applicable', 'confirmed-defect', 'confirmed-but-known', 'not-a-defect')),
  rubric_json    TEXT NOT NULL DEFAULT '[]',
  sites_json     TEXT NOT NULL DEFAULT '[]',
  created_at     TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE INDEX IF NOT EXISTS idx_verdicts_subject
  ON verdicts (run_id, subject_kind, subject_ref);

CREATE INDEX IF NOT EXISTS idx_verdicts_rule
  ON verdicts (project_key, rule_id, verdict);

CREATE TABLE IF NOT EXISTS overturns (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  project_key     TEXT NOT NULL REFERENCES projects (project_key) ON DELETE CASCADE,
  verdict_id      INTEGER NOT NULL REFERENCES verdicts (id) ON DELETE CASCADE,
  overturned_by   TEXT NOT NULL,
  correct_verdict TEXT NOT NULL,
  reason          TEXT NOT NULL,
  created_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE INDEX IF NOT EXISTS idx_overturns_verdict
  ON overturns (verdict_id);

CREATE TABLE IF NOT EXISTS waivers (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  project_key TEXT NOT NULL REFERENCES projects (project_key) ON DELETE CASCADE,
  run_id      INTEGER NOT NULL REFERENCES runs (id) ON DELETE CASCADE,
  kind        TEXT NOT NULL CHECK (kind IN ('matrix-cell', 'radius-node', 'focus-line', 'rule', 'mutant', 'finding', 'test-value')),
  ref         TEXT NOT NULL,
  reason      TEXT NOT NULL,
  signed_by   TEXT NOT NULL,
  created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  UNIQUE (run_id, kind, ref)
);

CREATE TABLE IF NOT EXISTS mutants (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  project_key TEXT NOT NULL REFERENCES projects (project_key) ON DELETE CASCADE,
  run_id      INTEGER NOT NULL REFERENCES runs (id) ON DELETE CASCADE,
  file_path   TEXT NOT NULL,
  line        INTEGER NOT NULL,
  operator    TEXT NOT NULL,
  before_text TEXT NOT NULL,
  after_text  TEXT NOT NULL,
  outcome     TEXT NOT NULL DEFAULT 'pending'
    CHECK (outcome IN ('pending', 'killed', 'survived', 'equivalent-claimed', 'equivalent-signed', 'refuted', 'error', 'timeout', 'unviable'))
);

CREATE INDEX IF NOT EXISTS idx_mutants_run
  ON mutants (run_id, outcome);

CREATE INDEX IF NOT EXISTS idx_mutants_file
  ON mutants (project_key, file_path, line);

CREATE TABLE IF NOT EXISTS kills (
  id        INTEGER PRIMARY KEY AUTOINCREMENT,
  mutant_id INTEGER NOT NULL REFERENCES mutants (id) ON DELETE CASCADE,
  test_name TEXT NOT NULL,
  file_path TEXT NOT NULL,
  UNIQUE (mutant_id, test_name, file_path)
);

CREATE INDEX IF NOT EXISTS idx_kills_test
  ON kills (file_path, test_name);

CREATE TABLE IF NOT EXISTS equivalence_claims (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  mutant_id   INTEGER NOT NULL REFERENCES mutants (id) ON DELETE CASCADE,
  claimed_by  TEXT NOT NULL,
  argument    TEXT NOT NULL,
  refuted_by  TEXT,
  refutation  TEXT,
  upheld      INTEGER CHECK (upheld IN (0, 1)),
  signed_by   TEXT,
  created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE INDEX IF NOT EXISTS idx_equivalence_mutant
  ON equivalence_claims (mutant_id);

CREATE TABLE IF NOT EXISTS coverage_cells (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  project_key TEXT NOT NULL REFERENCES projects (project_key) ON DELETE CASCADE,
  run_id      INTEGER NOT NULL REFERENCES runs (id) ON DELETE CASCADE,
  matrix_key  TEXT NOT NULL,
  row_key     TEXT NOT NULL,
  column_key  TEXT NOT NULL,
  state       TEXT NOT NULL DEFAULT 'empty'
    CHECK (state IN ('empty', 'covered', 'waived', 'not-applicable')),
  test_ref    TEXT,
  UNIQUE (run_id, matrix_key, row_key, column_key)
);

CREATE TABLE IF NOT EXISTS radius_nodes (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  project_key  TEXT NOT NULL REFERENCES projects (project_key) ON DELETE CASCADE,
  run_id       INTEGER NOT NULL REFERENCES runs (id) ON DELETE CASCADE,
  node_ref     TEXT NOT NULL,
  node_kind    TEXT NOT NULL,
  resolution   TEXT NOT NULL DEFAULT 'unresolved'
    CHECK (resolution IN ('unresolved', 'existing-test', 'new-case', 'waived')),
  cited_test   TEXT,
  verified_by  TEXT,
  UNIQUE (run_id, node_ref)
);

CREATE TABLE IF NOT EXISTS focus_items (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  project_key TEXT NOT NULL REFERENCES projects (project_key) ON DELETE CASCADE,
  run_id      INTEGER NOT NULL REFERENCES runs (id) ON DELETE CASCADE,
  line_no     INTEGER NOT NULL,
  text        TEXT NOT NULL,
  resolution  TEXT NOT NULL DEFAULT 'unmapped'
    CHECK (resolution IN ('unmapped', 'mapped', 'waived')),
  test_ref    TEXT,
  UNIQUE (run_id, line_no)
);

CREATE TABLE IF NOT EXISTS war_games (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  project_key      TEXT NOT NULL REFERENCES projects (project_key) ON DELETE CASCADE,
  scenario_key     TEXT NOT NULL,
  squad            TEXT NOT NULL,
  post             TEXT NOT NULL,
  aspect           TEXT NOT NULL,
  engagement_json  TEXT NOT NULL,
  what_happened    TEXT NOT NULL,
  what_was_correct TEXT NOT NULL,
  root_cause       TEXT NOT NULL,
  status           TEXT NOT NULL DEFAULT 'open'
    CHECK (status IN ('open', 'drilled', 'passing', 'retired')),
  created_at       TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  UNIQUE (project_key, scenario_key)
);

CREATE INDEX IF NOT EXISTS idx_war_games_status
  ON war_games (project_key, status);

CREATE TABLE IF NOT EXISTS replays (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  scenario_id INTEGER NOT NULL REFERENCES war_games (id) ON DELETE CASCADE,
  result      TEXT NOT NULL CHECK (result IN ('caught', 'missed', 'error', 'skipped')),
  note        TEXT NOT NULL DEFAULT '',
  created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE INDEX IF NOT EXISTS idx_replays_scenario
  ON replays (scenario_id, created_at DESC);

CREATE TABLE IF NOT EXISTS outcomes (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  project_key TEXT NOT NULL REFERENCES projects (project_key) ON DELETE CASCADE,
  run_id      INTEGER REFERENCES runs (id) ON DELETE SET NULL,
  callsign    TEXT NOT NULL,
  post        TEXT NOT NULL,
  aspect      TEXT NOT NULL DEFAULT '',
  event_kind  TEXT NOT NULL,
  weight      REAL NOT NULL DEFAULT 1.0,
  created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE INDEX IF NOT EXISTS idx_outcomes_agent
  ON outcomes (project_key, callsign, post, aspect, created_at);

CREATE TABLE IF NOT EXISTS ranks (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  project_key TEXT NOT NULL REFERENCES projects (project_key) ON DELETE CASCADE,
  callsign    TEXT NOT NULL,
  post        TEXT NOT NULL,
  aspect      TEXT NOT NULL DEFAULT '',
  rank        TEXT NOT NULL,
  score       REAL NOT NULL DEFAULT 0.0,
  trend       TEXT NOT NULL DEFAULT 'flat' CHECK (trend IN ('up', 'flat', 'down')),
  updated_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  UNIQUE (project_key, callsign, post, aspect)
);

CREATE INDEX IF NOT EXISTS idx_ranks_board
  ON ranks (project_key, score DESC);
