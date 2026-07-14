import type { ApiResponse, ApiError } from '../models/types.js';

export function success<T>(data: T, message = '', metadata: Record<string, unknown> = {}): ApiResponse<T> {
  return { success: true, message, data, metadata, errors: [] };
}

export function failure(errors: ApiError[], message = 'Request failed', metadata: Record<string, unknown> = {}): ApiResponse<null> {
  return { success: false, message, data: null, metadata, errors };
}

export function validationError(field: string, message: string): ApiResponse<null> {
  return failure([{ code: 'VALIDATION_ERROR', message, field }], 'Validation failed');
}

export function notFound(entity: string, id: string): ApiResponse<null> {
  return failure([{ code: 'NOT_FOUND', message: `${entity} ${id} not found` }], 'Not found');
}

export function serverError(message = 'Internal server error'): ApiResponse<null> {
  return failure([{ code: 'INTERNAL_ERROR', message }], message);
}
