import {
  Controller,
  Delete,
  Get,
  Header,
  HttpCode,
  Patch,
  Post,
  Res,
  StreamableFile,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import {
  createTaskSchema,
  PERMISSIONS,
  proofFieldsSchema,
  syncPullQuerySchema,
  syncPushSchema,
  taskListQuerySchema,
  updateTaskSchema,
  type CreateTaskDto,
  type Page,
  type ProofDto,
  type ProofFields,
  type SyncPullQuery,
  type SyncPullResponse,
  type SyncPushDto,
  type SyncPushResponse,
  type TaskDto,
  type TaskListQuery,
  type UpdateTaskDto,
} from '@victorflow/types';
import type { Response } from 'express';
import { CurrentUser, RequirePermissions, type Principal, RequiresFeature } from '../../common/decorators';
import { IdParam, ZBody, ZQuery } from '../../common/zod.pipe';
import { ProofsService, type UploadedImage } from './proofs.service';
import { SyncService } from './sync.service';
import { TasksService } from './tasks.service';

/** Mobile sync endpoints. Every one is authenticated and permission-guarded. */
@RequiresFeature('workforce')
@Controller('sync')
export class SyncController {
  constructor(
    private readonly sync: SyncService,
    private readonly proofs: ProofsService,
  ) {}

  @RequirePermissions(PERMISSIONS.WORKFORCE_TASK_UPDATE)
  @Post('push')
  @HttpCode(200)
  push(@ZBody(syncPushSchema) dto: SyncPushDto, @CurrentUser() user: Principal): Promise<SyncPushResponse> {
    return this.sync.push(user, dto);
  }

  @RequirePermissions(PERMISSIONS.WORKFORCE_TASK_READ)
  @Get('pull')
  pull(@ZQuery(syncPullQuerySchema) query: SyncPullQuery, @CurrentUser() user: Principal): Promise<SyncPullResponse> {
    return this.sync.pull(user, query.cursor, query.limit);
  }

  /** multipart/form-data: text fields (proofId, taskId, latitude, longitude, capturedAt) + file field "photo". */
  @RequirePermissions(PERMISSIONS.WORKFORCE_PROOF_CREATE)
  @Post('proofs')
  @UseInterceptors(FileInterceptor('photo')) // limits come from MulterModule (UPLOAD_MAX_BYTES)
  async uploadProof(
    @ZBody(proofFieldsSchema) fields: ProofFields,
    @UploadedFile() file: UploadedImage | undefined,
    @CurrentUser() user: Principal,
    @Res({ passthrough: true }) res: Response,
  ): Promise<ProofDto> {
    const { proof, created } = await this.proofs.upload(user, fields, file);
    res.status(created ? 201 : 200); // a replayed upload is a 200, the same record
    return proof;
  }
}

@RequiresFeature('workforce')
@Controller('workforce')
export class WorkforceController {
  constructor(
    private readonly tasks: TasksService,
    private readonly proofs: ProofsService,
  ) {}

  @RequirePermissions(PERMISSIONS.WORKFORCE_TASK_READ)
  @Get('tasks')
  list(@ZQuery(taskListQuerySchema) query: TaskListQuery, @CurrentUser() user: Principal): Promise<Page<TaskDto>> {
    return this.tasks.list(user, query);
  }

  @RequirePermissions(PERMISSIONS.WORKFORCE_TASK_READ)
  @Get('tasks/:id')
  get(@IdParam() id: string, @CurrentUser() user: Principal): Promise<TaskDto> {
    return this.tasks.get(user, id);
  }

  @RequirePermissions(PERMISSIONS.WORKFORCE_TASK_CREATE)
  @Post('tasks')
  create(@ZBody(createTaskSchema) dto: CreateTaskDto, @CurrentUser() user: Principal): Promise<TaskDto> {
    return this.tasks.create(dto, user.id);
  }

  @RequirePermissions(PERMISSIONS.WORKFORCE_TASK_CREATE)
  @Patch('tasks/:id')
  update(@IdParam() id: string, @ZBody(updateTaskSchema) dto: UpdateTaskDto): Promise<TaskDto> {
    return this.tasks.update(id, dto);
  }

  @RequirePermissions(PERMISSIONS.WORKFORCE_TASK_CREATE)
  @Delete('tasks/:id')
  @HttpCode(204)
  async remove(@IdParam() id: string): Promise<void> {
    await this.tasks.remove(id);
  }

  @RequirePermissions(PERMISSIONS.WORKFORCE_TASK_READ)
  @Get('proofs/:id/file')
  @Header('Cache-Control', 'private, max-age=3600')
  async proofFile(@IdParam() id: string, @CurrentUser() user: Principal, @Res({ passthrough: true }) res: Response): Promise<StreamableFile> {
    const { data, mime } = await this.proofs.file(user, id);
    res.setHeader('Content-Type', mime);
    res.setHeader('Content-Disposition', 'inline');
    return new StreamableFile(data);
  }
}
