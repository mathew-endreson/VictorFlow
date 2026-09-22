import argon2 from 'argon2';

// OWASP-recommended argon2id floor (19 MiB, 2 iterations, 1 lane). Raise memoryCost on real hardware.
const OPTIONS = { type: argon2.argon2id, memoryCost: 19_456, timeCost: 2, parallelism: 1 } as const;

export const hashPassword = (plain: string): Promise<string> => argon2.hash(plain, OPTIONS);

export async function verifyPassword(hash: string, plain: string): Promise<boolean> {
  try {
    return await argon2.verify(hash, plain);
  } catch {
    return false; // malformed hash etc. → treat as a mismatch, never an exception
  }
}
