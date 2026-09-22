import { Module } from '@nestjs/common';
import { AuditChainJob } from './audit-chain.job';
import { AuditController } from './audit.controller';
import { AuditService } from './audit.service';

@Module({
  controllers: [AuditController],
  providers: [AuditService, AuditChainJob],
  exports: [AuditService],
})
export class AuditModule {}
