/**
 * Custom error classes for consistent error handling across the application.
 *
 * Each error carries an HTTP status code so the global error handler
 * can translate it to the correct response without if-else chains.
 *
 * Usage:
 *   throw new NotFoundError('Invoice', billId);
 *   throw new ValidationError('start_date and end_date are required');
 *   throw new InsufficientBalanceError();
 */

export class AppError extends Error {
  readonly statusCode: number;

  constructor(message: string, statusCode: number) {
    super(message);
    this.name = this.constructor.name;
    this.statusCode = statusCode;
  }
}

export class NotFoundError extends AppError {
  constructor(resource: string, id?: string) {
    const detail = id ? `${resource} '${id}' not found` : `${resource} not found`;
    super(detail, 404);
  }
}

export class ValidationError extends AppError {
  constructor(message: string) {
    super(message, 400);
  }
}

export class AuthenticationError extends AppError {
  constructor(message = 'Authentication required') {
    super(message, 401);
  }
}

export class ForbiddenError extends AppError {
  constructor(message = 'Access denied') {
    super(message, 403);
  }
}

export class InsufficientBalanceError extends AppError {
  constructor() {
    super('Insufficient balance — contact admin to add balance', 402);
  }
}

export class UnsupportedFileError extends AppError {
  constructor(reason = 'Unsupported file type — only PDF or JPEG/PNG/WebP') {
    super(reason, 400);
  }
}

export class PipelineError extends AppError {
  constructor(message: string) {
    super(message, 502);
  }
}
