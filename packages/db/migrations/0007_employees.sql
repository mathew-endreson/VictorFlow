-- 0007_employees - staff attendance, and a direct order_id on tasks.
--
-- No new "employee" table: a user already IS the employee record (core.users). Attendance and roles are
-- both scoped to that same identity, matching the rest of the schema rather than forking a parallel concept.

CREATE TABLE workforce.attendance (
  id         uuid         PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    uuid         NOT NULL REFERENCES core.users(id) ON DELETE CASCADE,
  date       date         NOT NULL,
  clock_in   timestamptz,
  clock_out  timestamptz,
  notes      text,
  created_by uuid         REFERENCES core.users(id) ON DELETE SET NULL,
  created_at timestamptz  NOT NULL DEFAULT now(),
  updated_at timestamptz  NOT NULL DEFAULT now(),
  CHECK (clock_in IS NULL OR clock_out IS NULL OR clock_out > clock_in),
  UNIQUE (user_id, date)
);
CREATE INDEX attendance_user_date_idx ON workforce.attendance (user_id, date);
-- 0006_audit.sql's generic "attach trg_set_updated_at to every table with an updated_at column" DO-block
-- already ran, so a table created after it needs the trigger attached explicitly.
CREATE TRIGGER trg_set_updated_at BEFORE UPDATE ON workforce.attendance FOR EACH ROW EXECUTE FUNCTION core.set_updated_at();

SELECT audit.attach('workforce', 'attendance');

-- Tasks: order-level linkage alongside the existing (optional) work_order_id, so a task can represent
-- general work on an order without needing a formal production work order.
ALTER TABLE workforce.tasks ADD COLUMN order_id uuid REFERENCES erp.orders(id) ON DELETE SET NULL;
CREATE INDEX tasks_order_id_idx ON workforce.tasks (order_id) WHERE order_id IS NOT NULL;
