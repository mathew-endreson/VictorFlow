-- 0005_workforce - mobile tasks, proof photos, and the sync bookkeeping.
--
-- Sync design:
--   * pull cursor = change_seq, a monotonic BIGINT drawn from one sequence and bumped by trigger on every
--     insert/update of a synced row. NEVER updated_at (timestamps collide and go backwards; a sequence doesn't).
--   * push uses optimistic concurrency on tasks.version (bumped by trigger on every UPDATE).
--   * every pushed mutation carries a client idempotency key stored in sync_mutations, so a retried request
--     replays the stored result instead of applying twice.

CREATE SEQUENCE workforce.change_seq;

CREATE TABLE workforce.tasks (
  id            uuid         PRIMARY KEY DEFAULT gen_random_uuid(),
  title         text         NOT NULL,
  description   text,
  status        text         NOT NULL DEFAULT 'TODO' CHECK (status IN ('TODO', 'IN_PROGRESS', 'BLOCKED', 'DONE')),
  assigned_to   uuid         REFERENCES core.users(id) ON DELETE SET NULL,
  work_order_id uuid         REFERENCES erp.work_orders(id) ON DELETE SET NULL,
  due_date      date,
  hours_logged  numeric(8,2) NOT NULL DEFAULT 0 CHECK (hours_logged >= 0),
  notes         text,
  version       integer      NOT NULL DEFAULT 1,
  change_seq    bigint       NOT NULL DEFAULT 0,
  deleted_at    timestamptz, -- soft delete: a tombstone must still travel through pull
  created_by    uuid         REFERENCES core.users(id) ON DELETE SET NULL,
  created_at    timestamptz  NOT NULL DEFAULT now(),
  updated_at    timestamptz  NOT NULL DEFAULT now()
);
CREATE INDEX tasks_change_seq_idx ON workforce.tasks (change_seq);
CREATE INDEX tasks_assigned_change_idx ON workforce.tasks (assigned_to, change_seq);
CREATE INDEX tasks_work_order_id_idx ON workforce.tasks (work_order_id) WHERE work_order_id IS NOT NULL;

-- id is supplied by the device (client-generated UUID) so an upload retry is naturally idempotent.
CREATE TABLE workforce.task_proofs (
  id           uuid          PRIMARY KEY,
  task_id      uuid          NOT NULL REFERENCES workforce.tasks(id) ON DELETE CASCADE,
  uploaded_by  uuid          NOT NULL REFERENCES core.users(id),
  storage_key  text          NOT NULL,
  mime_type    text          NOT NULL,
  size_bytes   integer       NOT NULL CHECK (size_bytes > 0),
  latitude     numeric(9,6)  CHECK (latitude BETWEEN -90 AND 90),
  longitude    numeric(9,6)  CHECK (longitude BETWEEN -180 AND 180),
  captured_at  timestamptz,
  change_seq   bigint        NOT NULL DEFAULT 0,
  created_at   timestamptz   NOT NULL DEFAULT now(),
  updated_at   timestamptz   NOT NULL DEFAULT now()
);
CREATE INDEX task_proofs_task_id_idx ON workforce.task_proofs (task_id);
CREATE INDEX task_proofs_change_seq_idx ON workforce.task_proofs (change_seq);

CREATE TABLE workforce.sync_mutations (
  user_id         uuid        NOT NULL REFERENCES core.users(id) ON DELETE CASCADE,
  idempotency_key text        NOT NULL,
  device_id       text,
  entity          text        NOT NULL,
  entity_id       uuid,
  outcome         text        NOT NULL DEFAULT 'PENDING' CHECK (outcome IN ('PENDING', 'APPLIED', 'CONFLICT', 'REJECTED')),
  response        jsonb       NOT NULL DEFAULT '{}'::jsonb,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, idempotency_key)
);

-- Assign change_seq (and bump version on task updates).
--
-- The advisory lock is what makes the cursor SAFE. Without it, tx A can take seq 10, tx B take 11, B commit
-- first, a client pull up to 11 - and A's row (10) is then skipped forever. Holding the lock until commit
-- means sequence order == commit order for synced rows.
-- MVP-NOTE: this serialises writers to synced tables (short transactions, single tenant: fine). At scale,
-- replace with a snapshot-xmin cursor or a logical-decoding outbox.
CREATE FUNCTION workforce.bump_change_seq() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended('workforce.change_seq', 0));
  NEW.change_seq := nextval('workforce.change_seq');
  IF TG_OP = 'UPDATE' AND TG_TABLE_NAME = 'tasks' THEN
    NEW.version := OLD.version + 1;
  END IF;
  RETURN NEW;
END
$$;

CREATE TRIGGER a_bump_change_seq_tasks
  BEFORE INSERT OR UPDATE ON workforce.tasks
  FOR EACH ROW EXECUTE FUNCTION workforce.bump_change_seq();
CREATE TRIGGER a_bump_change_seq_proofs
  BEFORE INSERT OR UPDATE ON workforce.task_proofs
  FOR EACH ROW EXECUTE FUNCTION workforce.bump_change_seq();
