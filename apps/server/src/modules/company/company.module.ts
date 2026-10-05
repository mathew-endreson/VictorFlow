import { Module } from '@nestjs/common';
import { MulterModule } from '@nestjs/platform-express';
import { COMPANY_LOGO_MAX_BYTES } from '@victorflow/types';
import { CompanyController } from './company.controller';
import { CompanyService } from './company.service';

@Module({
  // No `storage` option → the upload stays in memory. The cap is enforced WHILE streaming (→ 413), not after.
  imports: [MulterModule.register({ limits: { fileSize: COMPANY_LOGO_MAX_BYTES, files: 1, fields: 5 } })],
  controllers: [CompanyController],
  providers: [CompanyService],
  exports: [CompanyService],
})
export class CompanyModule {}
