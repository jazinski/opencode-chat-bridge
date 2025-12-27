import { Telegraf, Context, Markup } from 'telegraf';
import { message } from 'telegraf/filters';
import { ChatAdapter, IncomingMessage } from './BaseAdapter.js';
import { sessionManager } from '../sessions/SessionManager.js';
import { formatForTelegram, detectConfirmationPrompt } from '../utils/outputParser.js';
import { logger } from '../utils/logger.js';
import config from '../config/index.js';
import fs from 'fs';
import path from 'path';

/**
 * Telegram bot adapter for OpenCode
 */
export class TelegramAdapter implements ChatAdapter {
  private bot: Telegraf;
  private isRunning: boolean = false;

  constructor() {
    if (!config.telegramBotToken) {
      throw new Error('TELEGRAM_BOT_TOKEN is required');
    }

    this.bot = new Telegraf(config.telegramBotToken);
    this.setupHandlers();
  }

  /**
   * Set up message and command handlers
   */
  private setupHandlers(): void {
    // Authorization middleware
    this.bot.use(async (ctx, next) => {
      const userId = ctx.from?.id;

      if (!userId) {
        logger.warn('Message received without user ID');
        return;
      }

      // Check if user is allowed
      if (
        config.telegramAllowedUsers.length > 0 &&
        !config.telegramAllowedUsers.includes(userId)
      ) {
        logger.warn(`Unauthorized access attempt from user ${userId}`);
        await ctx.reply('⛔ You are not authorized to use this bot.');
        return;
      }

      return next();
    });

    // Command handlers
    this.bot.command('start', this.handleStart.bind(this));
    this.bot.command('help', this.handleHelp.bind(this));
    this.bot.command('projects', this.handleProjects.bind(this));
    this.bot.command('switch', this.handleSwitch.bind(this));
    this.bot.command('status', this.handleStatus.bind(this));
    this.bot.command('clear', this.handleClear.bind(this));
    this.bot.command('stop', this.handleStop.bind(this));

    // Callback query handler (for buttons)
    this.bot.on('callback_query', this.handleCallback.bind(this));

    // Message handler
    this.bot.on(message('text'), this.handleMessage.bind(this));

    // Error handler
    this.bot.catch((err: unknown) => {
      logger.error('Telegram bot error:', err);
    });
  }

  /**
   * /start command
   */
  private async handleStart(ctx: Context): Promise<void> {
    const chatId = String(ctx.chat?.id);
    const userId = String(ctx.from?.id);

    await ctx.reply(
      `🤖 *OpenCode Chat Bridge*\n\n` +
        `I'm your bridge to OpenCode! Send me messages and I'll forward them to your OpenCode session.\n\n` +
        `*Commands:*\n` +
        `/projects - List available projects\n` +
        `/switch <project> - Switch to a project\n` +
        `/status - Show session status\n` +
        `/clear - Clear/reset session\n` +
        `/stop - Stop current operation\n` +
        `/help - Show this help\n\n` +
        `Send any text to interact with OpenCode!`,
      { parse_mode: 'Markdown' }
    );

    // Try to restore or create session
    let session = sessionManager.restore(chatId);
    if (!session) {
      session = sessionManager.getOrCreate(chatId, userId);
    }

    // Set up output handler
    this.setupSessionOutput(chatId, session);
  }

  /**
   * /help command
   */
  private async handleHelp(ctx: Context): Promise<void> {
    await this.handleStart(ctx);
  }

  /**
   * /projects command - list available projects
   */
  private async handleProjects(ctx: Context): Promise<void> {
    try {
      const projectsDir = config.projectsDir;

      if (!fs.existsSync(projectsDir)) {
        await ctx.reply(`📁 Projects directory not found: ${projectsDir}`);
        return;
      }

      const entries = fs.readdirSync(projectsDir, { withFileTypes: true });
      const projects = entries
        .filter((entry) => entry.isDirectory() && !entry.name.startsWith('.'))
        .map((entry) => entry.name);

      if (projects.length === 0) {
        await ctx.reply('📁 No projects found in ' + projectsDir);
        return;
      }

      // Create inline keyboard with project buttons
      const buttons = projects.slice(0, 10).map((project) => [
        Markup.button.callback(`📂 ${project}`, `switch:${project}`),
      ]);

      await ctx.reply(
        `📁 *Available Projects*\n\nTap to switch, or use \`/switch <name>\``,
        {
          parse_mode: 'Markdown',
          ...Markup.inlineKeyboard(buttons),
        }
      );
    } catch (error) {
      logger.error('Error listing projects:', error);
      await ctx.reply('❌ Error listing projects');
    }
  }

  /**
   * /switch command - switch to a project
   */
  private async handleSwitch(ctx: Context): Promise<void> {
    const chatId = String(ctx.chat?.id);
    const userId = String(ctx.from?.id);
    const text = (ctx.message as { text?: string })?.text || '';
    const args = text.split(/\s+/).slice(1);

    if (args.length === 0) {
      await ctx.reply('Usage: `/switch <project-name>`', { parse_mode: 'Markdown' });
      return;
    }

    const projectName = args.join(' ');
    await this.switchToProject(ctx, chatId, userId, projectName);
  }

  /**
   * Switch to a project
   */
  private async switchToProject(
    ctx: Context,
    chatId: string,
    userId: string,
    projectName: string
  ): Promise<void> {
    const projectPath = path.join(config.projectsDir, projectName);

    if (!fs.existsSync(projectPath)) {
      await ctx.reply(`❌ Project not found: ${projectName}`);
      return;
    }

    let session = sessionManager.get(chatId);

    if (session) {
      await ctx.reply(`🔄 Switching to project: *${projectName}*...`, {
        parse_mode: 'Markdown',
      });
      session.switchProject(projectPath);
    } else {
      session = sessionManager.getOrCreate(chatId, userId, projectPath);
      this.setupSessionOutput(chatId, session);
      session.start();
      await ctx.reply(`📂 Started session in: *${projectName}*`, {
        parse_mode: 'Markdown',
      });
    }

    // Persist the session
    sessionManager.persist(chatId);
  }

  /**
   * /status command
   */
  private async handleStatus(ctx: Context): Promise<void> {
    const chatId = String(ctx.chat?.id);
    const session = sessionManager.get(chatId);

    if (!session) {
      await ctx.reply('📊 No active session. Send a message to start one.');
      return;
    }

    const data = session.toJSON();
    const status = session.getStatus();
    const running = session.isRunning() ? '✅ Running' : '❌ Stopped';

    await ctx.reply(
      `📊 *Session Status*\n\n` +
        `Status: ${status}\n` +
        `Process: ${running}\n` +
        `Project: \`${data.projectPath}\`\n` +
        `Created: ${data.createdAt.toISOString()}\n` +
        `Last Activity: ${data.lastActivity.toISOString()}`,
      { parse_mode: 'Markdown' }
    );
  }

  /**
   * /clear command - reset session
   */
  private async handleClear(ctx: Context): Promise<void> {
    const chatId = String(ctx.chat?.id);

    if (sessionManager.clear(chatId)) {
      await ctx.reply('🧹 Session cleared. Send a message to start a new one.');
    } else {
      await ctx.reply('📊 No active session to clear.');
    }
  }

  /**
   * /stop command - interrupt current operation
   */
  private async handleStop(ctx: Context): Promise<void> {
    const chatId = String(ctx.chat?.id);
    const session = sessionManager.get(chatId);

    if (session?.isRunning()) {
      session.interrupt();
      await ctx.reply('⏹ Sent interrupt signal (Ctrl+C)');
    } else {
      await ctx.reply('📊 No running operation to stop.');
    }
  }

  /**
   * Handle callback queries (button presses)
   */
  private async handleCallback(ctx: Context): Promise<void> {
    const callbackQuery = ctx.callbackQuery;
    if (!callbackQuery || !('data' in callbackQuery)) return;

    const chatId = String(ctx.chat?.id);
    const userId = String(ctx.from?.id);
    const data = callbackQuery.data;

    // Answer the callback to remove loading state
    await ctx.answerCbQuery();

    if (data.startsWith('switch:')) {
      const projectName = data.substring(7);
      await this.switchToProject(ctx, chatId, userId, projectName);
    } else if (data === 'confirm:yes') {
      const session = sessionManager.get(chatId);
      if (session) {
        session.sendConfirmation(true);
      }
    } else if (data === 'confirm:no') {
      const session = sessionManager.get(chatId);
      if (session) {
        session.sendConfirmation(false);
      }
    }
  }

  /**
   * Handle regular text messages
   */
  private async handleMessage(ctx: Context): Promise<void> {
    const chatId = String(ctx.chat?.id);
    const userId = String(ctx.from?.id);
    const text = (ctx.message as { text?: string })?.text || '';

    // Get or create session
    let session = sessionManager.get(chatId);

    if (!session) {
      // Try to restore
      session = sessionManager.restore(chatId);
    }

    if (!session) {
      // Create new session
      session = sessionManager.getOrCreate(chatId, userId);
      this.setupSessionOutput(chatId, session);
    }

    // Start if not running
    if (!session.isRunning()) {
      try {
        session.start();
        await ctx.reply('🚀 Starting OpenCode session...', {
          reply_to_message_id: (ctx.message as { message_id?: number })?.message_id,
        });
      } catch (error) {
        logger.error('Failed to start session:', error);
        await ctx.reply('❌ Failed to start OpenCode. Is it installed?');
        return;
      }
    }

    // Send the message
    try {
      session.sendMessage(text);
    } catch (error) {
      logger.error('Failed to send message:', error);
      await ctx.reply('❌ Failed to send message to OpenCode');
    }
  }

  /**
   * Set up output handler for a session
   */
  private setupSessionOutput(chatId: string, session: ReturnType<typeof sessionManager.get>): void {
    if (!session) return;

    session.onOutput(async (data: string) => {
      try {
        // Check for confirmation prompt
        if (detectConfirmationPrompt(data)) {
          await this.bot.telegram.sendMessage(chatId, data, {
            ...Markup.inlineKeyboard([
              Markup.button.callback('✅ Yes', 'confirm:yes'),
              Markup.button.callback('❌ No', 'confirm:no'),
            ]),
          });
          return;
        }

        // Format and send output
        const chunks = formatForTelegram(data, { codeBlock: true });

        for (const chunk of chunks) {
          await this.bot.telegram.sendMessage(chatId, chunk, {
            parse_mode: 'Markdown',
          });
        }
      } catch (error) {
        logger.error('Failed to send output to Telegram:', error);
      }
    });
  }

  /**
   * Start the Telegram bot
   */
  async start(): Promise<void> {
    if (this.isRunning) {
      logger.warn('Telegram bot already running');
      return;
    }

    logger.info('Starting Telegram bot...');

    await this.bot.launch();
    this.isRunning = true;

    logger.info('Telegram bot started successfully');
  }

  /**
   * Stop the Telegram bot
   */
  async stop(): Promise<void> {
    if (!this.isRunning) return;

    logger.info('Stopping Telegram bot...');
    this.bot.stop('SIGTERM');
    this.isRunning = false;
  }

  /**
   * Send a message to a chat
   */
  async sendMessage(chatId: string, message: string): Promise<void> {
    const chunks = formatForTelegram(message);
    for (const chunk of chunks) {
      await this.bot.telegram.sendMessage(chatId, chunk);
    }
  }

  /**
   * Send a message with buttons
   */
  async sendWithButtons(
    chatId: string,
    message: string,
    buttons: Array<{ text: string; callbackData: string }>
  ): Promise<void> {
    const keyboard = buttons.map((b) => [Markup.button.callback(b.text, b.callbackData)]);

    await this.bot.telegram.sendMessage(chatId, message, {
      ...Markup.inlineKeyboard(keyboard),
    });
  }

  /**
   * Get adapter name
   */
  getName(): string {
    return 'telegram';
  }
}