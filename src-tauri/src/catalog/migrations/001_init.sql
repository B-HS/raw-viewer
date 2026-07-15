CREATE TABLE IF NOT EXISTS images (
    id               INTEGER PRIMARY KEY,
    path             TEXT NOT NULL UNIQUE,
    content_key      TEXT,
    edit_state       TEXT,
    edit_version     INTEGER NOT NULL DEFAULT 0,
    sidecar_mtime_ns INTEGER,
    updated_at       INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_images_content_key ON images(content_key);
