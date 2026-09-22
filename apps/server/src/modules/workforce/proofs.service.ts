import {
  ConflictException,
  Injectable,
  NotFoundException,
  UnsupportedMediaTypeException,
  BadRequestException,
} from '@nestjs/common';
import { PERMISSIONS, type ProofDto, type ProofFields } from '@victorflow/types';
import type { Principal } from '../../common/decorators';
import { DbService } from '../../infra/db/db.service';
import { StorageService } from '../../infra/storage/storage.service';
import { sniffImage } from './image-sniff';
import { PROOF_COLUMNS, toProofDto } from './task.mapper';

export interface UploadedImage {
  buffer: Buffer;
  size: number;
}

@Injectable()
export class ProofsService {
  constructor(
    private readonly dbs: DbService,
    private readonly storage: StorageService,
  ) {}

  /** A worker sees tasks assigned to them; supervisors with workforce.task.read_all see all. */
  private async assertTaskVisible(user: Principal, taskId: string): Promise<void> {
    const task = await this.dbs.db.selectFrom('workforce.tasks').select(['assigned_to', 'deleted_at']).where('id', '=', taskId).executeTakeFirst();
    const canSeeAll = user.permissions.has(PERMISSIONS.WORKFORCE_TASK_READ_ALL);
    if (!task || task.deleted_at || (!canSeeAll && task.assigned_to !== user.id)) throw new NotFoundException('Task not found');
  }

  /**
   * Store a proof photo. Idempotent on the client-generated proofId: uploading the same proof again (a retry after a
   * dropped connection) returns the existing record instead of creating a second one.
   */
  async upload(user: Principal, fields: ProofFields, file: UploadedImage | undefined): Promise<{ proof: ProofDto; created: boolean }> {
    if (!file || file.size === 0) throw new BadRequestException({ message: 'Attach the photo as the "photo" file field', code: 'NO_FILE' });

    const image = sniffImage(file.buffer);
    if (!image) throw new UnsupportedMediaTypeException({ message: 'Only JPEG, PNG or WebP images are accepted', code: 'UNSUPPORTED_MEDIA' });

    let capturedAt: Date | null = null;
    if (fields.capturedAt) {
      capturedAt = new Date(fields.capturedAt);
      if (Number.isNaN(capturedAt.getTime())) throw new BadRequestException({ message: 'capturedAt is not a valid date', code: 'INVALID_DATE' });
    }
    if ((fields.latitude === undefined) !== (fields.longitude === undefined)) {
      throw new BadRequestException({ message: 'Send latitude and longitude together', code: 'INCOMPLETE_LOCATION' });
    }

    await this.assertTaskVisible(user, fields.taskId);

    const existing = await this.dbs.db.selectFrom('workforce.task_proofs').select([...PROOF_COLUMNS, 'uploaded_by']).where('id', '=', fields.proofId).executeTakeFirst();
    if (existing) return { proof: this.claimExisting(existing, user, fields), created: false };

    const now = new Date();
    const key = `proofs/${now.getUTCFullYear()}/${String(now.getUTCMonth() + 1).padStart(2, '0')}/${fields.proofId}.${image.ext}`;

    try {
      // Claim the proof id FIRST (the primary key is the lock), then write the file, then commit. So:
      //  - racing duplicates block on the unique index and never write the file a second time;
      //  - the row becomes visible to pull/download only once its file is already on disk;
      //  - a failed file write rolls the row back.
      const row = await this.dbs.transaction(async (trx) => {
        const inserted = await trx
          .insertInto('workforce.task_proofs')
          .values({
            id: fields.proofId,
            task_id: fields.taskId,
            uploaded_by: user.id,
            storage_key: key,
            mime_type: image.mime,
            size_bytes: file.size,
            latitude: fields.latitude === undefined ? null : fields.latitude.toFixed(6),
            longitude: fields.longitude === undefined ? null : fields.longitude.toFixed(6),
            captured_at: capturedAt,
          })
          .returning([...PROOF_COLUMNS, 'uploaded_by'])
          .executeTakeFirstOrThrow();
        await this.storage.put(key, file.buffer);
        return inserted;
      });
      return { proof: toProofDto(row), created: true };
    } catch (err) {
      if ((err as { code?: string }).code === '23505') {
        // An identical upload won the race (we waited on its uncommitted row). Its file is the file; return its record.
        const won = await this.dbs.db.selectFrom('workforce.task_proofs').select([...PROOF_COLUMNS, 'uploaded_by']).where('id', '=', fields.proofId).executeTakeFirstOrThrow();
        return { proof: this.claimExisting(won, user, fields), created: false };
      }
      // Anything else (e.g. the commit failed after the file was written): don't leave an orphan behind.
      await this.storage.delete(key).catch(() => undefined);
      throw err;
    }
  }

  private claimExisting(row: Parameters<typeof toProofDto>[0] & { uploaded_by: string }, user: Principal, fields: ProofFields): ProofDto {
    if (row.task_id !== fields.taskId || row.uploaded_by !== user.id) {
      throw new ConflictException({ message: 'This proof id was already used for a different upload', code: 'PROOF_ID_REUSED' });
    }
    return toProofDto(row);
  }

  async file(user: Principal, proofId: string): Promise<{ data: Buffer; mime: string }> {
    const proof = await this.dbs.db
      .selectFrom('workforce.task_proofs')
      .select(['task_id', 'storage_key', 'mime_type'])
      .where('id', '=', proofId)
      .executeTakeFirst();
    if (!proof) throw new NotFoundException('Proof not found');
    await this.assertTaskVisible(user, proof.task_id);
    try {
      return { data: await this.storage.get(proof.storage_key), mime: proof.mime_type };
    } catch {
      throw new NotFoundException('The photo file is missing from storage');
    }
  }
}
