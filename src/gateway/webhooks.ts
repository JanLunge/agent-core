import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import type { Router } from '../router/router.js';

export interface WebhookRoute {
  path: string;
  secret?: string;
  agentName?: string;
  channelPrefix?: string;
}

/**
 * Extract a text payload from an incoming webhook body.
 * Supports raw strings, JSON with text/message/content fields,
 * and JSON with an event field.
 */
function extractText(body: unknown): string {
  if (typeof body === 'string') {
    return body;
  }

  if (body && typeof body === 'object') {
    const obj = body as Record<string, unknown>;

    // Direct text fields
    for (const key of ['text', 'message', 'content']) {
      if (typeof obj[key] === 'string') {
        return obj[key] as string;
      }
    }

    // Event-style payloads
    if (typeof obj.event === 'string') {
      const rest = { ...obj };
      delete rest.event;
      const summary = Object.keys(rest).length > 0
        ? JSON.stringify(rest)
        : '';
      return `Webhook event: ${obj.event}${summary ? ': ' + summary : ''}`;
    }

    // Fallback: stringify the whole body
    return JSON.stringify(body);
  }

  return String(body);
}

export function registerWebhookRoutes(
  app: FastifyInstance,
  router: Router,
  routes: WebhookRoute[],
): void {
  for (const route of routes) {
    const channelType = `webhook-${route.channelPrefix ?? route.path.replace(/^\//, '')}`;

    app.post(route.path, async (request: FastifyRequest, reply: FastifyReply) => {
      // Auth check
      if (route.secret) {
        const provided = request.headers['x-webhook-secret'];
        if (provided !== route.secret) {
          return reply.status(401).send({ error: 'Invalid webhook secret' });
        }
      }

      const text = extractText(request.body);

      try {
        const result = await router.route({
          channelType,
          chatId: 'default',
          text,
          sender: 'webhook',
        });

        return { reply: result.reply };
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return reply.status(500).send({ error: message });
      }
    });

    console.log(`[webhook] registered POST ${route.path} → ${channelType}`);
  }
}
