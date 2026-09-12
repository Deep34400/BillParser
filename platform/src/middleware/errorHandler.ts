/**
 * Global error handler — catches AppError subclasses and sends consistent responses.
 *
 * Fastify calls this for any unhandled throw inside route handlers.
 * AppError subclasses carry their own statusCode, so the handler just reads it.
 * Unknown errors get a generic 500.
 */
import type { FastifyError, FastifyReply, FastifyRequest } from 'fastify';
import { AppError } from '../shared/errors.js';

export function errorHandler(
  error: FastifyError | Error,
  request: FastifyRequest,
  reply: FastifyReply,
): void {
  if (error instanceof AppError) {
    reply.status(error.statusCode).send({
      success: false,
      message: error.message,
    });
    return;
  }

  // Fastify validation errors (schema validation)
  const fastifyError = error as FastifyError;
  if (fastifyError.statusCode && fastifyError.statusCode < 500) {
    reply.status(fastifyError.statusCode).send({
      success: false,
      message: fastifyError.message,
    });
    return;
  }

  // Unexpected errors — log the full stack, return generic message
  request.log.error(error, 'Unhandled error');
  reply.status(500).send({
    success: false,
    message: 'Internal server error',
  });
}
