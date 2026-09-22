import type { AuditVerifyDto } from '@victorflow/types';
import type { AppConfig } from '../../config/config';
import { AuditChainJob, runChainVerification } from './audit-chain.job';
import type { AuditService } from './audit.service';

const verdict = (over: Partial<AuditVerifyDto> = {}): AuditVerifyDto => ({ ok: true, checked: 120, firstBrokenId: null, reason: null, verifiedAt: '2026-09-19T00:00:00Z', ...over });

describe('audit chain job', () => {
  it('logs quietly when the chain is intact', async () => {
    const log = { log: jest.fn(), error: jest.fn() };
    const r = await runChainVerification(async () => verdict(), log);
    expect(r.ok).toBe(true);
    expect(log.log).toHaveBeenCalledWith(expect.stringContaining('intact (120 rows'));
    expect(log.error).not.toHaveBeenCalled();
  });

  it('raises a loud error naming the first broken row when the chain is broken', async () => {
    const log = { log: jest.fn(), error: jest.fn() };
    const r = await runChainVerification(async () => verdict({ ok: false, firstBrokenId: '77', reason: 'row_hash does not match the row contents (row was modified)', checked: 77 }), log);
    expect(r.ok).toBe(false);
    expect(log.error).toHaveBeenCalledWith(expect.stringMatching(/AUDIT CHAIN BROKEN at trail id 77.*modified/));
  });

  it('does nothing — and never touches Redis — when the queue or Redis is disabled', () => {
    const audit = { verifyChain: jest.fn() } as unknown as AuditService;
    for (const config of [{ queueEnabled: false, redisEnabled: true, nodeEnv: 'test' }, { queueEnabled: true, redisEnabled: false, nodeEnv: 'test' }] as AppConfig[]) {
      const job = new AuditChainJob(audit, config);
      job.onApplicationBootstrap();
      expect((job as unknown as { queue?: unknown }).queue).toBeUndefined();
      expect((job as unknown as { worker?: unknown }).worker).toBeUndefined();
    }
  });
});

describe('audit chain without Redis: the in-process schedule', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  const setup = (over: Partial<AppConfig> = {}) => {
    const audit = { verifyChain: jest.fn(async () => verdict()) };
    const job = new AuditChainJob(audit as unknown as AuditService, { queueEnabled: false, redisEnabled: false, nodeEnv: 'production', ...over } as AppConfig);
    return { audit, job };
  };

  it('verifies shortly after boot and then every hour, without Redis', async () => {
    const { audit, job } = setup();
    job.onApplicationBootstrap();
    expect(audit.verifyChain).not.toHaveBeenCalled(); // never during boot

    await jest.advanceTimersByTimeAsync(61_000);
    expect(audit.verifyChain).toHaveBeenCalledTimes(1);
    await jest.advanceTimersByTimeAsync(60 * 60 * 1000);
    expect(audit.verifyChain).toHaveBeenCalledTimes(2);
    await job.onModuleDestroy();
  });

  it('stops when the app shuts down, and one failed run does not stop the schedule', async () => {
    const { audit, job } = setup();
    audit.verifyChain.mockRejectedValueOnce(new Error('db went away'));
    job.onApplicationBootstrap();
    await jest.advanceTimersByTimeAsync(61_000); // fails, is logged, does not throw
    await jest.advanceTimersByTimeAsync(60 * 60 * 1000);
    expect(audit.verifyChain).toHaveBeenCalledTimes(2);

    await job.onModuleDestroy();
    await jest.advanceTimersByTimeAsync(3 * 60 * 60 * 1000);
    expect(audit.verifyChain).toHaveBeenCalledTimes(2);
  });

  it('does not start a timer under NODE_ENV=test', async () => {
    const { audit, job } = setup({ nodeEnv: 'test' });
    job.onApplicationBootstrap();
    await jest.advanceTimersByTimeAsync(2 * 60 * 60 * 1000);
    expect(audit.verifyChain).not.toHaveBeenCalled();
  });
});
