import { BadRequestException, Body, Param, Query, type PipeTransform } from '@nestjs/common';
import { z, type ZodType } from 'zod';

/** Validates (and transforms) controller input with a shared zod schema. Unknown keys are stripped. */
export class ZodValidationPipe<T extends ZodType> implements PipeTransform<unknown, z.output<T>> {
  constructor(private readonly schema: T) {}

  transform(value: unknown): z.output<T> {
    const result = this.schema.safeParse(value);
    if (!result.success) {
      throw new BadRequestException({
        message: 'Validation failed',
        code: 'VALIDATION_FAILED',
        issues: result.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
      });
    }
    return result.data;
  }
}

export const ZBody = <T extends ZodType>(schema: T) => Body(new ZodValidationPipe(schema));
export const ZQuery = <T extends ZodType>(schema: T) => Query(new ZodValidationPipe(schema));
export const ZParam = <T extends ZodType>(name: string, schema: T) => Param(name, new ZodValidationPipe(schema));

/** `:id` route param — any 8-4-4-4-12 hex UUID. */
export const IdParam = (name = 'id') => ZParam(name, z.guid());
