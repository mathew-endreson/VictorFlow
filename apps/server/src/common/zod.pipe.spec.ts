import { BadRequestException } from '@nestjs/common';
import { z } from 'zod';
import { ZodValidationPipe } from './zod.pipe';

const schema = z.object({ name: z.string().min(2), qty: z.coerce.number().int().default(1) });

describe('ZodValidationPipe', () => {
  const pipe = new ZodValidationPipe(schema);

  it('returns parsed data, applying defaults/coercion and stripping unknown keys', () => {
    expect(pipe.transform({ name: 'ab', qty: '3', hacker: 'x' })).toEqual({ name: 'ab', qty: 3 });
    expect(pipe.transform({ name: 'ab' })).toEqual({ name: 'ab', qty: 1 });
  });

  it('throws 400 with per-field issues', () => {
    try {
      pipe.transform({ name: 'a' });
      fail('should have thrown');
    } catch (e) {
      expect(e).toBeInstanceOf(BadRequestException);
      const body = (e as BadRequestException).getResponse() as { code: string; issues: Array<{ path: string }> };
      expect(body.code).toBe('VALIDATION_FAILED');
      expect(body.issues[0]?.path).toBe('name');
    }
  });
});
