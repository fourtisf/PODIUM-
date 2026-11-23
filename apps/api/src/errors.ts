import type { ApiError, ApiErrorCode } from '@podium/shared';

/** An error with a stable code that is sent to the client as `{error: {code, message}}`. */
export class AppError extends Error {
  constructor(
    readonly status: number,
    readonly code: ApiErrorCode,
    message: string,
    readonly details?: Record<string, string | number | boolean>,
  ) {
    super(message);
  }
  body(): ApiError {
    return { error: { code: this.code, message: this.message, ...(this.details ? { details: this.details } : {}) } };
  }
}

export const unauthorized = (m = 'Sign in first.') => new AppError(401, 'unauthorized', m);
export const forbidden = (m = 'Not allowed.') => new AppError(403, 'forbidden', m);
export const invalid = (m = 'Invalid request.') => new AppError(400, 'invalid', m);
export const notFound = (m = 'Not found.') => new AppError(404, 'not_found', m);
export const conflict = (m = 'Conflict.') => new AppError(409, 'conflict', m);
export const notEnoughChips = () => new AppError(402, 'not_enough_chips', 'Not enough tChips. Refill opens once you are under 100.');
