import express, { Express, Request, Response, NextFunction } from 'express';
import apiRoutes from '@/server/routes/api.js';
import { logger } from '@/utils/logger.js';
import config from '@/config';

/**
 * Create and configure the Express application
 */
export function createApp(): Express {
  const app = express();

  // Middleware
  app.use(express.json());
  app.use(express.urlencoded({ extended: true }));

  // Request logging
  app.use((req: Request, _res: Response, next: NextFunction) => {
    logger.debug(`${req.method} ${req.path}`);
    next();
  });

  // API routes
  app.use('/api', apiRoutes);

  // Root endpoint
  app.get('/', (_req: Request, res: Response) => {
    res.json({
      name: 'OpenCode Chat Bridge',
      version: '1.0.0',
      status: 'running',
      endpoints: {
        health: 'GET /api/health',
        sessions: 'GET /api/sessions',
        session: 'GET /api/sessions/:chatId',
        clearSession: 'DELETE /api/sessions/:chatId',
        sendMessage: 'POST /api/sessions/:chatId/message',
        interrupt: 'POST /api/sessions/:chatId/interrupt',
      },
    });
  });

  // 404 handler
  app.use((_req: Request, res: Response) => {
    res.status(404).json({ error: 'Not found' });
  });

  // Error handler
  app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
    logger.error('Unhandled error:', err);
    res.status(500).json({ error: 'Internal server error' });
  });

  return app;
}

/**
 * Start the Express server
 */
export function startServer(app: Express): void {
  app.listen(config.port, () => {
    logger.info(`Server listening on port ${config.port}`);
  });
}
