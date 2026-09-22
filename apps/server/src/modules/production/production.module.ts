import { Module } from '@nestjs/common';
import { AllWorkOrdersCompletedGuard, GuardRegistry } from './fsm/guards';
import { FsmService } from './fsm/fsm.service';
import { ProductionController } from './production.controller';
import { ProductionService } from './production.service';

@Module({
  controllers: [ProductionController],
  // Register additional guards by adding a provider that implements FsmGuard and calls registry.register(this).
  providers: [GuardRegistry, AllWorkOrdersCompletedGuard, FsmService, ProductionService],
  exports: [ProductionService, FsmService],
})
export class ProductionModule {}
