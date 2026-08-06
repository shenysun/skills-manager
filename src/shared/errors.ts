export class SkillsManagerError extends Error {
  readonly code: string;
  readonly details?: unknown;

  constructor(code: string, message: string, details?: unknown) {
    super(message);
    this.name = 'SkillsManagerError';
    this.code = code;
    this.details = details;
  }
}

export function errorCode(error: unknown) {
  return error instanceof SkillsManagerError ? error.code : 'unexpected_error';
}

export function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}
