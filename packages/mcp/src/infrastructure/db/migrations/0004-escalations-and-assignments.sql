CREATE TABLE IF NOT EXISTS escalations (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  project_key     TEXT NOT NULL REFERENCES projects (project_key) ON DELETE CASCADE,
  run_id          INTEGER NOT NULL REFERENCES runs (id) ON DELETE CASCADE,
  escalation_key  TEXT NOT NULL,
  raised_by       TEXT NOT NULL,
  post            TEXT NOT NULL,
  subject_kind    TEXT NOT NULL
    CHECK (subject_kind IN ('rule', 'file', 'test', 'finding', 'mutant', 'matrix-cell', 'radius-node', 'focus-item', 'assignment', 'instruction')),
  subject_ref     TEXT NOT NULL,
  claim           TEXT NOT NULL,
  evidence        TEXT NOT NULL,
  state           TEXT NOT NULL DEFAULT 'open' CHECK (state IN ('open', 'resolved')),
  resolution      TEXT CHECK (resolution IN ('fixed', 'rule-changed', 'waived', 'rejected')),
  resolved_by     TEXT,
  resolved_reason TEXT,
  resolved_at     TEXT,
  created_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  UNIQUE (run_id, escalation_key),
  CHECK (length(trim(escalation_key)) > 0),
  CHECK (length(trim(raised_by)) > 0),
  CHECK (length(trim(claim)) > 0),
  CHECK (length(trim(evidence)) > 0),
  CHECK (
    (state = 'open'
      AND resolution IS NULL
      AND resolved_by IS NULL
      AND resolved_reason IS NULL
      AND resolved_at IS NULL)
    OR
    (state = 'resolved'
      AND resolution IS NOT NULL
      AND resolved_by IS NOT NULL AND length(trim(resolved_by)) > 0
      AND resolved_reason IS NOT NULL AND length(trim(resolved_reason)) > 0
      AND resolved_at IS NOT NULL)
  )
);

CREATE INDEX IF NOT EXISTS idx_escalations_open
  ON escalations (project_key, run_id, state);

CREATE TABLE IF NOT EXISTS assignments (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  project_key     TEXT NOT NULL REFERENCES projects (project_key) ON DELETE CASCADE,
  run_id          INTEGER NOT NULL REFERENCES runs (id) ON DELETE CASCADE,
  assignment_key  TEXT NOT NULL,
  suggested_post  TEXT NOT NULL,
  assigned_post   TEXT NOT NULL,
  assigned_to     TEXT NOT NULL,
  subject_kind    TEXT NOT NULL
    CHECK (subject_kind IN ('rule', 'file', 'test', 'finding', 'mutant', 'matrix-cell', 'radius-node', 'focus-item', 'assignment', 'instruction')),
  subject_ref     TEXT NOT NULL,
  instruction     TEXT NOT NULL,
  override_by     TEXT,
  override_reason TEXT,
  outcome_kind    TEXT CHECK (outcome_kind IN ('delivered', 'blocked', 'out-of-scope', 'disputed', 'failed')),
  outcome_json    TEXT,
  escalation_id   INTEGER REFERENCES escalations (id) ON DELETE CASCADE,
  created_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  completed_at    TEXT,
  UNIQUE (run_id, assignment_key),
  CHECK (length(trim(assignment_key)) > 0),
  CHECK (length(trim(instruction)) > 0),
  CHECK (
    assigned_post = suggested_post
    OR (override_by IS NOT NULL AND length(trim(override_by)) > 0
        AND override_reason IS NOT NULL AND length(trim(override_reason)) > 0)
  ),
  CHECK (
    (outcome_kind IS NULL AND outcome_json IS NULL AND completed_at IS NULL)
    OR (outcome_kind IS NOT NULL AND outcome_json IS NOT NULL AND completed_at IS NOT NULL)
  ),
  CHECK (outcome_kind NOT IN ('blocked', 'disputed') OR escalation_id IS NOT NULL)
);

CREATE INDEX IF NOT EXISTS idx_assignments_run
  ON assignments (project_key, run_id, outcome_kind);

ALTER TABLE passes ADD COLUMN d10 INTEGER NOT NULL DEFAULT 0 CHECK (d10 IN (0, 1));
