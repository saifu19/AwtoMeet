import { FastifyError, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { ForbiddenError } from '../authz/index.js';

const isProduction = () => process.env.NODE_ENV === 'production';

export function errorHandler(
  error: FastifyError,
  request: FastifyRequest,
  reply: FastifyReply,
) {
  if (error instanceof ForbiddenError) {
    return reply.code(404).send({
      error: 'Not Found',
      message: 'not_found',
      status_code: 404,
    });
  }

  if (error instanceof z.ZodError) {
    return reply.code(400).send({
      error: 'Validation',
      message: error.issues
        .map((e) => `${e.path.join('.')}: ${e.message}`)
        .join('; '),
      status_code: 400,
    });
  }

  const err = error as Error & { statusCode?: number };
  const statusCode = err.statusCode ?? 500;

  // 4xx errors are caller faults: safe to echo the message back so clients can
  // debug. 5xx are server faults: the message may contain SQL, file paths,
  // driver internals, etc. — log it server-side and send a generic response.
  if (statusCode >= 500) {
    request.log.error({ err }, 'unhandled server error');
    reply.code(statusCode).send({
      error: 'Internal Server Error',
      message: isProduction() ? 'internal_error' : err.message,
      status_code: statusCode,
    });
    return;
  }

  reply.code(statusCode).send({
    error: err.name,
    message: err.message,
    status_code: statusCode,
  });
}
