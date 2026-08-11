CREATE TABLE IF NOT EXISTS campaigns (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  root_path      TEXT NOT NULL,
  base_dir       TEXT NOT NULL,
  manifest_path  TEXT NOT NULL,
  boot_log_path  TEXT NOT NULL DEFAULT '',
  boot_pid       INTEGER,
  concurrency    INTEGER NOT NULL DEFAULT 1,
  state          TEXT NOT NULL DEFAULT 'starting'
    CHECK (state IN ('starting', 'ready', 'stopping', 'stopped', 'failed')),
  detail         TEXT NOT NULL DEFAULT '',
  started_at     TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  ended_at       TEXT
);

CREATE INDEX IF NOT EXISTS idx_campaigns_state
  ON campaigns (state, started_at DESC);

CREATE TABLE IF NOT EXISTS campaign_lanes (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  campaign_id    INTEGER NOT NULL REFERENCES campaigns (id) ON DELETE CASCADE,
  lane_no        INTEGER NOT NULL,
  worktree_path  TEXT NOT NULL,
  cache_dir      TEXT NOT NULL,
  config_path    TEXT NOT NULL,
  state          TEXT NOT NULL DEFAULT 'idle'
    CHECK (state IN ('idle', 'busy', 'broken')),
  mutants_run    INTEGER NOT NULL DEFAULT 0,
  UNIQUE (campaign_id, lane_no)
);

CREATE TABLE IF NOT EXISTS mutant_attempts (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  campaign_id    INTEGER REFERENCES campaigns (id) ON DELETE SET NULL,
  mutant_id      INTEGER NOT NULL REFERENCES mutants (id) ON DELETE CASCADE,
  lane_no        INTEGER NOT NULL DEFAULT 0,
  attempt        INTEGER NOT NULL DEFAULT 1,
  outcome        TEXT NOT NULL,
  infrastructure INTEGER NOT NULL DEFAULT 0,
  duration_ms    INTEGER NOT NULL DEFAULT 0,
  reason         TEXT NOT NULL DEFAULT '',
  created_at     TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE INDEX IF NOT EXISTS idx_mutant_attempts_mutant
  ON mutant_attempts (mutant_id, created_at);

CREATE INDEX IF NOT EXISTS idx_mutant_attempts_campaign
  ON mutant_attempts (campaign_id, outcome);
