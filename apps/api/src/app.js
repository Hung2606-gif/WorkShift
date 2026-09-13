import cors from 'cors';
import { clerkMiddleware } from '@clerk/express';
import express from 'express';
import helmet from 'helmet';
import { getConfig } from './lib/config.js';
import { errorHandler } from './lib/errors.js';
import { adminRouter } from './routes/admin.js';
import { attendanceRouter } from './routes/attendance.js';
import { clerkWebhookRouter } from './routes/clerk-webhooks.js';
import { authRouter } from './routes/auth.js';
import { profileRouter } from './routes/profile.js';
import { companyRouter } from './routes/company.js';
import { systemAdminRouter } from './routes/system-admin.js';
import { supportRouter } from './routes/support.js';
import { employeeWorkspaceRouter, hrWorkspaceRouter } from './routes/workspace.js';
import { inboundEmailRouter } from './routes/inbound-email.js';
import { postgresRateLimit } from './middleware/postgres-rate-limit.js';

export function createApp() {
  const config = getConfig();
  const app = express();
  app.set('trust proxy', 1);
  // Webhooks are public and must keep their exact raw body for Svix verification.
  app.use('/api/v1/webhooks/clerk', express.raw({ type: 'application/json', limit: '1mb' }), clerkWebhookRouter);
  app.use(helmet({ crossOriginResourcePolicy: { policy: 'cross-origin' } }));
  app.use(cors({ origin: config.webOrigin, credentials: true }));
  app.use(clerkMiddleware({ authorizedParties: [config.webOrigin] }));
  app.use(express.json({ limit: '3mb' }));
  app.use(express.urlencoded({ extended: true, limit: '3mb' })); // Support SendGrid Inbound Parse urlencoded form data
  app.get('/', (_req, res) => res.json({ status: 'ok', service: 'workshift-api', health: '/health' }));
  app.get('/health', (_req, res) => res.json({ status: 'ok', service: 'workshift-api' }));
  app.use(postgresRateLimit({ scope: 'api', windowMs: 60_000, limit: 100 }));
  app.use('/api/v1/attendance', postgresRateLimit({ scope: 'attendance', windowMs: 60_000, limit: 8 }));

  app.use('/api/v1/auth', authRouter);
  app.use('/api/v1', profileRouter);
  app.use('/api/v1', companyRouter);
  app.use('/api/v1/attendance', attendanceRouter());
  app.use('/api/v1/admin', adminRouter);
  app.use('/api/v1/system', systemAdminRouter);
  app.use('/api/v1/support', supportRouter);
  app.use('/api/v1/hr', hrWorkspaceRouter);
  app.use('/api/v1/employee', employeeWorkspaceRouter);
  app.use('/api/v1/email', inboundEmailRouter);
  app.use(errorHandler);
  return app;
}

// Vercel's Express auto-detection may select this module as the function
// entrypoint. Keep the named factory for local startup/tests and also expose
// a valid Express handler for that deployment path.
export default createApp();
