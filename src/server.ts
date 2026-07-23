import { createApp } from './app';
import { env } from './config/env';
import { startJobsWorker } from './jobs/worker';
import { logger } from './lib/logger';

const app = createApp();

app.listen(env.PORT, () => {
  logger.info({ port: env.PORT, nodeEnv: env.NODE_ENV }, 'Woshmart backend listening');
});

// Same process as the API server — no separate worker deployment (CLAUDE.md rule 10).
startJobsWorker();
logger.info('Jobs worker started');
