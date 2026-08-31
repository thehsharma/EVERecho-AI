import type { FastifyInstance } from 'fastify';
import type { AppContext } from '../context';
import { registerHealthRoutes } from './health';
import { registerAuthRoutes } from './auth';
import { registerArchiveRoutes } from './archives';
import { registerInvitationRoutes } from './invitations';
import { registerConsentRoutes } from './consent';

export async function registerRoutes(app: FastifyInstance, ctx: AppContext): Promise<void> {
  registerHealthRoutes(app, ctx);
  registerAuthRoutes(app, ctx);
  registerArchiveRoutes(app, ctx);
  registerInvitationRoutes(app, ctx);
  registerConsentRoutes(app, ctx);
}
