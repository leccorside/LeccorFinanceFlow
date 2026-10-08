import { HttpStatus, Injectable, type PipeTransform } from '@nestjs/common';
import { z } from 'zod';
import { ApiException } from '../errors/api-error.js';

export interface ValidationIssue {
  path: string;
  code: string;
  message: string;
}

/**
 * Validates and parses one handler argument (body, param or query) with a Zod schema.
 * Used per parameter on purpose: tsx/Vitest (esbuild) do not emit the design-type
 * metadata a metatype-based global pipe would need.
 *
 * Error details list the path and rule, never the received value.
 */
@Injectable()
export class ZodValidationPipe<T extends z.ZodType> implements PipeTransform<
  unknown,
  z.infer<T>
> {
  constructor(private readonly schema: T) {}

  transform(value: unknown): z.infer<T> {
    const result = this.schema.safeParse(value);
    if (result.success) {
      return result.data;
    }

    const issues: ValidationIssue[] = result.error.issues.map((issue) => ({
      path: issue.path.map(String).join('.'),
      code: issue.code,
      message: issue.message,
    }));
    throw new ApiException(
      HttpStatus.BAD_REQUEST,
      'validation_failed',
      'Dados inválidos.',
      { issues },
    );
  }
}

/** Shorthand: `@Body(validate(schema))`. */
export function validate<T extends z.ZodType>(schema: T): ZodValidationPipe<T> {
  return new ZodValidationPipe(schema);
}

/**
 * Request DTOs must be strict: unknown keys (e.g. `ownerId`, `role`, `status`) are
 * rejected instead of silently stripped, so mass assignment attempts are visible.
 */
export function dto<Shape extends z.ZodRawShape>(shape: Shape) {
  return z.strictObject(shape);
}

/** `@Param('id', uuidParam)` — rejects non-UUID ids before any query runs. */
export const uuidParam = validate(z.uuid());
