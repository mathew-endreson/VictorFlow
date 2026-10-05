import { BadGatewayException, ConflictException, Inject, Injectable, Logger } from '@nestjs/common';
import type { LicenseStatusDto } from '@victorflow/types';
import { APP_CONFIG, type AppConfig } from '../../config/config';
import { LicenseService } from './license.service';

const TIMEOUT_MS = 15_000;

/**
 * Optional online activation: when a licence server address is configured (LICENSE_SERVER_URL, from the server's
 * config.json), the request code is sent there and the signed licence it answers with is installed — the same licence
 * the shop would otherwise receive by WhatsApp. Off by default; offline activation always works.
 *
 *   POST <url>   {"requestCode": "VFR1-…"}   →   200 {"licence": "<armoured licence text>"}
 */
@Injectable()
export class OnlineActivationService {
  private readonly logger = new Logger(OnlineActivationService.name);

  constructor(
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    private readonly license: LicenseService,
  ) {}

  async activate(code: string): Promise<LicenseStatusDto> {
    const url = this.config.licenseServerUrl;
    if (!url) throw new ConflictException({ message: 'Online activation is not set up on this server: send the request code to BluxTech instead', code: 'LICENCE_ONLINE_UNAVAILABLE' });
    const { requestCode } = this.license.requestCode(code); // validates the code first

    let licence: unknown;
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json', accept: 'application/json' },
        body: JSON.stringify({ requestCode }),
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
      const body = (await res.json().catch(() => null)) as { licence?: unknown; message?: unknown } | null;
      if (!res.ok) throw new Error(`HTTP ${res.status}${typeof body?.message === 'string' ? `: ${body.message}` : ''}`);
      licence = body?.licence;
    } catch (e) {
      this.logger.warn(`Online activation failed: ${(e as Error).message}`);
      throw new BadGatewayException({ message: `The licence server could not be reached or refused the request (${(e as Error).message}). Activate offline with the request code instead.`, code: 'LICENCE_ONLINE_FAILED' });
    }
    if (typeof licence !== 'string' || licence.length > 16_384) {
      throw new BadGatewayException({ message: 'The licence server did not answer with a licence', code: 'LICENCE_ONLINE_FAILED' });
    }
    return this.license.install(licence);
  }
}
