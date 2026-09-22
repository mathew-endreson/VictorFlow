import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { JwtModule } from '@nestjs/jwt';
import { APP_CONFIG, type AppConfig } from '../../config/config';
import { AuthController, UsersController } from './auth.controller';
import { AuthGuard } from './auth.guard';
import { AuthService } from './auth.service';
import { PermissionsService } from './permissions.service';
import { UsersService } from './users.service';

@Module({
  imports: [
    JwtModule.registerAsync({
      inject: [APP_CONFIG],
      useFactory: (config: AppConfig) => ({
        secret: config.jwtAccessSecret,
        signOptions: { expiresIn: config.jwtAccessTtlSeconds, issuer: 'victorflow', algorithm: 'HS256' },
        verifyOptions: { algorithms: ['HS256'] }, // pin the algorithm: never trust the token header
      }),
    }),
  ],
  controllers: [AuthController, UsersController],
  providers: [
    AuthService,
    UsersService,
    PermissionsService,
    // Applied to every route in the app. Order = registration order (auth first, licence later).
    { provide: APP_GUARD, useClass: AuthGuard },
  ],
  exports: [PermissionsService, AuthService],
})
export class AuthModule {}
