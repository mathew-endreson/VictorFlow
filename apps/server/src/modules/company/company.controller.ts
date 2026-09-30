import { Controller, Delete, Get, Put, UploadedFile, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { PERMISSIONS, updateCompanySchema, type CompanyProfileDto, type UpdateCompanyDto } from '@victorflow/types';
import { Authenticated, RequirePermissions } from '../../common/decorators';
import { ZBody } from '../../common/zod.pipe';
import { CompanyService, type UploadedLogo } from './company.service';

@Controller('company')
export class CompanyController {
  constructor(private readonly company: CompanyService) {}

  /** Any signed-in user: this is the header printed on every document, so anyone who can print one needs it. */
  @Authenticated()
  @Get()
  get(): Promise<CompanyProfileDto> {
    return this.company.get();
  }

  @RequirePermissions(PERMISSIONS.CORE_COMPANY_MANAGE)
  @Put()
  save(@ZBody(updateCompanySchema) dto: UpdateCompanyDto): Promise<CompanyProfileDto> {
    return this.company.save(dto);
  }

  /** multipart/form-data with one file field "logo". */
  @RequirePermissions(PERMISSIONS.CORE_COMPANY_MANAGE)
  @Put('logo')
  @UseInterceptors(FileInterceptor('logo'))
  setLogo(@UploadedFile() file: UploadedLogo | undefined): Promise<CompanyProfileDto> {
    return this.company.setLogo(file);
  }

  @RequirePermissions(PERMISSIONS.CORE_COMPANY_MANAGE)
  @Delete('logo')
  removeLogo(): Promise<CompanyProfileDto> {
    return this.company.removeLogo();
  }
}
