-- 0010_licence_seats - which app each session was opened from, so licence seats can be counted per kind.
--
-- A licence grants a number of desktop seats (company PCs signed in at the same time) and of mobile users (people
-- signed in on the mobile app). A session is a family of refresh tokens; every token of a family carries the
-- client of the sign-in that started it. Sessions that existed before this migration are counted as desktop.

ALTER TABLE core.refresh_tokens
  ADD COLUMN client text NOT NULL DEFAULT 'desktop' CHECK (client IN ('desktop', 'mobile'));

-- The seat counts look at live tokens of one kind: not revoked, not expired, recently created.
CREATE INDEX refresh_tokens_live_by_client_idx ON core.refresh_tokens (client, expires_at) WHERE revoked_at IS NULL;
