import type { FastifyRequest } from 'fastify';

/**
 * Resolves the canonical base URL from the incoming HTTP request.
 * Fully RFC 7239 / reverse-proxy compliant:
 * - When behind an Nginx reverse proxy, respects X-Forwarded-Proto and X-Forwarded-Host.
 * - When accessed directly via VPS IP:Port, returns http://<ip>:<port>.
 * - When accessed via custom domain (HTTPS), returns https://<domain>.
 */
export function getRequestBaseUrl(request: FastifyRequest): string {
  const forwardedProto = request.headers['x-forwarded-proto'];
  let proto = 'http';
  if (typeof forwardedProto === 'string') {
    proto = forwardedProto.split(',')[0].trim().toLowerCase();
  } else if (request.protocol) {
    proto = request.protocol.toLowerCase();
  }

  const forwardedHost = request.headers['x-forwarded-host'];
  let host = '';
  if (typeof forwardedHost === 'string') {
    host = forwardedHost.split(',')[0].trim();
  } else if (request.headers.host) {
    host = request.headers.host.trim();
  } else {
    host = request.hostname || 'localhost';
  }

  return `${proto}://${host}`.replace(/\/+$/, '');
}
