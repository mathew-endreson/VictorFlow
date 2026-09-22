import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { AppConfig } from '../../config/config';
import { LocalStorageService } from './storage.service';

describe('LocalStorageService', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'vf-storage-'));
  const storage = new LocalStorageService({ storageDir: dir } as AppConfig);
  afterAll(() => rmSync(dir, { recursive: true, force: true }));

  it('round-trips bytes, creating directories as needed', async () => {
    await storage.put('proofs/2026/09/a.bin', Buffer.from([1, 2, 3]));
    expect(await storage.exists('proofs/2026/09/a.bin')).toBe(true);
    expect([...(await storage.get('proofs/2026/09/a.bin'))]).toEqual([1, 2, 3]);
    expect([...readFileSync(path.join(dir, 'proofs/2026/09/a.bin'))]).toEqual([1, 2, 3]);
    await storage.delete('proofs/2026/09/a.bin');
    expect(await storage.exists('proofs/2026/09/a.bin')).toBe(false);
    await storage.delete('proofs/2026/09/a.bin'); // deleting twice is fine
  });

  it('refuses keys that would escape the storage root (path traversal)', async () => {
    const evil = ['../outside.txt', '../../etc/passwd', 'proofs/../../outside.txt', '/etc/passwd', 'C:\\Windows\\win.ini', 'a\0b'];
    for (const key of evil) {
      await expect(storage.put(key, Buffer.from('x'))).rejects.toThrow();
      await expect(storage.get(key)).rejects.toThrow();
    }
    expect(await storage.exists('../outside.txt').catch(() => 'threw')).toBe('threw');
  });

  it('does not leave temp files behind', async () => {
    await storage.put('tmpcheck/b.bin', Buffer.from('b'));
    const { readdirSync } = await import('node:fs');
    expect(readdirSync(path.join(dir, 'tmpcheck'))).toEqual(['b.bin']);
  });
});
