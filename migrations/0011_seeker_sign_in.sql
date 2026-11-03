CREATE TABLE seeker_sign_ins (
  token_hash TEXT PRIMARY KEY NOT NULL,
  seeker_id TEXT NOT NULL REFERENCES seekers(id) ON DELETE CASCADE,
  requester_ip TEXT NOT NULL,
  requested_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  is_session INTEGER NOT NULL DEFAULT 0 CHECK (is_session IN (0, 1))
);
CREATE INDEX idx_seeker_sign_ins_seeker ON seeker_sign_ins(seeker_id, requested_at);
CREATE INDEX idx_seeker_sign_ins_ip ON seeker_sign_ins(requester_ip, requested_at);
CREATE INDEX idx_seeker_sign_ins_expiry ON seeker_sign_ins(expires_at);
