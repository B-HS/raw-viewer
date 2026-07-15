CREATE TABLE IF NOT EXISTS recents (
    path       TEXT PRIMARY KEY,
    opened_at  INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_recents_time ON recents(opened_at DESC);
