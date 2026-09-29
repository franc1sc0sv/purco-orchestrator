CREATE TABLE usage_records (
  id                 INTEGER PRIMARY KEY AUTOINCREMENT,
  project_key        TEXT NOT NULL,
  run_id             INTEGER NOT NULL REFERENCES runs (id),
  cycle              INTEGER NOT NULL,
  callsign           TEXT NOT NULL,
  model              TEXT NOT NULL,
  input_tokens       INTEGER NOT NULL DEFAULT 0,
  output_tokens      INTEGER NOT NULL DEFAULT 0,
  cache_read_tokens  INTEGER NOT NULL DEFAULT 0,
  cache_write_tokens INTEGER NOT NULL DEFAULT 0,
  cost_usd           REAL NOT NULL DEFAULT 0,
  created_at         TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE INDEX usage_records_run_idx ON usage_records (run_id, callsign);

ALTER TABLE runs ADD COLUMN depth TEXT NOT NULL DEFAULT 'full'
  CHECK (depth IN ('full', 'quick'));
