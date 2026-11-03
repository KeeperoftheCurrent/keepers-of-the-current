CREATE TABLE chronicles (
 id TEXT PRIMARY KEY,
 draft TEXT NOT NULL,
 published TEXT,
 revision INTEGER NOT NULL DEFAULT 1,
 updated_at INTEGER NOT NULL
);
