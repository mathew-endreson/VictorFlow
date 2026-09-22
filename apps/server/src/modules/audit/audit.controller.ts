import { Controller, Get } from '@nestjs/common';
import { auditListQuerySchema, PERMISSIONS, type AuditEntryDto, type AuditListQuery, type AuditVerifyDto, type Page } from '@victorflow/types';
import { RequiresFeature, RequirePermissions } from '../../common/decorators';
import { ZQuery } from '../../common/zod.pipe';
import { AuditService } from './audit.service';

@RequiresFeature('audit')
@Controller('audit')
export class AuditController {
  constructor(private readonly audit: AuditService) {}

  @RequirePermissions(PERMISSIONS.AUDIT_TRAIL_READ)
  @Get('trail')
  trail(@ZQuery(auditListQuerySchema) query: AuditListQuery): Promise<Page<AuditEntryDto>> {
    return this.audit.list(query);
  }

  @RequirePermissions(PERMISSIONS.AUDIT_TRAIL_VERIFY)
  @Get('verify')
  verify(): Promise<AuditVerifyDto> {
    return this.audit.verifyChain();
  }
}
