import { createParamDecorator, SetMetadata, type ExecutionContext } from '@nestjs/common';
import type { LicenseFeature, Permission } from '@victorflow/types';

export const IS_PUBLIC = 'vf:public';
export const AUTH_ONLY = 'vf:auth-only';
export const REQUIRED_PERMISSIONS = 'vf:permissions';
export const REQUIRED_FEATURE = 'vf:feature';

/** No authentication at all (login, health, public tracking). */
export const Public = () => SetMetadata(IS_PUBLIC, true);

/** Any signed-in user, no specific permission (e.g. "who am I"). */
export const Authenticated = () => SetMetadata(AUTH_ONLY, true);

/**
 * The caller must hold ALL of these permissions. Guards check permissions, never role names.
 * A route with none of @Public / @Authenticated / @RequirePermissions is DENIED by default.
 */
export const RequirePermissions = (...permissions: Permission[]) => SetMetadata(REQUIRED_PERMISSIONS, permissions);

/** Licence feature required (only enforced when LICENSE_ENFORCE=true). */
export const RequiresFeature = (feature: LicenseFeature) => SetMetadata(REQUIRED_FEATURE, feature);

export interface Principal {
  id: string;
  email: string;
  fullName: string;
  roles: string[];
  permissions: ReadonlySet<string>;
}

export const CurrentUser = createParamDecorator((_data: unknown, ctx: ExecutionContext): Principal => {
  return ctx.switchToHttp().getRequest<{ user: Principal }>().user;
});
