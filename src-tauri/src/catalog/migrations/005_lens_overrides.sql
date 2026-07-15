CREATE TABLE IF NOT EXISTS lens_overrides (
    lens_key    TEXT PRIMARY KEY,
    profile_id  TEXT NOT NULL,
    updated_at  INTEGER NOT NULL
);
