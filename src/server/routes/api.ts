import express, { Request, Response, NextFunction } from 'express';
import { sessionManager } from '../sessions/SessionManager.js';
import { logger } from '../utils/logger.js';
import config from '../config/index.js';

const router = express.Router();

/**
 * API Key authentication middleware
 */
function requireApiKey(req: Request, res: Response, next: NextFunction): void {
  const apiKey = req.headers['x-api-key'] || req.query.apiKey;

  if (!apiKey || apiKey !== config.apiKey) {
    res.status(401).json({ error: 'Unauthorized: Invalid API key' });
    return;
  }

  next();
}

/**
 * Health check endpoint
 * GET /api/health
 */
router.get('/health', (_req: Request, res: Response) => {
  res.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    sessions: sessionManager.count(),
  });
});

/**
 * List all active sessions
 * GET /api/sessions
 */
router.get('/sessions', requireApiKey, (_req: Request, res: Response) => {
  const sessions = sessionManager.getAll().map((s) => s.toJSON());
  res.json({ sessions });
});

/**
 * Get a specific session
 * GET /api/sessions/:chatId
 */
router.get('/sessions/:chatId', requireApiKey, (req: Request, res: Response) => {
  const { chatId } = req.params;
  const session = sessionManager.get(chatId);

  if (!session) {
    res.status(404).json({ error: 'Session not found' });
    return;
  }

  res.json({
    session: session.toJSON(),
    status: session.getStatus(),
    running: session.isRunning(),
  });
});

/**
 * Clear a session
 * DELETE /api/sessions/:chatId
 */
router.delete('/sessions/:chatId', requireApiKey, (req: Request, res: Response) => {
  const { chatId } = req.params;
  const cleared = sessionManager.clear(chatId);

  if (cleared) {
    res.json({ message: 'Session cleared' });
  } else {
    res.status(404).json({ error: 'Session not found' });
  }
});

/**
 * Send a message to a session
 * POST /api/sessions/:chatId/message
 * Body: { message: string }
 */
router.post('/sessions/:chatId/message', requireApiKey, async (req: Request, res: Response) => {
  const { chatId } = req.params;
  const { message } = req.body;

  if (!message || typeof message !== 'string') {
    res.status(400).json({ error: 'Message is required' });
    return;
  }

  const session = sessionManager.get(chatId);

  if (!session) {
    res.status(404).json({ error: 'Session not found' });
    return;
  }

  if (!session.isRunning()) {
    res.status(400).json({ error: 'Session is not running' });
    return;
  }

  try {
    session.sendMessage(message);
    res.json({ message: 'Message sent' });
  } catch (error) {
    logger.error('Failed to send message:', error);
    res.status(500).json({ error: 'Failed to send message' });
  }
});

/**
 * Interrupt a session (Ctrl+C)
 * POST /api/sessions/:chatId/interrupt
 */
router.post('/sessions/:chatId/interrupt', requireApiKey, (req: Request, res: Response) => {
  const { chatId } = req.params;
  const session = sessionManager.get(chatId);

  if (!session) {
    res.status(404).json({ error: 'Session not found' });
    return;
  }

  if (!session.isRunning()) {
    res.status(400).json({ error: 'Session is not running' });
    return;
  }

  session.interrupt();
  res.json({ message: 'Interrupt signal sent' });
});

export default router;