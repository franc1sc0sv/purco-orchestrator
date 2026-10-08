CREATE TABLE mutants_rebuilt (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  project_key     TEXT NOT NULL REFERENCES projects (project_key) ON DELETE CASCADE,
  run_id          INTEGER NOT NULL REFERENCES runs (id) ON DELETE CASCADE,
  file_path       TEXT NOT NULL,
  line            INTEGER NOT NULL,
  operator        TEXT NOT NULL,
  before_text     TEXT NOT NULL,
  after_text      TEXT NOT NULL,
  outcome         TEXT NOT NULL DEFAULT 'pending'
    CHECK (outcome IN ('pending', 'killed', 'survived', 'equivalent-claimed', 'equivalent-signed', 'refuted', 'error', 'timeout', 'unviable', 'no_coverage', 'timeout_pending', 'out_of_scope', 'killed_by_timeout')),
  engine          TEXT NOT NULL DEFAULT 'generator'
    CHECK (engine IN ('generator', 'stryker')),
  start_column    INTEGER,
  end_line        INTEGER,
  end_column      INTEGER,
  stryker_status  TEXT,
  covered_by_json TEXT NOT NULL DEFAULT '[]'
);

INSERT INTO mutants_rebuilt (id, project_key, run_id, file_path, line, operator, before_text, after_text, outcome, engine, start_column, end_line, end_column, stryker_status, covered_by_json)
  SELECT id, project_key, run_id, file_path, line, operator, before_text, after_text, outcome, engine, start_column, end_line, end_column, stryker_status, covered_by_json
    FROM mutants;

DROP TABLE mutants;

ALTER TABLE mutants_rebuilt RENAME TO mutants;

CREATE INDEX IF NOT EXISTS idx_mutants_run
  ON mutants (run_id, outcome);

CREATE INDEX IF NOT EXISTS idx_mutants_file
  ON mutants (project_key, file_path, line);

CREATE UNIQUE INDEX IF NOT EXISTS idx_mutants_stryker_site
  ON mutants (run_id, file_path, line, start_column, end_line, end_column, operator, after_text)
  WHERE engine = 'stryker';
