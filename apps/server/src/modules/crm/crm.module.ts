import { Module } from '@nestjs/common';
import { CrmController } from './crm.controller';
import { CustomersService } from './customers.service';

@Module({
  controllers: [CrmController],
  providers: [CustomersService],
  exports: [CustomersService],
})
export class CrmModule {}
