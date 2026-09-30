import type { INestApplication } from '@nestjs/common';
import { COMPANY_LOGO_MAX_BYTES } from '@victorflow/types';
import { StorageService } from '../src/infra/storage/storage.service';
import { bearer, createTestApp, dbOf, http, tokens } from './helpers/app';

// A real (1×1) PNG: the server decides the type from the file's own bytes, not from its name or Content-Type.
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');

describe('Company profile (e2e)', () => {
  let app: INestApplication;
  let t: Record<'admin' | 'sales', string>;
  const rows = () => dbOf(app).db.selectFrom('core.company_profile').selectAll().execute();
  const upload = (token: string, file: Buffer, filename = 'logo.png', contentType = 'image/png') =>
    http(app).put('/api/v1/company/logo').set(bearer(token)).attach('logo', file, { filename, contentType });

  beforeAll(async () => {
    app = await createTestApp();
    t = await tokens(app, 'admin', 'sales');
  });
  afterAll(async () => {
    await app.close();
  });

  it('is unconfigured on a fresh install, and readable by any signed-in user (it is the header printed on documents)', async () => {
    const res = await http(app).get('/api/v1/company').set(bearer(t.sales)).expect(200);
    expect(res.body).toEqual({ configured: false, name: '', address: null, phone: null, email: null, nif: null, nis: null, rc: null, ai: null, logoDataUrl: null });
    await http(app).get('/api/v1/company').expect(401);
  });

  it('only core.company.manage may change it — a sales manager gets 403 on every write', async () => {
    await http(app).put('/api/v1/company').set(bearer(t.sales)).send({ name: 'Nope' }).expect(403);
    await upload(t.sales, PNG).expect(403);
    await http(app).delete('/api/v1/company/logo').set(bearer(t.sales)).expect(403);
    expect(await rows()).toHaveLength(0);
  });

  it('a logo cannot be added before the profile exists', async () => {
    const res = await upload(t.admin, PNG).expect(409);
    expect(res.body.code).toBe('COMPANY_NOT_CONFIGURED');
  });

  it('validates the profile: a name is required and the e-mail must be an e-mail', async () => {
    await http(app).put('/api/v1/company').set(bearer(t.admin)).send({ name: '   ' }).expect(400);
    await http(app).put('/api/v1/company').set(bearer(t.admin)).send({ name: 'Acme', email: 'not-an-email' }).expect(400);
    expect(await rows()).toHaveLength(0);
  });

  it('saves the profile (empty text becomes null) and every signed-in user then sees it', async () => {
    const res = await http(app)
      .put('/api/v1/company')
      .set(bearer(t.admin))
      .send({ name: '  Imprimerie El Djazair  ', address: '12 rue Didouche Mourad, Alger', phone: '', email: 'Contact@Djazair.dz', nif: '000116001234567', nis: '', rc: '16/00-1234567B21' })
      .expect(200);
    expect(res.body).toMatchObject({ configured: true, name: 'Imprimerie El Djazair', address: '12 rue Didouche Mourad, Alger', phone: null, email: 'contact@djazair.dz', nif: '000116001234567', nis: null, rc: '16/00-1234567B21', ai: null, logoDataUrl: null });

    const seen = await http(app).get('/api/v1/company').set(bearer(t.sales)).expect(200);
    expect(seen.body.name).toBe('Imprimerie El Djazair');
  });

  it('is a singleton: saving again updates the one row, and a field left out is cleared', async () => {
    await http(app).put('/api/v1/company').set(bearer(t.admin)).send({ name: 'Imprimerie El Djazair 2' }).expect(200);
    const all = await rows();
    expect(all).toHaveLength(1);
    expect(all[0]).toMatchObject({ name: 'Imprimerie El Djazair 2', address: null, nif: null });
  });

  it('the database itself refuses a second company row', async () => {
    await expect(dbOf(app).db.insertInto('core.company_profile').values({ name: 'Second' }).execute()).rejects.toMatchObject({ code: '23505' });
  });

  it('accepts a PNG logo, stores it, and returns it inline as a data URL', async () => {
    const res = await upload(t.admin, PNG).expect(200);
    expect(res.body.logoDataUrl).toBe(`data:image/png;base64,${PNG.toString('base64')}`);

    const row = (await rows())[0]!;
    expect(row.logo_mime).toBe('image/png');
    expect(row.logo_key).toMatch(/^company\/logo-[0-9a-f-]{36}\.png$/);
    expect(await app.get(StorageService).exists(row.logo_key!)).toBe(true);

    const seen = await http(app).get('/api/v1/company').set(bearer(t.sales)).expect(200);
    expect(seen.body.logoDataUrl).toBe(res.body.logoDataUrl);
  });

  it('replacing the logo removes the old file — no orphans', async () => {
    const before = (await rows())[0]!.logo_key!;
    await upload(t.admin, PNG, 'again.png').expect(200);
    const after = (await rows())[0]!.logo_key!;
    expect(after).not.toBe(before);
    const storage = app.get(StorageService);
    expect(await storage.exists(before)).toBe(false);
    expect(await storage.exists(after)).toBe(true);
  });

  it('refuses a file that is not really an image, whatever it is called (415)', async () => {
    const res = await upload(t.admin, Buffer.from('<script>alert(1)</script>'), 'logo.png', 'image/png').expect(415);
    expect(res.body.code).toBe('UNSUPPORTED_MEDIA');
  });

  it('refuses a logo over the size cap while it uploads (413) and keeps the current one', async () => {
    const before = (await rows())[0]!.logo_key;
    await upload(t.admin, Buffer.concat([PNG, Buffer.alloc(COMPANY_LOGO_MAX_BYTES)])).expect(413);
    expect((await rows())[0]!.logo_key).toBe(before);
  });

  it('refuses a request with no file (400)', async () => {
    const res = await http(app).put('/api/v1/company/logo').set(bearer(t.admin)).field('note', 'no file here').expect(400);
    expect(res.body.code).toBe('NO_FILE');
  });

  it('removing the logo clears it and deletes the file; removing again is harmless', async () => {
    const key = (await rows())[0]!.logo_key!;
    const res = await http(app).delete('/api/v1/company/logo').set(bearer(t.admin)).expect(200);
    expect(res.body.logoDataUrl).toBeNull();
    expect(await app.get(StorageService).exists(key)).toBe(false);
    await http(app).delete('/api/v1/company/logo').set(bearer(t.admin)).expect(200);
  });

  it('a logo file missing from storage does not break the profile — it just shows no logo', async () => {
    await upload(t.admin, PNG).expect(200);
    await app.get(StorageService).delete((await rows())[0]!.logo_key!);
    const res = await http(app).get('/api/v1/company').set(bearer(t.sales)).expect(200);
    expect(res.body).toMatchObject({ configured: true, logoDataUrl: null });
  });

  it('every change is in the audit trail', async () => {
    const trail = await dbOf(app).db.selectFrom('audit.trail').select(['operation']).where('table_name', '=', 'company_profile').execute();
    expect(trail.some((r) => r.operation === 'INSERT')).toBe(true);
    expect(trail.filter((r) => r.operation === 'UPDATE').length).toBeGreaterThanOrEqual(3);
  });
});
