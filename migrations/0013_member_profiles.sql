-- Faith membership is granted by the Keeper, independently of trial registration.
CREATE TABLE member_profiles (
 id TEXT PRIMARY KEY,
 seeker_id TEXT NOT NULL UNIQUE REFERENCES seekers(id),
 active INTEGER NOT NULL DEFAULT 1 CHECK(active IN (0,1)),
 draft TEXT NOT NULL DEFAULT '{}',
 published TEXT,
 revision INTEGER NOT NULL DEFAULT 0,
 submitted_revision INTEGER,
 reviewed_at INTEGER,
 review_note TEXT NOT NULL DEFAULT '',
 leadership INTEGER NOT NULL DEFAULT 0 CHECK(leadership IN (0,1)),
 updated_at INTEGER NOT NULL
);
CREATE TABLE member_portraits (
 id TEXT PRIMARY KEY,
 member_id TEXT NOT NULL REFERENCES member_profiles(id),
 jpeg TEXT NOT NULL,
 created_at INTEGER NOT NULL
);
CREATE INDEX member_portraits_owner ON member_portraits(member_id);
