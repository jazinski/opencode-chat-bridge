import { createApp, startServer } from '@/server/app.js';
import { TelegramAdapter } from '@/adapters/TelegramAdapter.js';
import { SlackAdapter } from '@/adapters/SlackAdapter.js';
import { sessionManager } from '@/sessions/SessionManager.js';
import { logger } from '@/utils/logger.js';
import config, { validateConfig } from '@/config';

async function main(): Promise<void> {
  logger.info('OpenCode Chat Bridge starting...');
  logger.info(`Environment: ${config.nodeEnv}`);
  logger.info(`Projects directory: ${config.projectsDir}`);

  // Validate configuration
  try {
    validateConfig();
  } catch (error) {
    logger.error('Configuration error:', error);
    process.exit(1);
  }

  // Create and start Express server
  const app = createApp();
  startServer(app);

  // Start Telegram adapter
  let telegramAdapter: TelegramAdapter | null = null;

  if (config.telegramBotToken) {
    try {
      telegramAdapter = new TelegramAdapter();
      await telegramAdapter.start();
      logger.info('Telegram bot started');
    } catch (error) {
      logger.error('Failed to start Telegram bot:', error);
    }
  } else {
    logger.info('TELEGRAM_BOT_TOKEN not set, Telegram bot disabled');
  }

  // Start Slack adapter
  let slackAdapter: SlackAdapter | null = null;

  if (config.slackBotToken && config.slackAppToken && config.slackSigningSecret) {
    try {
      slackAdapter = new SlackAdapter();
      await slackAdapter.start();
      logger.info('Slack bot started');
    } catch (error) {
      logger.error('Failed to start Slack bot:', error);
    }
  } else {
    logger.info('Slack credentials not set, Slack bot disabled');
  }

  // Graceful shutdown
  const shutdown = async (signal: string): Promise<void> => {
    logger.info(`Received ${signal}, shutting down...`);

    // Stop Telegram bot
    if (telegramAdapter) {
      await telegramAdapter.stop();
    }

    // Stop Slack bot
    if (slackAdapter) {
      await slackAdapter.stop();
    }

    // Shutdown sessions (will persist them)
    await sessionManager.shutdown();

    logger.info('Shutdown complete');
    process.exit(0);
  };

  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));

  logger.info('OpenCode Chat Bridge ready!');
}

main().catch((error) => {
  logger.error('Fatal error:', error);
  process.exit(1);
});
