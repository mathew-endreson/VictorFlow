import { randomUUID } from 'node:crypto';
import { BadRequestException, ConflictException, Injectable, UnsupportedMediaTypeException } from '@nestjs/common';
import { sql, type Row } from '@victorflow/db';
import type { CompanyProfileDto, UpdateCompanyDto } from '@victorflow/types';
import { DbService } from '../../infra/db/db.service';
import { StorageService } from '../../infra/storage/storage.service';
import { sniffImage } from '../workforce/image-sniff';

const COMPANY_COLUMNS = ['id', 'name', 'address', 'phone', 'email', 'nif', 'nis', 'rc', 'ai', 'logo_key', 'logo_mime'] as const;
type CompanyRow = Pick<Row<'core.company_profile'>, (typeof COMPANY_COLUMNS)[number]>;

const NOT_CONFIGURED: CompanyProfileDto = { configured: false, name: '', address: null, phone: null, email: null, nif: null, nis: null, rc: null, ai: null, logoDataUrl: null };

export interface UploadedLogo {
  buffer: Buffer;
  size: number;
}

/** The business's own identity, printed on documents. A singleton: one row per install. */
@Injectable()
export class CompanyService {
  constructor(
    private readonly dbs: DbService,
    private readonly storage: StorageService,
  ) {}

  private row(): Promise<CompanyRow | undefined> {
    return this.dbs.db.selectFrom('core.company_profile').select(COMPANY_COLUMNS).executeTakeFirst();
  }

  private async toDto(r: CompanyRow): Promise<CompanyProfileDto> {
    let logoDataUrl: string | null = null;
    if (r.logo_key && r.logo_mime) {
      // A logo file that has gone missing from storage must not break every screen that shows the header.
      logoDataUrl = await this.storage
        .get(r.logo_key)
        .then((data) => `data:${r.logo_mime};base64,${data.toString('base64')}`)
        .catch(() => null);
    }
    return { configured: true, name: r.name, address: r.address, phone: r.phone, email: r.email, nif: r.nif, nis: r.nis, rc: r.rc, ai: r.ai, logoDataUrl };
  }

  async get(): Promise<CompanyProfileDto> {
    const r = await this.row();
    return r ? this.toDto(r) : NOT_CONFIGURED;
  }

  async save(dto: UpdateCompanyDto): Promise<CompanyProfileDto> {
    const values = {
      name: dto.name,
      address: dto.address ?? null,
      phone: dto.phone ?? null,
      email: dto.email ?? null,
      nif: dto.nif ?? null,
      nis: dto.nis ?? null,
      rc: dto.rc ?? null,
      ai: dto.ai ?? null,
    };
    // The unique index on (true) is the singleton rule: the first save inserts, every later one updates that row.
    const saved = await this.dbs.db
      .insertInto('core.company_profile')
      .values(values)
      .onConflict((oc) => oc.expression(sql`(true)`).doUpdateSet(values))
      .returning(COMPANY_COLUMNS)
      .executeTakeFirstOrThrow();
    return this.toDto(saved);
  }

  async setLogo(file: UploadedLogo | undefined): Promise<CompanyProfileDto> {
    if (!file || file.size === 0) throw new BadRequestException({ message: 'Attach the logo as the "logo" file field', code: 'NO_FILE' });
    // The size cap is enforced while the upload streams in (see CompanyModule). The type is decided by the file's own bytes.
    const image = sniffImage(file.buffer);
    if (!image) throw new UnsupportedMediaTypeException({ message: 'The logo must be a PNG, JPEG or WebP image', code: 'UNSUPPORTED_MEDIA' });

    const current = await this.row();
    if (!current) throw new ConflictException({ message: 'Save the company details before adding a logo', code: 'COMPANY_NOT_CONFIGURED' });

    // A fresh key per upload, so replacing a logo never overwrites the file a concurrent reader might be streaming.
    const key = `company/logo-${randomUUID()}.${image.ext}`;
    await this.storage.put(key, file.buffer);
    try {
      await this.dbs.db.updateTable('core.company_profile').set({ logo_key: key, logo_mime: image.mime }).where('id', '=', current.id).execute();
    } catch (err) {
      await this.storage.delete(key).catch(() => undefined);
      throw err;
    }
    if (current.logo_key) await this.storage.delete(current.logo_key).catch(() => undefined);
    return this.get();
  }

  async removeLogo(): Promise<CompanyProfileDto> {
    const current = await this.row();
    if (current?.logo_key) {
      await this.dbs.db.updateTable('core.company_profile').set({ logo_key: null, logo_mime: null }).where('id', '=', current.id).execute();
      await this.storage.delete(current.logo_key).catch(() => undefined);
    }
    return this.get();
  }
}
