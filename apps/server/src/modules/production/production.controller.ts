import { Controller, Get, HttpCode, Patch, Post } from '@nestjs/common';
import {
  PERMISSIONS,
  productionListQuerySchema,
  productionPatchSchema,
  transitionSchema,
  updateFsmTransitionSchema,
  updateWorkOrderSchema,
  workOrderListQuerySchema,
  type FsmDefinitionDto,
  type Page,
  type ProductionBoardDto,
  type ProductionListQuery,
  type ProductionOrderDetailDto,
  type ProductionOrderSummaryDto,
  type ProductionPatchDto,
  type ProductionStageDto,
  type TransitionDto,
  type UpdateFsmTransitionDto,
  type UpdateWorkOrderDto,
  type WorkOrderDto,
  type WorkOrderListQuery,
} from '@victorflow/types';
import { CurrentUser, RequirePermissions, type Principal, RequiresFeature } from '../../common/decorators';
import { IdParam, ZBody, ZQuery } from '../../common/zod.pipe';
import { ProductionService } from './production.service';

@RequiresFeature('production')
@Controller('production')
export class ProductionController {
  constructor(private readonly production: ProductionService) {}

  @RequirePermissions(PERMISSIONS.PRODUCTION_ORDER_READ)
  @Get('board')
  board(@CurrentUser() user: Principal): Promise<ProductionBoardDto> {
    return this.production.board(user);
  }

  @RequirePermissions(PERMISSIONS.PRODUCTION_ORDER_READ)
  @Get('orders')
  list(@ZQuery(productionListQuerySchema) query: ProductionListQuery): Promise<Page<ProductionOrderSummaryDto>> {
    return this.production.list(query);
  }

  @RequirePermissions(PERMISSIONS.PRODUCTION_ORDER_READ)
  @Get('orders/:id')
  get(@IdParam() id: string, @CurrentUser() user: Principal): Promise<ProductionOrderDetailDto> {
    return this.production.get(id, user);
  }

  /**
   * Route-level: the caller must be able to see production orders. The finer question — may THIS user perform THIS
   * move on THIS order, and is its guard satisfied — is answered per transition by the FSM engine from DB config.
   */
  @RequirePermissions(PERMISSIONS.PRODUCTION_ORDER_READ)
  @Post('orders/:id/transition')
  @HttpCode(200)
  transition(@IdParam() id: string, @ZBody(transitionSchema) dto: TransitionDto, @CurrentUser() user: Principal): Promise<ProductionOrderDetailDto> {
    return this.production.transition(id, dto, user);
  }

  @RequirePermissions(PERMISSIONS.PRODUCTION_WORKORDER_WRITE)
  @Patch('orders/:id')
  patch(@IdParam() id: string, @ZBody(productionPatchSchema) dto: ProductionPatchDto, @CurrentUser() user: Principal): Promise<ProductionOrderDetailDto> {
    return this.production.patch(id, dto, user);
  }

  @RequirePermissions(PERMISSIONS.PRODUCTION_WORKORDER_READ)
  @Get('work-orders')
  workOrders(@ZQuery(workOrderListQuerySchema) query: WorkOrderListQuery): Promise<Page<WorkOrderDto>> {
    return this.production.listWorkOrders(query);
  }

  @RequirePermissions(PERMISSIONS.PRODUCTION_WORKORDER_WRITE)
  @Patch('work-orders/:id')
  updateWorkOrder(@IdParam() id: string, @ZBody(updateWorkOrderSchema) dto: UpdateWorkOrderDto): Promise<WorkOrderDto> {
    return this.production.updateWorkOrder(id, dto);
  }

  @RequirePermissions(PERMISSIONS.PRODUCTION_WORKORDER_READ)
  @Get('stages')
  stages(): Promise<ProductionStageDto[]> {
    return this.production.stages();
  }

  @RequirePermissions(PERMISSIONS.PRODUCTION_FSM_READ)
  @Get('fsm')
  fsm(): Promise<FsmDefinitionDto> {
    return this.production.fsmDefinition();
  }

  @RequirePermissions(PERMISSIONS.PRODUCTION_FSM_MANAGE)
  @Patch('fsm/transitions/:id')
  updateTransition(@IdParam() id: string, @ZBody(updateFsmTransitionSchema) dto: UpdateFsmTransitionDto): Promise<FsmDefinitionDto> {
    return this.production.updateTransition(id, dto);
  }
}
