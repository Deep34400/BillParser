import { describe, it, expect } from 'vitest';
import { success, failure, validationError, notFound, serverError } from '../../src/lib/apiResponse.js';

describe('apiResponse helpers', () => {
  it('success() wraps data in standard envelope', () => {
    const r = success({ id: '1' }, 'Created');
    expect(r.success).toBe(true);
    expect(r.message).toBe('Created');
    expect(r.data).toEqual({ id: '1' });
    expect(r.errors).toEqual([]);
    expect(r.metadata).toEqual({});
  });

  it('success() accepts custom metadata', () => {
    const r = success([], 'OK', { total: 5 });
    expect(r.metadata).toEqual({ total: 5 });
  });

  it('failure() wraps errors in standard envelope', () => {
    const r = failure([{ code: 'E1', message: 'bad' }], 'Failed');
    expect(r.success).toBe(false);
    expect(r.data).toBeNull();
    expect(r.errors).toHaveLength(1);
    expect(r.errors[0].code).toBe('E1');
  });

  it('validationError() creates field-specific error', () => {
    const r = validationError('url', 'URL is required');
    expect(r.success).toBe(false);
    expect(r.errors[0].field).toBe('url');
    expect(r.errors[0].code).toBe('VALIDATION_ERROR');
  });

  it('notFound() creates entity-specific error', () => {
    const r = notFound('Bill', 'abc-123');
    expect(r.success).toBe(false);
    expect(r.errors[0].code).toBe('NOT_FOUND');
    expect(r.errors[0].message).toContain('abc-123');
  });

  it('serverError() creates internal error', () => {
    const r = serverError('DB connection failed');
    expect(r.success).toBe(false);
    expect(r.errors[0].code).toBe('INTERNAL_ERROR');
    expect(r.message).toBe('DB connection failed');
  });
});
