import slack from '@slack/bolt';
import { ChatAdapter } from '@/adapters/BaseAdapter.js';
import { sessionManager } from '@/sessions/SessionManager.js';
import { chunkMessage } from '@/utils/messageFormatter.js';
import { logger } from '@/utils/logger.js';
import config from '@/config';
import type { Session } from '@/sessions/Session.js';

const { App, LogLevel } = slack;

/**
 * Slack bot adapter for OpenCode
 * Uses Slack Bolt SDK with Socket Mode
 */
export class SlackAdapter implements ChatAdapter {
  private app: InstanceType<typeof App>;
  private isRunning: boolean = false;

  constructor() {
    if (!config.slackBotToken) {
      throw new Error('SLACK_BOT_TOKEN is required');
    }
    if (!config.slackAppToken) {
      throw new Error('SLACK_APP_TOKEN is required');
    }
    if (!config.slackSigningSecret) {
      throw new Error('SLACK_SIGNING_SECRET is required');
    }

    this.app = new App({
      token: config.slackBotToken,
      appToken: config.slackAppToken,
      signingSecret: config.slackSigningSecret,
      socketMode: true,
      logLevel: config.logLevel === 'debug' ? LogLevel.DEBUG : LogLevel.INFO,
    });

    this.setupHandlers();
  }

  /**
   * Set up message and command handlers
   */
  private setupHandlers(): void {
    // Authorization middleware
    this.app.use(async ({ payload, context, next }: any) => {
      // Check if channel is allowed (if restriction is set)
      if (
        'channel' in payload &&
        config.slackAllowedChannels.length > 0 &&
        !config.slackAllowedChannels.includes(payload.channel as string)
      ) {
        logger.warn(`Unauthorized access attempt from channel ${payload.channel}`);
        return;
      }

      await next();
    });

    // Handle direct messages and mentions
    this.app.message(async ({ message, say }: any) => {
      // Ignore bot messages and messages without text
      if (
        message.subtype === 'bot_message' ||
        !('text' in message) ||
        !message.text ||
        !('user' in message) ||
        !('channel' in message)
      ) {
        return;
      }

      const text = message.text;
      const userId = message.user;
      const channel = message.channel;
      const chatId = `${channel}-${userId}`; // Unique per user per channel

      logger.info(
        `Received message from Slack user ${userId} in ${channel}: "${text.substring(0, 50)}..."`
      );

      // Handle the message
      await this.handleMessage(channel, userId, chatId, text, say);
    });

    // Error handler
    this.app.error(async (error: any) => {
      logger.error('Slack app error:', error);
    });
  }

  /**
   * Handle regular text messages
   */
  private async handleMessage(
    channel: string,
    userId: string,
    chatId: string,
    text: string,
    say: any
  ): Promise<void> {
    logger.info(`Processing message from ${chatId}: "${text.substring(0, 50)}..."`);

    let session = sessionManager.get(chatId);

    if (!session) {
      const restored = sessionManager.restore(chatId);
      if (restored) {
        session = restored;
        this.setupSessionOutput(channel, chatId, session);
      }
    }

    if (!session) {
      session = sessionManager.getOrCreate(chatId, userId);
      this.setupSessionOutput(channel, chatId, session);
    }

    if (!session.isRunning()) {
      try {
        await say('🚀 Starting OpenCode session...');
        await session.start();
        await say('✅ OpenCode session ready!');
      } catch (error) {
        logger.error('Failed to start session:', error);
        await say('❌ Failed to start OpenCode. Is it installed?');
        return;
      }
    }

    try {
      logger.info(`Sending message to OpenCode session...`);
      await say('🤔 Thinking...');
      await session.sendMessage(text);
      logger.info(`Message sent successfully`);
    } catch (error) {
      logger.error('Failed to send message:', error);
      await say('❌ Failed to send message to OpenCode');
    }
  }

  /**
   * Set up output handler for a session
   */
  private setupSessionOutput(channel: string, chatId: string, session: Session | undefined): void {
    if (!session) return;

    // Handle regular output
    session.onOutput(async (data: string) => {
      try {
        const chunks = chunkMessage(data, 3000);
        for (const chunk of chunks) {
          await this.app.client.chat.postMessage({
            channel,
            text: chunk,
          });
        }
      } catch (error) {
        logger.error('Failed to send output to Slack:', error);
      }
    });

    // Handle errors
    session.on('error', async (error) => {
      try {
        await this.app.client.chat.postMessage({
          channel,
          text: `❌ Error: ${error.message}`,
        });
      } catch (sendError) {
        logger.error('Failed to send error to Slack:', sendError);
      }
    });

    // Handle session terminated
    session.on('terminated', async () => {
      try {
        await this.app.client.chat.postMessage({
          channel,
          text: '📴 Session ended. Send a message to start a new one.',
        });
      } catch (sendError) {
        logger.error('Failed to send termination message:', sendError);
      }
    });
  }

  /**
   * Start the Slack bot
   */
  async start(): Promise<void> {
    if (this.isRunning) {
      logger.warn('Slack bot already running');
      return;
    }

    logger.info('Starting Slack bot...');
    await this.app.start();
    this.isRunning = true;
    logger.info('Slack bot started successfully');
  }

  /**
   * Stop the Slack bot
   */
  async stop(): Promise<void> {
    if (!this.isRunning) return;

    logger.info('Stopping Slack bot...');
    await this.app.stop();
    this.isRunning = false;
  }

  /**
   * Send a message to a channel
   */
  async sendMessage(chatId: string, message: string): Promise<void> {
    const [channel] = chatId.split('-');
    const chunks = chunkMessage(message, 3000);
    for (const chunk of chunks) {
      await this.app.client.chat.postMessage({
        channel,
        text: chunk,
      });
    }
  }

  /**
   * Get adapter name
   */
  getName(): string {
    return 'slack';
  }
}
