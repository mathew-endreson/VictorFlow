import { Controller, Get, HttpCode, Post, Put } from '@nestjs/common';
import { activationRequestSchema, installLicenceSchema, PERMISSIONS, type ActivationRequestDto, type InstallLicenceDto, type LicenceRequestDto, type LicenceSummaryDto, type LicenseStatusDto } from '@victorflow/types';
import { Authenticated, LicenceExempt, RequirePermissions } from '../../common/decorators';
import { ZBody } from '../../common/zod.pipe';
import { LicenseService } from './license.service';
import { OnlineActivationService } from './online-activation.service';

/** Never blocked by the licence itself: installing a valid licence is how a read-only server is put right. */
@LicenceExempt()
@Controller('license')
export class LicenseController {
  constructor(
    private readonly license: LicenseService,
    private readonly online: OnlineActivationService,
  ) {}

  @RequirePermissions(PERMISSIONS.CORE_LICENSE_READ)
  @Get()
  status(): Promise<LicenseStatusDto> {
    return this.license.status();
  }

  /** Every signed-in user: which modules to show, and whether everything is read-only. */
  @Authenticated()
  @Get('summary')
  summary(): Promise<LicenceSummaryDto> {
    return this.license.summary();
  }

  /** The request code for an activation code (a new licence, a renewal, or a transfer to this server). */
  @RequirePermissions(PERMISSIONS.CORE_LICENSE_MANAGE)
  @Post('request')
  @HttpCode(200)
  request(@ZBody(activationRequestSchema) dto: ActivationRequestDto): LicenceRequestDto {
    return this.license.requestCode(dto.code);
  }

  @RequirePermissions(PERMISSIONS.CORE_LICENSE_MANAGE)
  @Put()
  install(@ZBody(installLicenceSchema) dto: InstallLicenceDto): Promise<LicenseStatusDto> {
    return this.license.install(dto.licence);
  }

  @RequirePermissions(PERMISSIONS.CORE_LICENSE_MANAGE)
  @Post('online')
  @HttpCode(200)
  activateOnline(@ZBody(activationRequestSchema) dto: ActivationRequestDto): Promise<LicenseStatusDto> {
    return this.online.activate(dto.code);
  }
}
