-- 0001_core - schemas, shared trigger helpers, document numbering, auth/RBAC tables.
-- SQLSTATEs used by our own RAISE EXCEPTIONs (mapped to HTTP codes by the API):
--   VF001 immutable / append-only violation     VF002 unbalanced or malformed journal entry
--   VF003 fiscal-year problem                   VF004 insufficient stock

CREATE SCHEMA IF NOT EXISTS core;
CREATE SCHEMA IF NOT EXISTS crm;
CREATE SCHEMA IF NOT EXISTS erp;
CREATE SCHEMA IF NOT EXISTS inventory;
CREATE SCHEMA IF NOT EXISTS finance;
CREATE SCHEMA IF NOT EXISTS workforce;
CREATE SCHEMA IF NOT EXISTS audit;

-- -- generic trigger functions ------------------------------------------------

CREATE FUNCTION core.set_updated_at() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END
$$;

CREATE FUNCTION core.reject_mutation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION '% on %.% rejected: rows are append-only', TG_OP, TG_TABLE_SCHEMA, TG_TABLE_NAME
    USING ERRCODE = 'VF001';
END
$$;

CREATE FUNCTION core.reject_truncate() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'TRUNCATE on %.% rejected: table is protected', TG_TABLE_SCHEMA, TG_TABLE_NAME
    USING ERRCODE = 'VF001';
END
$$;

-- -- document numbering (quotes, orders, invoices ...) --------------------------
-- A counter ROW (not a sequence) so that numbers are gap-free: the increment rolls back with the
-- transaction. Legal invoice numbering must not have holes. The year comes from the document date
-- passed in, never from the server clock.

CREATE TABLE core.doc_counters (
  prefix      text        NOT NULL,
  period      text        NOT NULL,
  last_value  bigint      NOT NULL DEFAULT 0,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (prefix, period)
);

CREATE FUNCTION core.next_doc_no(p_prefix text, p_date date DEFAULT NULL) RETURNS text
LANGUAGE plpgsql AS $$
DECLARE
  v_period text := CASE WHEN p_date IS NULL THEN 'ALL' ELSE to_char(p_date, 'YYYY') END;
  v_n      bigint;
BEGIN
  INSERT INTO core.doc_counters AS c (prefix, period, last_value)
  VALUES (p_prefix, v_period, 1)
  ON CONFLICT (prefix, period) DO UPDATE SET last_value = c.last_value + 1
  RETURNING c.last_value INTO v_n;

  RETURN p_prefix || '-' || CASE WHEN p_date IS NULL THEN '' ELSE v_period || '-' END || lpad(v_n::text, 6, '0');
END
$$;

-- -- auth / RBAC --------------------------------------------------------------

CREATE TABLE core.users (
  id             uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  email          text        NOT NULL,
  password_hash  text        NOT NULL,
  full_name      text        NOT NULL,
  is_active      boolean     NOT NULL DEFAULT true,
  last_login_at  timestamptz,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX users_email_lower_uq ON core.users (lower(email));

CREATE TABLE core.roles (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  code        text        NOT NULL UNIQUE,
  name        text        NOT NULL,
  description text,
  is_system   boolean     NOT NULL DEFAULT false,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE core.permissions (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  code        text        NOT NULL UNIQUE,
  module      text        NOT NULL,
  description text,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE core.role_permissions (
  role_id       uuid        NOT NULL REFERENCES core.roles(id) ON DELETE CASCADE,
  permission_id uuid        NOT NULL REFERENCES core.permissions(id) ON DELETE CASCADE,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (role_id, permission_id)
);
CREATE INDEX role_permissions_permission_id_idx ON core.role_permissions (permission_id);

CREATE TABLE core.user_roles (
  user_id     uuid        NOT NULL REFERENCES core.users(id) ON DELETE CASCADE,
  role_id     uuid        NOT NULL REFERENCES core.roles(id) ON DELETE CASCADE,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, role_id)
);
CREATE INDEX user_roles_role_id_idx ON core.user_roles (role_id);

-- Refresh tokens are stored hashed and rotated on every use; presenting an already-rotated token
-- revokes the whole family (theft detection).
CREATE TABLE core.refresh_tokens (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid        NOT NULL REFERENCES core.users(id) ON DELETE CASCADE,
  family_id   uuid        NOT NULL,
  token_hash  text        NOT NULL UNIQUE,
  expires_at  timestamptz NOT NULL,
  revoked_at  timestamptz,
  replaced_by uuid,
  user_agent  text,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX refresh_tokens_user_id_idx ON core.refresh_tokens (user_id);
CREATE INDEX refresh_tokens_family_id_idx ON core.refresh_tokens (family_id);
