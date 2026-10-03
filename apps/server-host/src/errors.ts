// Every failure vf-server reports has a code and a distinct exit code, so the installer (which runs `vf-server setup`)
// and CI can tell what went wrong without parsing text.

export const EXIT_CODES = {
  USAGE: 2,
  CONFIG: 10,
  DATA_DIR: 11,
  PORT_IN_USE: 12,
  NOT_ADMIN: 13,
  LAYOUT: 14,
  PG_INIT: 20,
  PG_SERVICE: 21,
  PG_NOT_READY: 22,
  MIGRATE: 30,
  SERVICE: 40,
  API_HEALTH: 41,
  WEB_HEALTH: 42,
} as const;

export type ErrorCode = keyof typeof EXIT_CODES;

export class VfError extends Error {
  constructor(
    readonly code: ErrorCode,
    message: string,
    readonly detail?: string,
  ) {
    super(message);
    this.name = 'VfError';
  }

  get exitCode(): number {
    return EXIT_CODES[this.code];
  }
}
