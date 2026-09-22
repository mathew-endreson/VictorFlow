import { Controller, Get, Headers, HttpCode, Ip, Patch, Post } from '@nestjs/common';
import {
  createUserSchema,
  loginSchema,
  PERMISSIONS,
  refreshSchema,
  updateUserSchema,
  type AuthUser,
  type CreateUserDto,
  type LoginDto,
  type LoginResponse,
  type RefreshDto,
  type RoleSummary,
  type UpdateUserDto,
  type UserSummary,
} from '@victorflow/types';
import { Authenticated, CurrentUser, Public, RequirePermissions, type Principal } from '../../common/decorators';
import { IdParam, ZBody } from '../../common/zod.pipe';
import { AuthService, toAuthUser } from './auth.service';
import { UsersService } from './users.service';

@Controller('auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  @Public()
  @Post('login')
  @HttpCode(200)
  login(@ZBody(loginSchema) dto: LoginDto, @Ip() ip: string, @Headers('user-agent') userAgent?: string): Promise<LoginResponse> {
    return this.auth.login(dto, { ip, userAgent });
  }

  @Public()
  @Post('refresh')
  @HttpCode(200)
  refresh(@ZBody(refreshSchema) dto: RefreshDto, @Ip() ip: string, @Headers('user-agent') userAgent?: string): Promise<LoginResponse> {
    return this.auth.refresh(dto.refreshToken, { ip, userAgent });
  }

  @Public()
  @Post('logout')
  @HttpCode(204)
  async logout(@ZBody(refreshSchema) dto: RefreshDto): Promise<void> {
    await this.auth.logout(dto.refreshToken);
  }

  @Authenticated()
  @Get('me')
  me(@CurrentUser() user: Principal): AuthUser {
    return toAuthUser(user);
  }
}

@Controller()
export class UsersController {
  constructor(private readonly users: UsersService) {}

  @RequirePermissions(PERMISSIONS.CORE_USER_READ)
  @Get('users')
  list(): Promise<UserSummary[]> {
    return this.users.list();
  }

  @RequirePermissions(PERMISSIONS.CORE_USER_MANAGE)
  @Post('users')
  create(@ZBody(createUserSchema) dto: CreateUserDto, @CurrentUser() actor: Principal): Promise<UserSummary> {
    return this.users.create(dto, actor);
  }

  @RequirePermissions(PERMISSIONS.CORE_USER_MANAGE)
  @Patch('users/:id')
  update(@IdParam() id: string, @ZBody(updateUserSchema) dto: UpdateUserDto, @CurrentUser() actor: Principal): Promise<UserSummary> {
    return this.users.update(id, dto, actor);
  }

  @RequirePermissions(PERMISSIONS.CORE_ROLE_READ)
  @Get('roles')
  roles(): Promise<RoleSummary[]> {
    return this.users.listRoles();
  }
}
