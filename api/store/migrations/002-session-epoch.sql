-- A user's sessions can be ended (salish-9uu.3.3, from review): each session cookie
-- carries the user's epoch when it was minted, and is good only while the epoch is
-- unchanged. Signing out moves it, which ends every session that user has, on every
-- device, including one a stolen cookie would otherwise keep alive for thirty days.
ALTER TABLE users ADD COLUMN session_epoch INTEGER NOT NULL DEFAULT 0;
