CREATE TABLE IF NOT EXISTS presets (
    id          TEXT PRIMARY KEY,
    name        TEXT NOT NULL,
    folder      TEXT NOT NULL DEFAULT '',
    edit_state  TEXT NOT NULL,
    field_mask  TEXT NOT NULL,
    source      TEXT NOT NULL,
    builtin     INTEGER NOT NULL DEFAULT 0,
    created_at  INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_presets_folder ON presets(folder);
CREATE INDEX IF NOT EXISTS idx_presets_builtin ON presets(builtin);
