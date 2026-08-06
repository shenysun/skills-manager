import { errorCode, errorMessage } from './errors.js';

export type Ok<T> = { ok: true; data: T };
export type Err = { ok: false; error: { code: string; message: string; details?: unknown } };
export type Result<T> = Ok<T> | Err;

export function ok<T>(data: T): Ok<T> {
  return { ok: true, data };
}

export function err(code: string, message: string, details?: unknown): Err {
  return { ok: false, error: { code, message, details } };
}

export function fromThrowable<T>(fn: () => T): Result<T> {
  try {
    return ok(fn());
  } catch (error) {
    const details = error instanceof Error && 'details' in error ? (error as { details?: unknown }).details : undefined;
    return err(errorCode(error), errorMessage(error), details);
  }
}
