import { ConflictException, Injectable } from '@nestjs/common';
import { sql } from '@victorflow/db';
import { ROLES, type LicenceRequestDto, type LoginResponse, type OnboardingOwnerDto, type OnboardingStatusDto, type OnboardingStep, type UpdateCompanyDto } from '@victorflow/types';
import { DbService } from '../../infra/db/db.service';
import { AuthService, type ClientMeta } from '../auth/auth.service';
import { hashPassword } from '../auth/password';
import { CompanyService } from '../company/company.service';
import { LicenseService } from './license.service';
import { OnlineActivationService } from './online-activation.service';

/**
 * First run of a shop's server: the licence, then the company profile, then the owner's account. Nothing is stored
 * about the onboarding itself — the step is read from what exists:
 *   no valid licence (crypto mode)  → licence
 *   no company profile              → company
 *   no user at all                  → owner
 *   otherwise                       → done   (every onboarding route then answers 409 ONBOARDING_DONE)
 * The routes are public — there is nobody to sign in as yet — and reachable on the LAN only.
 */
@Injectable()
export class OnboardingService {
  constructor(
    private readonly dbs: DbService,
    private readonly license: LicenseService,
    private readonly company: CompanyService,
    private readonly auth: AuthService,
    private readonly online: OnlineActivationService,
  ) {}

  async step(): Promise<OnboardingStep> {
    const db = this.dbs.db;
    const anyUser = await db.selectFrom('core.users').select('id').limit(1).executeTakeFirst();
    if (anyUser) return 'done';
    if (!(await this.license.getEntitlement())) return 'licence';
    const profile = await db.selectFrom('core.company_profile').select('id').limit(1).executeTakeFirst();
    return profile ? 'owner' : 'company';
  }

  async status(): Promise<OnboardingStatusDto> {
    const step = await this.step();
    if (step === 'done') return { step };
    const s = await this.license.status();
    return { step, mode: s.mode, hardwareId: s.hardwareId, online: s.online, licence: s.entitlement, problem: s.problem };
  }

  /** Refuses with 409 unless the onboarding is at one of `steps`. */
  private async expectStep(...steps: OnboardingStep[]): Promise<void> {
    const step = await this.step();
    if (step === 'done') throw new ConflictException({ message: 'This server is already set up: sign in instead', code: 'ONBOARDING_DONE' });
    if (!steps.includes(step)) throw new ConflictException({ message: `Finish the "${step}" step first`, code: 'ONBOARDING_STEP', step });
  }

  async request(code: string): Promise<LicenceRequestDto> {
    await this.expectStep('licence', 'company', 'owner');
    return this.license.requestCode(code);
  }

  /** The licence can be replaced until the owner exists (a wrong one was installed, say). */
  async installLicence(text: string): Promise<OnboardingStatusDto> {
    await this.expectStep('licence', 'company', 'owner');
    await this.license.install(text);
    return this.status();
  }

  async activateOnline(code: string): Promise<OnboardingStatusDto> {
    await this.expectStep('licence', 'company', 'owner');
    await this.online.activate(code);
    return this.status();
  }

  async saveCompany(dto: UpdateCompanyDto): Promise<OnboardingStatusDto> {
    await this.expectStep('company', 'owner');
    await this.company.save(dto);
    return this.status();
  }

  /** Creates the first account — the owner, who holds every permission — and signs it in on this desktop. */
  async createOwner(dto: OnboardingOwnerDto, meta: ClientMeta): Promise<LoginResponse> {
    await this.expectStep('owner');
    const passwordHash = await hashPassword(dto.password); // outside the transaction: CPU-bound
    await this.dbs.transaction(
      async (trx) => {
        // Two owners submitted at once: the second waits here, then finds a user and stops.
        await sql`SELECT pg_advisory_xact_lock(hashtext('victorflow.onboarding.owner'))`.execute(trx);
        const anyUser = await trx.selectFrom('core.users').select('id').limit(1).executeTakeFirst();
        if (anyUser) throw new ConflictException({ message: 'This server is already set up: sign in instead', code: 'ONBOARDING_DONE' });
        const role = await trx.selectFrom('core.roles').select('id').where('code', '=', ROLES.SUPER_ADMIN).executeTakeFirstOrThrow();
        const user = await trx
          .insertInto('core.users')
          .values({ email: dto.email, full_name: dto.fullName, password_hash: passwordHash })
          .returning('id')
          .executeTakeFirstOrThrow();
        await trx.insertInto('core.user_roles').values({ user_id: user.id, role_id: role.id }).execute();
      },
      { actorId: null },
    );
    return this.auth.login({ email: dto.email, password: dto.password, client: 'desktop' }, meta);
  }
}
