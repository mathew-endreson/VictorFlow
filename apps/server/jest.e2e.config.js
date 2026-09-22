/**
 * e2e tests: boot the real Nest app against a real Postgres.
 * globalSetup drops/creates a throw-away `<db>_test` database, runs migrations and the seed.
 * Run in-band: specs share that one database (they use unique data and never assume empty tables).
 */
module.exports = {
  rootDir: '.',
  testEnvironment: 'node',
  testMatch: ['<rootDir>/test/**/*.e2e-spec.ts'],
  moduleFileExtensions: ['ts', 'js', 'json'],
  transform: { '^.+\\.ts$': ['ts-jest', { tsconfig: '<rootDir>/tsconfig.jest.json' }] },
  globalSetup: '<rootDir>/test/setup/global-setup.ts',
  testTimeout: 30000,
};
