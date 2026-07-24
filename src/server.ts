import { createApp } from './app';
import { env } from './config/env';
import { startJobsWorker } from './jobs/worker';
import { logger } from './lib/logger';
import { initSentry } from './lib/sentry';

// Initialized before the app is built, per Sentry's own setup guidance — a no-op if
// SENTRY_DSN isn't set yet.
initSentry();

const app = createApp();

app.listen(env.PORT, () => {
  logger.info({ port: env.PORT, nodeEnv: env.NODE_ENV }, 'Woshmart backend listening');
});

// Same process as the API server — no separate worker deployment (CLAUDE.md rule 10).
startJobsWorker();
logger.info('Jobs worker started');
