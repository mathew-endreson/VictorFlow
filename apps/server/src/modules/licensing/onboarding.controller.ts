import { Controller, Get, Headers, HttpCode, Ip, Post, Put } from '@nestjs/common';
import {
  activationRequestSchema,
  installLicenceSchema,
  onboardingOwnerSchema,
  updateCompanySchema,
  type ActivationRequestDto,
  type InstallLicenceDto,
  type LicenceRequestDto,
  type LoginResponse,
  type OnboardingOwnerDto,
  type OnboardingStatusDto,
  type UpdateCompanyDto,
} from '@victorflow/types';
import { LicenceExempt, Public } from '../../common/decorators';
import { ZBody } from '../../common/zod.pipe';
import { OnboardingService } from './onboarding.service';

/** Public until the owner exists, then every route answers 409 ONBOARDING_DONE (see OnboardingService). */
@Public()
@LicenceExempt()
@Controller('onboarding')
export class OnboardingController {
  constructor(private readonly onboarding: OnboardingService) {}

  @Get()
  status(): Promise<OnboardingStatusDto> {
    return this.onboarding.status();
  }

  @Post('request')
  @HttpCode(200)
  request(@ZBody(activationRequestSchema) dto: ActivationRequestDto): Promise<LicenceRequestDto> {
    return this.onboarding.request(dto.code);
  }

  @Post('licence')
  @HttpCode(200)
  installLicence(@ZBody(installLicenceSchema) dto: InstallLicenceDto): Promise<OnboardingStatusDto> {
    return this.onboarding.installLicence(dto.licence);
  }

  @Post('online')
  @HttpCode(200)
  activateOnline(@ZBody(activationRequestSchema) dto: ActivationRequestDto): Promise<OnboardingStatusDto> {
    return this.onboarding.activateOnline(dto.code);
  }

  @Put('company')
  saveCompany(@ZBody(updateCompanySchema) dto: UpdateCompanyDto): Promise<OnboardingStatusDto> {
    return this.onboarding.saveCompany(dto);
  }

  /** 201 with a signed-in session for the new owner. */
  @Post('owner')
  createOwner(@ZBody(onboardingOwnerSchema) dto: OnboardingOwnerDto, @Ip() ip: string, @Headers('user-agent') userAgent?: string): Promise<LoginResponse> {
    return this.onboarding.createOwner(dto, { ip, userAgent });
  }
}
