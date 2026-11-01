export type ErrorCode =
  | 'VALIDATION_ERROR'
  | 'UNAUTHENTICATED'
  | 'TOKEN_EXPIRED'
  | 'FORBIDDEN'
  | 'NOT_FOUND'
  | 'CONFLICT'
  | 'BOOKING_CONFLICT'
  | 'POLICY_VIOLATION'
  | 'RESOURCE_UNAVAILABLE'
  | 'INVALID_TIME_RANGE'
  | 'RATE_LIMITED'
  | 'UNSUPPORTED_FILE'
  | 'FILE_TOO_LARGE'
  | 'INTEGRATION_NOT_CONFIGURED'
  | 'INTEGRATION_ERROR'
  | 'INTERNAL_ERROR';

export class AppError extends Error {
  readonly status: number;
  readonly code: ErrorCode;
  readonly details?: unknown;
  readonly expose: boolean;

  constructor(status: number, code: ErrorCode, message: string, details?: unknown, expose = true) {
    super(message);
    this.name = 'AppError';
    this.status = status;
    this.code = code;
    this.details = details;
    this.expose = expose;
  }

  static badRequest(message: string, details?: unknown) {
    return new AppError(400, 'VALIDATION_ERROR', message, details);
  }
  static unauthenticated(message = 'Authentication required') {
    return new AppError(401, 'UNAUTHENTICATED', message);
  }
  static tokenExpired() {
    return new AppError(401, 'TOKEN_EXPIRED', 'Your session has expired. Please sign in again.');
  }
  static forbidden(message = 'You do not have permission to perform this action') {
    return new AppError(403, 'FORBIDDEN', message);
  }
  static notFound(entity = 'Resource') {
    return new AppError(404, 'NOT_FOUND', `${entity} not found`);
  }
  static conflict(message: string, details?: unknown) {
    return new AppError(409, 'CONFLICT', message, details);
  }
  static bookingConflict(message: string, details?: unknown) {
    return new AppError(409, 'BOOKING_CONFLICT', message, details);
  }
  static policy(message: string, details?: unknown) {
    return new AppError(422, 'POLICY_VIOLATION', message, details);
  }
  static unavailable(message: string, details?: unknown) {
    return new AppError(422, 'RESOURCE_UNAVAILABLE', message, details);
  }
  static invalidTime(message: string) {
    return new AppError(422, 'INVALID_TIME_RANGE', message);
  }
  static unsupportedFile(message: string) {
    return new AppError(415, 'UNSUPPORTED_FILE', message);
  }
  static fileTooLarge(message: string) {
    return new AppError(413, 'FILE_TOO_LARGE', message);
  }
  static integrationNotConfigured(provider: string, requiredEnv: string[]) {
    return new AppError(
      501,
      'INTEGRATION_NOT_CONFIGURED',
      `${provider} integration is not configured. Set ${requiredEnv.join(', ')} to enable it.`,
      { provider, requiredEnv },
    );
  }
  static internal(message = 'Something went wrong. Please try again.') {
    return new AppError(500, 'INTERNAL_ERROR', message, undefined, false);
  }
}
