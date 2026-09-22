import { z } from 'zod';
import { WORK_ORDER_STATUSES, type OrderStatus, type WorkOrderStatus } from '../enums';
import { isoDateSchema, paginationSchema, uuidSchema } from './common';

const stateCode = z.string().regex(/^[A-Z][A-Z0-9_]{1,29}$/, 'State codes are UPPER_SNAKE_CASE');

export const transitionSchema = z.object({
  to: stateCode,
  /** Required by transitions configured with requires_note (e.g. rejecting at quality check). */
  note: z.string().trim().min(1).max(500).optional(),
});
export type TransitionDto = z.infer<typeof transitionSchema>;

export const updateWorkOrderSchema = z
  .object({
    status: z.enum(WORK_ORDER_STATUSES),
    assignedTo: uuidSchema.nullable(),
    actualHours: z.string().regex(/^\d{1,4}(\.\d{1,2})?$/, 'Hours as a decimal string, e.g. "2.5"'),
  })
  .partial()
  .refine((v) => Object.keys(v).length > 0, 'Provide at least one field to update');
export type UpdateWorkOrderDto = z.infer<typeof updateWorkOrderSchema>;

export const productionListQuerySchema = paginationSchema.extend({
  status: stateCode.optional(),
});
export type ProductionListQuery = z.infer<typeof productionListQuerySchema>;

export const workOrderListQuerySchema = paginationSchema.extend({
  productionOrderId: uuidSchema.optional(),
  status: z.enum(WORK_ORDER_STATUSES).optional(),
  assignedTo: uuidSchema.optional(),
});
export type WorkOrderListQuery = z.infer<typeof workOrderListQuerySchema>;

export const updateFsmTransitionSchema = z
  .object({
    isActive: z.boolean(),
    permissionCode: z.string().regex(/^[a-z_]+\.[a-z_]+\.[a-z_]+$/),
    guardCode: z.string().regex(/^[A-Z][A-Z0-9_]{1,50}$/).nullable(),
    requiresNote: z.boolean(),
    label: z.string().trim().min(1).max(60),
  })
  .partial()
  .refine((v) => Object.keys(v).length > 0, 'Provide at least one field to update');
export type UpdateFsmTransitionDto = z.infer<typeof updateFsmTransitionSchema>;

export const productionPatchSchema = z
  .object({
    priority: z.number().int().min(1).max(5),
    dueDate: isoDateSchema.nullable(),
    notes: z.string().trim().max(2000).nullable(),
  })
  .partial()
  .refine((v) => Object.keys(v).length > 0, 'Provide at least one field to update');
export type ProductionPatchDto = z.infer<typeof productionPatchSchema>;

// ── responses ────────────────────────────────────────────────────────────────

export interface FsmStateDto {
  code: string;
  label: string;
  position: number;
  isInitial: boolean;
  isTerminal: boolean;
  color: string | null;
}

export interface FsmTransitionDto {
  id: string;
  from: string;
  to: string;
  label: string | null;
  permissionCode: string;
  guardCode: string | null;
  guardParams: Record<string, unknown>;
  requiresNote: boolean;
  isActive: boolean;
}

export interface FsmDefinitionDto {
  machine: string;
  states: FsmStateDto[];
  transitions: FsmTransitionDto[];
  /** Guard codes the server has an implementation for (the only thing that lives in code). */
  availableGuards: string[];
}

/** A move the CURRENT USER may attempt from a card's state (guards are checked when the move is made). */
export interface AllowedTransitionDto {
  to: string;
  label: string | null;
  requiresNote: boolean;
}

export interface ProductionCardDto {
  id: string;
  number: string;
  orderId: string;
  orderNumber: string;
  customerName: string;
  status: string;
  priority: number;
  dueDate: string | null;
  workOrdersTotal: number;
  workOrdersCompleted: number;
  allowedTransitions: AllowedTransitionDto[];
}

export interface ProductionColumnDto extends FsmStateDto {
  cards: ProductionCardDto[];
}

export interface ProductionBoardDto {
  columns: ProductionColumnDto[];
}

export interface WorkOrderDto {
  id: string;
  productionOrderId: string;
  productionOrderNumber: string;
  stageCode: string;
  stageName: string;
  title: string;
  status: WorkOrderStatus;
  assignedTo: string | null;
  assignedToName: string | null;
  plannedHours: string;
  actualHours: string;
  startedAt: string | null;
  completedAt: string | null;
}

export interface ProductionEventDto {
  id: string;
  fromStatus: string | null;
  toStatus: string;
  actorName: string | null;
  note: string | null;
  createdAt: string;
}

export interface ProductionOrderDetailDto {
  id: string;
  number: string;
  orderId: string;
  orderNumber: string;
  orderStatus: OrderStatus;
  customerName: string;
  status: string;
  priority: number;
  dueDate: string | null;
  notes: string | null;
  rejectionReason: string | null;
  createdAt: string;
  workOrders: WorkOrderDto[];
  events: ProductionEventDto[];
  allowedTransitions: AllowedTransitionDto[];
}

export interface ProductionOrderSummaryDto {
  id: string;
  number: string;
  orderId: string;
  orderNumber: string;
  customerName: string;
  status: string;
  priority: number;
  dueDate: string | null;
  createdAt: string;
}

export interface ProductionStageDto {
  id: string;
  code: string;
  name: string;
  position: number;
  autoCreate: boolean;
  defaultHours: string;
}
