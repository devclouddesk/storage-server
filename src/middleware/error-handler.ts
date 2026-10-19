import type { FastifyError, FastifyReply, FastifyRequest } from 'fastify';
import { env } from '../config/env.js';

export function errorHandler(error: FastifyError, request: FastifyRequest, reply: FastifyReply) {
  const statusCode = error.statusCode || 500;

  // Handle Fastify multipart / file limit error
  if (error.code === 'FST_REQ_FILE_TOO_LARGE') {
    return reply.status(413).send({
      success: false,
      error: {
        code: 'FILE_TOO_LARGE',
        message: `File exceeds maximum allowed size of ${env.MAX_FILE_SIZE_MB}MB.`,
      },
    });
  }

  // Decompression bomb / Sharp error
  if (error.message?.includes('Input image exceeds pixel limit')) {
    return reply.status(400).send({
      success: false,
      error: {
        code: 'IMAGE_DECOMPRESSION_BOMB_DETECTED',
        message: 'The image dimensions exceed the safe processing threshold (50M pixels).',
      },
    });
  }

  request.log.error(error);

  reply.status(statusCode).send({
    success: false,
    error: {
      code: error.code || 'INTERNAL_SERVER_ERROR',
      message: statusCode >= 500 && env.NODE_ENV === 'production' 
        ? 'An unexpected error occurred while processing the media request.' 
        : error.message,
    },
  });
}
