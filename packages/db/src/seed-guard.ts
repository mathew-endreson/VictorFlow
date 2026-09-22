export const DEV_SEED_PASSWORD = 'Admin123!';

/**
 * The password given to the accounts the seed creates (admin@victorflow.local, sales@…, field@…).
 *
 * In development the documented default is fine. In production it is a backdoor: the default is public, so a seed run
 * on a customer's installation would leave a known administrator login. There the operator must choose the password
 * on purpose (SEED_DEMO_PASSWORD), and it must not be the default nor a short one.
 */
export function seedPassword(env: NodeJS.ProcessEnv = process.env): string {
  const chosen = env.SEED_DEMO_PASSWORD;
  if (env.NODE_ENV !== 'production') return chosen ?? DEV_SEED_PASSWORD;

  if (!chosen || chosen === DEV_SEED_PASSWORD || chosen.length < 12) {
    throw new Error(
      'Refusing to seed a production database with the default (public) password. Set SEED_DEMO_PASSWORD to a strong password of at least 12 characters — it becomes the initial password of every seeded account — and change those passwords after the first sign-in.',
    );
  }
  return chosen;
}
