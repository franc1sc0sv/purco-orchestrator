ALTER TABLE kills ADD COLUMN attribution_complete INTEGER NOT NULL DEFAULT 0
  CHECK (attribution_complete IN (0, 1));
