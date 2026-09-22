-- 0002_crm_erp - customers/contacts, quotes/orders, production + the configurable FSM tables.

-- -- CRM ----------------------------------------------------------------------

CREATE TABLE crm.customers (
  id            uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  code          text        NOT NULL UNIQUE DEFAULT core.next_doc_no('CUS'),
  name          text        NOT NULL,
  customer_type text        NOT NULL DEFAULT 'COMPANY' CHECK (customer_type IN ('COMPANY', 'INDIVIDUAL')),
  -- Algerian fiscal identifiers
  nif           text,
  nis           text,
  rc            text,
  ai            text,
  email         text,
  phone         text,
  address       text,
  wilaya        text,
  city          text,
  custom_fields jsonb       NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(custom_fields) = 'object'),
  is_active     boolean     NOT NULL DEFAULT true,
  created_by    uuid        REFERENCES core.users(id) ON DELETE SET NULL,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX customers_name_idx ON crm.customers (lower(name));
CREATE INDEX customers_custom_fields_gin ON crm.customers USING GIN (custom_fields);

CREATE TABLE crm.contacts (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id uuid        NOT NULL REFERENCES crm.customers(id) ON DELETE CASCADE,
  full_name   text        NOT NULL,
  job_title   text,
  email       text,
  phone       text,
  is_primary  boolean     NOT NULL DEFAULT false,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX contacts_customer_id_idx ON crm.contacts (customer_id);

-- -- Sales: quotes ------------------------------------------------------------

CREATE TABLE erp.quotes (
  id                 uuid          PRIMARY KEY DEFAULT gen_random_uuid(),
  number             text          NOT NULL UNIQUE DEFAULT core.next_doc_no('QUO', current_date),
  customer_id        uuid          NOT NULL REFERENCES crm.customers(id),
  status             text          NOT NULL DEFAULT 'DRAFT' CHECK (status IN ('DRAFT', 'SENT', 'ACCEPTED', 'REJECTED', 'CONVERTED')),
  quote_date         date          NOT NULL DEFAULT current_date,
  valid_until        date,
  notes              text,
  total_ht           numeric(15,4) NOT NULL DEFAULT 0 CHECK (total_ht >= 0),
  total_tva          numeric(15,4) NOT NULL DEFAULT 0 CHECK (total_tva >= 0),
  total_ttc          numeric(15,4) NOT NULL DEFAULT 0 CHECK (total_ttc >= 0),
  converted_order_id uuid,
  created_by         uuid          REFERENCES core.users(id) ON DELETE SET NULL,
  created_at         timestamptz   NOT NULL DEFAULT now(),
  updated_at         timestamptz   NOT NULL DEFAULT now()
);
CREATE INDEX quotes_customer_id_idx ON erp.quotes (customer_id);
CREATE INDEX quotes_status_idx ON erp.quotes (status);

CREATE TABLE erp.quote_items (
  id           uuid          PRIMARY KEY DEFAULT gen_random_uuid(),
  quote_id     uuid          NOT NULL REFERENCES erp.quotes(id) ON DELETE CASCADE,
  position     integer       NOT NULL,
  description  text          NOT NULL,
  unit         text          NOT NULL DEFAULT 'u',
  quantity     numeric(15,4) NOT NULL CHECK (quantity > 0),
  unit_price   numeric(15,4) NOT NULL CHECK (unit_price >= 0),
  discount_pct numeric(5,2)  NOT NULL DEFAULT 0 CHECK (discount_pct BETWEEN 0 AND 100),
  tva_rate     numeric(5,2)  NOT NULL DEFAULT 19.00 CHECK (tva_rate BETWEEN 0 AND 100),
  line_ht      numeric(15,4) NOT NULL,
  line_tva     numeric(15,4) NOT NULL,
  line_ttc     numeric(15,4) NOT NULL,
  created_at   timestamptz   NOT NULL DEFAULT now(),
  updated_at   timestamptz   NOT NULL DEFAULT now()
);
CREATE INDEX quote_items_quote_id_idx ON erp.quote_items (quote_id);

-- -- Sales: orders ------------------------------------------------------------

CREATE TABLE erp.orders (
  id           uuid          PRIMARY KEY DEFAULT gen_random_uuid(),
  number       text          NOT NULL UNIQUE DEFAULT core.next_doc_no('ORD', current_date),
  customer_id  uuid          NOT NULL REFERENCES crm.customers(id),
  quote_id     uuid          REFERENCES erp.quotes(id),
  status       text          NOT NULL DEFAULT 'DRAFT' CHECK (status IN ('DRAFT', 'CONFIRMED', 'IN_PRODUCTION', 'COMPLETED', 'CANCELLED')),
  order_date   date          NOT NULL DEFAULT current_date,
  due_date     date,
  notes        text,
  total_ht     numeric(15,4) NOT NULL DEFAULT 0 CHECK (total_ht >= 0),
  total_tva    numeric(15,4) NOT NULL DEFAULT 0 CHECK (total_tva >= 0),
  total_ttc    numeric(15,4) NOT NULL DEFAULT 0 CHECK (total_ttc >= 0),
  confirmed_at timestamptz,
  confirmed_by uuid          REFERENCES core.users(id) ON DELETE SET NULL,
  completed_at timestamptz,
  created_by   uuid          REFERENCES core.users(id) ON DELETE SET NULL,
  created_at   timestamptz   NOT NULL DEFAULT now(),
  updated_at   timestamptz   NOT NULL DEFAULT now()
);
CREATE INDEX orders_customer_id_idx ON erp.orders (customer_id);
CREATE INDEX orders_status_idx ON erp.orders (status);
CREATE INDEX orders_quote_id_idx ON erp.orders (quote_id) WHERE quote_id IS NOT NULL;

ALTER TABLE erp.quotes
  ADD CONSTRAINT quotes_converted_order_fk FOREIGN KEY (converted_order_id) REFERENCES erp.orders(id);

CREATE TABLE erp.order_items (
  id           uuid          PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id     uuid          NOT NULL REFERENCES erp.orders(id) ON DELETE CASCADE,
  position     integer       NOT NULL,
  description  text          NOT NULL,
  unit         text          NOT NULL DEFAULT 'u',
  quantity     numeric(15,4) NOT NULL CHECK (quantity > 0),
  unit_price   numeric(15,4) NOT NULL CHECK (unit_price >= 0),
  discount_pct numeric(5,2)  NOT NULL DEFAULT 0 CHECK (discount_pct BETWEEN 0 AND 100),
  tva_rate     numeric(5,2)  NOT NULL DEFAULT 19.00 CHECK (tva_rate BETWEEN 0 AND 100),
  line_ht      numeric(15,4) NOT NULL,
  line_tva     numeric(15,4) NOT NULL,
  line_ttc     numeric(15,4) NOT NULL,
  created_at   timestamptz   NOT NULL DEFAULT now(),
  updated_at   timestamptz   NOT NULL DEFAULT now()
);
CREATE INDEX order_items_order_id_idx ON erp.order_items (order_id);

-- -- Production ---------------------------------------------------------------

-- Master list of workshop stages. Confirming an order creates one work order per auto_create stage.
CREATE TABLE erp.production_stages (
  id            uuid         PRIMARY KEY DEFAULT gen_random_uuid(),
  code          text         NOT NULL UNIQUE,
  name          text         NOT NULL,
  position      integer      NOT NULL,
  auto_create   boolean      NOT NULL DEFAULT true,
  default_hours numeric(8,2) NOT NULL DEFAULT 1,
  created_at    timestamptz  NOT NULL DEFAULT now(),
  updated_at    timestamptz  NOT NULL DEFAULT now()
);

-- status is deliberately NOT constrained by a CHECK: the legal states live in erp.fsm_states and the
-- engine validates against them, so the workflow can be reconfigured without a migration.
CREATE TABLE erp.production_orders (
  id               uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  number           text        NOT NULL UNIQUE DEFAULT core.next_doc_no('PRD', current_date),
  order_id         uuid        NOT NULL UNIQUE REFERENCES erp.orders(id),
  status           text        NOT NULL DEFAULT 'DRAFT',
  priority         integer     NOT NULL DEFAULT 3 CHECK (priority BETWEEN 1 AND 5),
  due_date         date,
  notes            text,
  rejection_reason text,
  created_by       uuid        REFERENCES core.users(id) ON DELETE SET NULL,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX production_orders_status_idx ON erp.production_orders (status);

-- Append-only history of state changes; feeds the public tracking timeline.
CREATE TABLE erp.production_order_events (
  id                  bigint      GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  production_order_id uuid        NOT NULL REFERENCES erp.production_orders(id) ON DELETE CASCADE,
  from_status         text,
  to_status           text        NOT NULL,
  actor_id            uuid        REFERENCES core.users(id) ON DELETE SET NULL,
  note                text,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX production_order_events_po_idx ON erp.production_order_events (production_order_id, id);

CREATE TABLE erp.work_orders (
  id                  uuid         PRIMARY KEY DEFAULT gen_random_uuid(),
  production_order_id uuid         NOT NULL REFERENCES erp.production_orders(id) ON DELETE CASCADE,
  stage_id            uuid         NOT NULL REFERENCES erp.production_stages(id),
  title               text         NOT NULL,
  status              text         NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED')),
  assigned_to         uuid         REFERENCES core.users(id) ON DELETE SET NULL,
  planned_hours       numeric(8,2) NOT NULL DEFAULT 0,
  actual_hours        numeric(8,2) NOT NULL DEFAULT 0 CHECK (actual_hours >= 0),
  started_at          timestamptz,
  completed_at        timestamptz,
  created_at          timestamptz  NOT NULL DEFAULT now(),
  updated_at          timestamptz  NOT NULL DEFAULT now()
);
CREATE INDEX work_orders_production_order_id_idx ON erp.work_orders (production_order_id);
CREATE INDEX work_orders_stage_id_idx ON erp.work_orders (stage_id);
CREATE INDEX work_orders_assigned_to_idx ON erp.work_orders (assigned_to) WHERE assigned_to IS NOT NULL;

-- -- Configurable FSM (loaded by the API's FsmService - nothing here is hardcoded in code) -----

CREATE TABLE erp.fsm_machines (
  code       text        PRIMARY KEY,
  name       text        NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE erp.fsm_states (
  machine_code text        NOT NULL REFERENCES erp.fsm_machines(code) ON DELETE CASCADE,
  code         text        NOT NULL,
  label        text        NOT NULL,
  position     integer     NOT NULL,
  is_initial   boolean     NOT NULL DEFAULT false,
  is_terminal  boolean     NOT NULL DEFAULT false,
  color        text,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (machine_code, code)
);

CREATE TABLE erp.fsm_transitions (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  machine_code    text        NOT NULL,
  from_state      text        NOT NULL,
  to_state        text        NOT NULL,
  -- the permission the actor must hold to perform this transition
  permission_code text        NOT NULL REFERENCES core.permissions(code),
  -- name of a guard registered in code (e.g. ALL_WORK_ORDERS_COMPLETED); which transitions use it is data
  guard_code      text,
  guard_params    jsonb       NOT NULL DEFAULT '{}'::jsonb,
  requires_note   boolean     NOT NULL DEFAULT false,
  label           text,
  is_active       boolean     NOT NULL DEFAULT true,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (machine_code, from_state, to_state),
  FOREIGN KEY (machine_code, from_state) REFERENCES erp.fsm_states(machine_code, code) ON DELETE CASCADE,
  FOREIGN KEY (machine_code, to_state)   REFERENCES erp.fsm_states(machine_code, code) ON DELETE CASCADE
);
CREATE INDEX fsm_transitions_permission_idx ON erp.fsm_transitions (permission_code);
