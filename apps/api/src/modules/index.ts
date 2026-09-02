import type { FastifyInstance } from 'fastify';
import type { AppContext } from '../context';
import { registerHealthRoutes } from './health';
import { registerAuthRoutes } from './auth';
import { registerArchiveRoutes } from './archives';
import { registerInvitationRoutes } from './invitations';
import { registerConsentRoutes } from './consent';
import { registerObjectRoutes } from './objects';
import { registerSourceRoutes } from './sources';
import { registerInterviewRoutes } from './interviews';
import { registerMemoryRoutes } from './memories';
import { registerDerivedRoutes } from './derived';
import { registerQaRoutes } from './qa';
import { registerLifecycleRoutes } from './lifecycle';
import { registerBillingRoutes } from './billing';
import { registerAdminRoutes } from './admin';
import { registerFamilyQuestionRoutes } from './family-questions';
import { registerRealtimeRoutes } from '../realtime/routes';

export async function registerRoutes(app: FastifyInstance, ctx: AppContext): Promise<void> {
  registerHealthRoutes(app, ctx);
  registerAuthRoutes(app, ctx);
  registerArchiveRoutes(app, ctx);
  registerInvitationRoutes(app, ctx);
  registerConsentRoutes(app, ctx);
  registerObjectRoutes(app, ctx);
  registerSourceRoutes(app, ctx);
  registerInterviewRoutes(app, ctx);
  registerMemoryRoutes(app, ctx);
  registerDerivedRoutes(app, ctx);
  registerQaRoutes(app, ctx);
  registerLifecycleRoutes(app, ctx);
  registerBillingRoutes(app, ctx);
  registerAdminRoutes(app, ctx);
  registerRealtimeRoutes(app, ctx);
  registerFamilyQuestionRoutes(app, ctx);
}
