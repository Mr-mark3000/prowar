import { NextFunction, Request, Response } from 'express';
import { ZodError } from 'zod';

export class AppError extends Error {
  statusCode: number;
  code: string;
  details?: unknown;

  constructor(statusCode: number, message: string, code = 'BAD_REQUEST', details?: unknown) {
    super(message);
    this.statusCode = statusCode;
    this.code = code;
    this.details = details;
  }
}

export function asyncHandler(
  fn: (req: Request, res: Response, next: NextFunction) => Promise<unknown>
) {
  return (req: Request, res: Response, next: NextFunction) => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
}

export function errorHandler(
  err: unknown,
  _req: Request,
  res: Response,
  _next: NextFunction
): void {
  if (err instanceof AppError) {
    res.status(err.statusCode).json({
      error: err.message,
      code: err.code,
      details: err.details ?? undefined,
    });
    return;
  }

  if (err instanceof ZodError) {
    res.status(400).json({
      error: 'Validation failed',
      code: 'VALIDATION_ERROR',
      details: err.errors.map((e) => ({
        path: e.path.join('.'),
        message: e.message,
      })),
    });
    return;
  }

  // PostgreSQL constraint violations
  const pgErr = err as { code?: string; constraint?: string; detail?: string; message?: string };
  if (pgErr?.code === '23505') {
    res.status(409).json({
      error: 'Resource conflict: duplicate or already-allocated record',
      code: 'CONFLICT',
      constraint: pgErr.constraint,
    });
    return;
  }
  if (pgErr?.code === '23514') {
    res.status(400).json({
      error: 'Safety or integrity constraint violated',
      code: 'CONSTRAINT_VIOLATION',
      constraint: pgErr.constraint,
    });
    return;
  }
  if (pgErr?.code === '23503') {
    res.status(400).json({
      error: 'Invalid foreign key reference',
      code: 'INVALID_REFERENCE',
      constraint: pgErr.constraint,
    });
    return;
  }

  console.error('Unhandled API Error:', err);
  res.status(500).json({
    error: 'Internal server error',
    code: 'INTERNAL_ERROR',
  });
}
