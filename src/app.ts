import express, { type NextFunction, type Request, type Response } from 'express';
import { checkHealth } from './lib/health';
import { httpLogger, logger } from './lib/logger';
import { handleInboundWebhook, handleStatusWebhook } from './webhooks/twilio.controller';
import { validateTwilioSignature } from './webhooks/twilio.validate';

export function createApp() {
  const app = express();

  app.use(httpLogger);
  // Twilio sends application/x-www-form-urlencoded webhook payloads; extended:false
  // matches the flat key-value shape Twilio signs (docs/TRD.md §5.1).
  app.use(express.urlencoded({ extended: false }));
  app.use(express.json());

  app.get('/health', async (_req: Request, res: Response) => {
    const status = await checkHealth();
    res.status(status.ok ? 200 : 503).json(status);
  });

  app.post(
    '/webhooks/twilio/inbound',
    validateTwilioSignature,
    asyncHandler(handleInboundWebhook),
  );

  app.post(
    '/webhooks/twilio/status',
    validateTwilioSignature,
    asyncHandler(handleStatusWebhook),
  );

  app.use((_req: Request, res: Response) => {
    res.status(404).json({ error: 'Not found' });
  });

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
    logger.error({ err: err.message, stack: err.stack }, 'Unhandled error');
    res.status(500).json({ error: 'Internal server error' });
  });

  return app;
}

function asyncHandler(
  fn: (req: Request, res: Response) => Promise<void>,
): (req: Request, res: Response, next: NextFunction) => void {
  return (req, res, next) => {
    fn(req, res).catch(next);
  };
}
