-- 0009_company_profile - the business's own identity (name, contact details, fiscal identifiers, logo),
-- printed in the header of documents such as the order PDF.
--
-- One company per install: a local-first install is a single business, so this is a singleton. The unique
-- index on a constant is what makes "one row" a database rule rather than a habit of the API.

CREATE TABLE core.company_profile (
  id         uuid         PRIMARY KEY DEFAULT gen_random_uuid(),
  name       text         NOT NULL CHECK (btrim(name) <> ''),
  address    text,
  phone      text,
  email      text,
  -- Algerian fiscal identifiers: the same set, with the same names, as crm.customers.
  nif        text,
  nis        text,
  rc         text,
  ai         text,
  -- The logo is a file in the storage service (like task proof photos); the row only points at it.
  logo_key   text,
  logo_mime  text,
  created_at timestamptz  NOT NULL DEFAULT now(),
  updated_at timestamptz  NOT NULL DEFAULT now(),
  CHECK ((logo_key IS NULL) = (logo_mime IS NULL))
);
CREATE UNIQUE INDEX company_profile_singleton ON core.company_profile ((true));
CREATE TRIGGER trg_set_updated_at BEFORE UPDATE ON core.company_profile FOR EACH ROW EXECUTE FUNCTION core.set_updated_at();
SELECT audit.attach('core', 'company_profile');
