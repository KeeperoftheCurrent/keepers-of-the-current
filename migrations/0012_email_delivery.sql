-- Keep player and Keeper delivery outcomes separate; preserve old aggregate status.
ALTER TABLE registrations ADD COLUMN seeker_email_status TEXT NOT NULL DEFAULT 'pending';
ALTER TABLE registrations ADD COLUMN admin_email_status TEXT NOT NULL DEFAULT 'pending';
ALTER TABLE registrations ADD COLUMN trial_intentions TEXT NOT NULL DEFAULT '[]';
UPDATE registrations SET seeker_email_status = email_status, admin_email_status = email_status;

CREATE TABLE reminder_deliveries (
  delivery_key TEXT PRIMARY KEY NOT NULL,
  seeker_id TEXT NOT NULL REFERENCES seekers(id),
  event_id TEXT NOT NULL REFERENCES events(id),
  status TEXT NOT NULL CHECK(status IN ('sending', 'sent', 'failed')),
  attempted_at INTEGER NOT NULL,
  sent_at INTEGER,
  attempts INTEGER NOT NULL DEFAULT 1
);
