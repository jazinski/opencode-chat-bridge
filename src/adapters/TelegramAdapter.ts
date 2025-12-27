import { Telegraf, Context, Markup } from 'telegraf';
import { message } from 'telegraf/filters';
import { ChatAdapter } from '@/adapters/BaseAdapter.js';
import { sessionManager } from '@/sessions/SessionManager.js';
import { chunkMessage } from '@/utils/messageFormatter.js';
import { logger } from '@/utils/logger.js';
import config from '@/config';
import fs from 'fs';
import path from 'path';
import type { Session } from '@/sessions/Session.js';

/** Streaming message state */
interface StreamingState {
  messageId: number;
  lastUpdateTime: number;
  accumulatedText: string;
  updateTimeoutId: NodeJS.Timeout | null;
  isComplete: boolean;
  isInitializing: boolean;
  pendingDeltas: string[];
}

/** Thinking indicator state (used before streaming starts) */
interface ThinkingState {
  messageId: number;
  intervalId: NodeJS.Timeout;
  startTime: number;
}

/** Minimum interval between message edits (ms) to respect Telegram rate limits */
const STREAM_UPDATE_INTERVAL = 1500;

/** Maximum text length before we stop streaming and wait for completion */
const MAX_STREAMING_LENGTH = 3500;

/** Thinking phrases to cycle through */
const THINKING_PHRASES = [
  '🤔 Thinking...',
  '🔍 Analyzing...',
  '💭 Processing...',
  '⚙️ Working on it...',
  '🧠 Reasoning...',
  '📝 Composing response...',
];

/**
 * Telegram bot adapter for OpenCode
 * Now uses the OpenCode Server API for clean structured output
 */
export class TelegramAdapter implements ChatAdapter {
  private bot: Telegraf;
  private isRunning: boolean = false;
  private thinkingStates: Map<string, ThinkingState> = new Map();
  private streamingStates: Map<string, StreamingState> = new Map();
  /** Track chats where termination message should be suppressed (user-initiated clear) */
  private suppressTerminationMessage: Set<string> = new Set();

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
      if (config.telegramAllowedUsers.length > 0 && !config.telegramAllowedUsers.includes(userId)) {
        logger.warn(`Unauthorized access attempt from user ${userId}`);
        await ctx.reply('⛔ You are not authorized to use this bot.');
        return;
      }

      return next();
    });

    // Command handlers
    this.bot.command('start', this.handleStart.bind(this));
    this.bot.command('help', this.handleHelp.bind(this));
    this.bot.command('chat', this.handleChat.bind(this));
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
        `/chat - Free chat mode (no project needed)\n` +
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
   * /chat command - start or continue free-flowing chat mode (no project required)
   */
  private async handleChat(ctx: Context): Promise<void> {
    const chatId = String(ctx.chat?.id);
    const userId = String(ctx.from?.id);
    const text = (ctx.message as { text?: string })?.text || '';
    const args = text.split(/\s+/).slice(1);

    // Ensure the free chat directory exists
    if (!fs.existsSync(config.freeChatDir)) {
      fs.mkdirSync(config.freeChatDir, { recursive: true });
      logger.info(`Created free chat directory: ${config.freeChatDir}`);
    }

    // Check if user wants a fresh chat
    const isNewChat = args[0]?.toLowerCase() === 'new';

    let session = sessionManager.get(chatId);

    try {
      if (isNewChat && session) {
        // Clear the current session for a fresh start
        await sessionManager.clear(chatId);
        session = undefined;
      }

      if (session) {
        // Check if already in chat mode (same project path)
        if (session.toJSON().projectPath === config.freeChatDir) {
          await ctx.reply(
            `💬 *Free Chat Mode*\n\n` +
              `You're already in free chat mode! Just send me any message.\n\n` +
              `Use \`/chat new\` to start a fresh conversation.\n` +
              `Use \`/projects\` to switch to a project.`,
            { parse_mode: 'Markdown' }
          );
          return;
        }

        // Switch existing session to free chat
        await ctx.reply('💬 Switching to free chat mode...', { parse_mode: 'Markdown' });
        await session.switchProject(config.freeChatDir);
      } else {
        // Create new session for free chat
        session = sessionManager.getOrCreate(chatId, userId, config.freeChatDir);
        this.setupSessionOutput(chatId, session);
        await session.start();
      }

      // Persist the session
      sessionManager.persist(chatId);

      const freshNote = isNewChat ? ' (fresh start)' : '';
      await ctx.reply(
        `💬 *Free Chat Mode${freshNote}*\n\n` +
          `Ask me anything! I can help with general questions, brainstorming, writing, and more.\n\n` +
          `Use \`/chat new\` to start a fresh conversation.\n` +
          `Use \`/projects\` to switch to a coding project.`,
        { parse_mode: 'Markdown' }
      );
    } catch (error) {
      logger.error('Error switching to chat mode:', error);
      await ctx.reply('❌ Failed to start chat mode. Please try again.');
    }
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
      const buttons = projects
        .slice(0, 10)
        .map((project) => [Markup.button.callback(`📂 ${project}`, `switch:${project}`)]);

      await ctx.reply(`📁 *Available Projects*\n\nTap to switch, or use \`/switch <name>\``, {
        parse_mode: 'Markdown',
        ...Markup.inlineKeyboard(buttons),
      });
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

    try {
      if (session) {
        await ctx.reply(`🔄 Switching to project: *${projectName}*...`, {
          parse_mode: 'Markdown',
        });
        await session.switchProject(projectPath);
      } else {
        session = sessionManager.getOrCreate(chatId, userId, projectPath);
        this.setupSessionOutput(chatId, session);
        await session.start();
        await ctx.reply(`📂 Started session in: *${projectName}*`, {
          parse_mode: 'Markdown',
        });
      }

      // Persist the session
      sessionManager.persist(chatId);
    } catch (error) {
      logger.error('Error switching project:', error);
      await ctx.reply(`❌ Failed to switch to project: ${projectName}`);
    }
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
    const opencodeSessionId = session.getOpencodeSessionId();

    await ctx.reply(
      `📊 *Session Status*\n\n` +
        `Status: ${status}\n` +
        `Process: ${running}\n` +
        `Project: \`${data.projectPath}\`\n` +
        `OpenCode Session: \`${opencodeSessionId || 'N/A'}\`\n` +
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

    // Suppress the 'terminated' event message since we'll send our own
    this.suppressTerminationMessage.add(chatId);

    if (await sessionManager.clear(chatId)) {
      await ctx.reply('🧹 Session cleared. Send a message to start a new one.');
    } else {
      await ctx.reply('📊 No active session to clear.');
    }

    // Clean up the flag after a short delay
    setTimeout(() => this.suppressTerminationMessage.delete(chatId), 1000);
  }

  /**
   * /stop command - interrupt current operation
   */
  private async handleStop(ctx: Context): Promise<void> {
    const chatId = String(ctx.chat?.id);
    const session = sessionManager.get(chatId);

    if (session?.isRunning()) {
      try {
        await session.interrupt();
        await ctx.reply('⏹ Operation interrupted');
      } catch (error) {
        logger.error('Error interrupting session:', error);
        await ctx.reply('❌ Failed to interrupt operation');
      }
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
    } else if (data === 'permission:once') {
      const session = sessionManager.get(chatId);
      if (session) {
        try {
          await session.replyToLatestPermission('once');
          await ctx.reply('✅ Allowed once');
        } catch (error) {
          logger.error('Error replying to permission:', error);
          await ctx.reply('❌ Failed to respond to permission');
        }
      }
    } else if (data === 'permission:always') {
      const session = sessionManager.get(chatId);
      if (session) {
        try {
          await session.replyToLatestPermission('always');
          await ctx.reply('✅ Always allowed');
        } catch (error) {
          logger.error('Error replying to permission:', error);
          await ctx.reply('❌ Failed to respond to permission');
        }
      }
    } else if (data === 'permission:reject') {
      const session = sessionManager.get(chatId);
      if (session) {
        try {
          await session.replyToLatestPermission('reject');
          await ctx.reply('❌ Rejected');
        } catch (error) {
          logger.error('Error replying to permission:', error);
          await ctx.reply('❌ Failed to respond to permission');
        }
      }
    } else if (data === 'confirm:yes') {
      // Legacy confirmation support - map to permission:once
      const session = sessionManager.get(chatId);
      if (session) {
        try {
          await session.sendConfirmation(true);
        } catch (error) {
          logger.error('Error sending confirmation:', error);
        }
      }
    } else if (data === 'confirm:no') {
      // Legacy confirmation support - map to permission:reject
      const session = sessionManager.get(chatId);
      if (session) {
        try {
          await session.sendConfirmation(false);
        } catch (error) {
          logger.error('Error sending confirmation:', error);
        }
      }
    }
  }

  /** Known commands (without the leading slash) */
  private static readonly KNOWN_COMMANDS = new Set([
    'start',
    'help',
    'chat',
    'projects',
    'switch',
    'status',
    'clear',
    'stop',
  ]);

  /**
   * Handle regular text messages
   */
  private async handleMessage(ctx: Context): Promise<void> {
    const chatId = String(ctx.chat?.id);
    const userId = String(ctx.from?.id);
    const text = (ctx.message as { text?: string })?.text || '';

    // Check for unknown commands (messages starting with / that aren't known)
    if (text.startsWith('/')) {
      const command = text.slice(1).split(/\s+/)[0].split('@')[0].toLowerCase();
      if (!TelegramAdapter.KNOWN_COMMANDS.has(command)) {
        await ctx.reply(
          `❓ Unknown command: \`/${command}\`\n\n` + `Use /help to see available commands.`,
          { parse_mode: 'Markdown' }
        );
        return;
      }
      // Known command - let the command handlers deal with it
      return;
    }

    logger.info(`Received message from ${chatId}: "${text.substring(0, 50)}..."`);

    // Get or create session
    let session = sessionManager.get(chatId);

    if (!session) {
      // Try to restore
      const restored = sessionManager.restore(chatId);
      if (restored) {
        session = restored;
        this.setupSessionOutput(chatId, session);
      }
    }

    if (!session) {
      // Create new session
      session = sessionManager.getOrCreate(chatId, userId);
      this.setupSessionOutput(chatId, session);
    }

    logger.info(`Session status: ${session.getStatus()}, isRunning: ${session.isRunning()}`);

    // Start if not running
    if (!session.isRunning()) {
      try {
        const isFreeChatMode = session.toJSON().projectPath === config.freeChatDir;
        if (isFreeChatMode) {
          await ctx.reply('💬 Starting free chat mode...');
        } else {
          await ctx.reply('🚀 Starting OpenCode session...');
        }
        await session.start();
        if (isFreeChatMode) {
          await ctx.reply(
            '✅ Ready! Ask me anything, or use `/projects` to switch to a coding project.',
            { parse_mode: 'Markdown' }
          );
        } else {
          await ctx.reply('✅ OpenCode session ready!');
        }
      } catch (error) {
        logger.error('Failed to start session:', error);
        await ctx.reply('❌ Failed to start OpenCode. Is it installed?');
        return;
      }
    }

    // Send the message
    try {
      logger.info(`Sending message to OpenCode session...`);

      // Start thinking indicator
      await this.startThinking(chatId);

      await session.sendMessage(text);
      logger.info(`Message sent successfully`);
    } catch (error) {
      // Stop thinking on error
      await this.stopThinking(chatId);
      logger.error('Failed to send message:', error);
      await ctx.reply('❌ Failed to send message to OpenCode');
    }
  }

  /**
   * Set up output handler for a session
   * Now handles structured output from OpenCode Server API with streaming support
   */
  private setupSessionOutput(chatId: string, session: Session | undefined): void {
    if (!session) return;

    // Handle regular output (called when session becomes idle with complete response)
    session.onOutput(async (data: string) => {
      // Stop thinking indicator when we get output
      await this.stopThinking(chatId);

      try {
        // Check if this looks like a permission request
        if (data.includes('*Permission Required*')) {
          // Clean up any streaming state first
          const streamState = this.streamingStates.get(chatId);
          if (streamState?.updateTimeoutId) {
            clearTimeout(streamState.updateTimeoutId);
          }
          this.streamingStates.delete(chatId);

          await this.bot.telegram.sendMessage(chatId, data, {
            parse_mode: 'Markdown',
            ...Markup.inlineKeyboard([
              [
                Markup.button.callback('✅ Allow Once', 'permission:once'),
                Markup.button.callback('✅ Always', 'permission:always'),
              ],
              [Markup.button.callback('❌ Reject', 'permission:reject')],
            ]),
          });
          return;
        }

        // Use streaming finalization to update the existing message or send new one
        await this.finalizeStreaming(chatId, data);
      } catch (error) {
        logger.error('Failed to send output to Telegram:', error);
        // Try without markdown if it fails (might have unescaped characters)
        try {
          await this.bot.telegram.sendMessage(chatId, data);
        } catch (retryError) {
          logger.error('Failed to send plain text output:', retryError);
        }
      }
    });

    // Handle permission events
    session.on('permission', async (permission) => {
      try {
        await this.bot.telegram.sendMessage(
          chatId,
          `🔐 *Permission Required*\n\n${permission.title}`,
          {
            parse_mode: 'Markdown',
            ...Markup.inlineKeyboard([
              [
                Markup.button.callback('✅ Allow Once', 'permission:once'),
                Markup.button.callback('✅ Always', 'permission:always'),
              ],
              [Markup.button.callback('❌ Reject', 'permission:reject')],
            ]),
          }
        );
      } catch (error) {
        logger.error('Failed to send permission request to Telegram:', error);
      }
    });

    // Handle streaming text - update message periodically as text arrives
    session.on('streaming', (delta: string) => {
      this.handleStreamingDelta(chatId, delta);
    });

    // Handle errors
    session.on('error', async (error) => {
      // Stop thinking indicator on error
      await this.stopThinking(chatId);

      // Clean up streaming state
      await this.cleanupStreaming(chatId);

      try {
        await this.bot.telegram.sendMessage(chatId, `❌ Error: ${error.message}`);
      } catch (sendError) {
        logger.error('Failed to send error to Telegram:', sendError);
      }
    });

    // Handle session terminated
    session.on('terminated', async () => {
      // Stop thinking indicator on termination
      await this.stopThinking(chatId);

      // Clean up streaming state
      await this.cleanupStreaming(chatId);

      // Only send termination message if not user-initiated (e.g., /clear)
      if (this.suppressTerminationMessage.has(chatId)) {
        return;
      }

      try {
        await this.bot.telegram.sendMessage(
          chatId,
          '📴 Session ended. Send a message to start a new one.'
        );
      } catch (sendError) {
        logger.error('Failed to send termination message:', sendError);
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
    const chunks = chunkMessage(message, 4096);
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

  /**
   * Start showing a thinking indicator for a chat
   */
  private async startThinking(chatId: string): Promise<void> {
    // Clear any existing thinking state
    await this.stopThinking(chatId);

    try {
      // Send initial thinking message
      const msg = await this.bot.telegram.sendMessage(chatId, THINKING_PHRASES[0]);

      // Start periodic updates
      let phraseIndex = 0;
      const intervalId = setInterval(async () => {
        try {
          // Send typing action
          await this.bot.telegram.sendChatAction(chatId, 'typing');

          // Update the thinking message with next phrase
          phraseIndex = (phraseIndex + 1) % THINKING_PHRASES.length;
          const state = this.thinkingStates.get(chatId);
          if (state) {
            const elapsed = Math.floor((Date.now() - state.startTime) / 1000);
            const timeStr = elapsed > 5 ? ` (${elapsed}s)` : '';
            await this.bot.telegram.editMessageText(
              chatId,
              state.messageId,
              undefined,
              `${THINKING_PHRASES[phraseIndex]}${timeStr}`
            );
          }
        } catch (error) {
          // Ignore edit errors (message might be deleted)
          logger.debug('Failed to update thinking indicator:', error);
        }
      }, 3000); // Update every 3 seconds

      this.thinkingStates.set(chatId, {
        messageId: msg.message_id,
        intervalId,
        startTime: Date.now(),
      });

      // Also send initial typing action
      await this.bot.telegram.sendChatAction(chatId, 'typing');
    } catch (error) {
      logger.error('Failed to start thinking indicator:', error);
    }
  }

  /**
   * Stop the thinking indicator for a chat
   */
  private async stopThinking(chatId: string): Promise<void> {
    const state = this.thinkingStates.get(chatId);
    if (!state) return;

    // Clear the interval
    clearInterval(state.intervalId);

    // Delete the thinking message
    try {
      await this.bot.telegram.deleteMessage(chatId, state.messageId);
    } catch (error) {
      // Ignore delete errors (message might already be deleted)
      logger.debug('Failed to delete thinking message:', error);
    }

    this.thinkingStates.delete(chatId);
  }

  /**
   * Clean up streaming state without finalizing (used on errors/termination)
   */
  private async cleanupStreaming(chatId: string): Promise<void> {
    const state = this.streamingStates.get(chatId);
    if (!state) return;

    // Clear any pending update timeout
    if (state.updateTimeoutId) {
      clearTimeout(state.updateTimeoutId);
    }

    // Delete the streaming message if it exists
    try {
      await this.bot.telegram.deleteMessage(chatId, state.messageId);
    } catch {
      // Ignore delete errors
    }

    this.streamingStates.delete(chatId);
  }

  /**
   * Handle incoming streaming delta from the session
   */
  private handleStreamingDelta(chatId: string, delta: string): void {
    let state = this.streamingStates.get(chatId);

    if (!state) {
      // First streaming delta - create a placeholder state immediately to prevent race conditions
      state = {
        messageId: 0, // Will be set by initializeStreaming
        lastUpdateTime: Date.now(),
        accumulatedText: delta,
        updateTimeoutId: null,
        isComplete: false,
        isInitializing: true,
        pendingDeltas: [],
      };
      this.streamingStates.set(chatId, state);

      // Initialize the streaming message (async)
      this.initializeStreaming(chatId, delta);
      return;
    }

    // If still initializing, queue the delta
    if (state.isInitializing) {
      state.pendingDeltas.push(delta);
      return;
    }

    // Accumulate the text
    state.accumulatedText += delta;

    // Schedule an update if we're not already waiting for one
    if (!state.updateTimeoutId) {
      const timeSinceLastUpdate = Date.now() - state.lastUpdateTime;
      const delay = Math.max(0, STREAM_UPDATE_INTERVAL - timeSinceLastUpdate);

      state.updateTimeoutId = setTimeout(() => {
        this.flushStreamingUpdate(chatId);
      }, delay);
    }
  }

  /**
   * Initialize streaming by converting the thinking message to a streaming message
   */
  private async initializeStreaming(chatId: string, initialText: string): Promise<void> {
    // Stop the thinking indicator first
    const thinkingState = this.thinkingStates.get(chatId);

    try {
      let messageId: number;

      if (thinkingState) {
        // Edit the thinking message to show initial streaming text
        clearInterval(thinkingState.intervalId);
        this.thinkingStates.delete(chatId);

        try {
          await this.bot.telegram.editMessageText(
            chatId,
            thinkingState.messageId,
            undefined,
            initialText
          );
          messageId = thinkingState.messageId;
        } catch {
          // If edit fails, send a new message
          const msg = await this.bot.telegram.sendMessage(chatId, initialText);
          messageId = msg.message_id;
        }
      } else {
        // No thinking message, send a new one
        const msg = await this.bot.telegram.sendMessage(chatId, initialText);
        messageId = msg.message_id;
      }

      // Update the streaming state with the message ID and process pending deltas
      const state = this.streamingStates.get(chatId);
      if (state) {
        state.messageId = messageId;
        state.isInitializing = false;

        // Add any pending deltas that arrived during initialization
        if (state.pendingDeltas.length > 0) {
          state.accumulatedText += state.pendingDeltas.join('');
          state.pendingDeltas = [];

          // Schedule an update to show the accumulated text
          if (!state.updateTimeoutId) {
            state.updateTimeoutId = setTimeout(() => {
              this.flushStreamingUpdate(chatId);
            }, STREAM_UPDATE_INTERVAL);
          }
        }
      }
    } catch (error) {
      logger.error('Failed to initialize streaming:', error);
      // Clean up on error
      this.streamingStates.delete(chatId);
    }
  }

  /**
   * Flush accumulated streaming text to Telegram
   */
  private async flushStreamingUpdate(chatId: string): Promise<void> {
    const state = this.streamingStates.get(chatId);
    if (!state || state.isComplete) return;

    state.updateTimeoutId = null;
    state.lastUpdateTime = Date.now();

    try {
      // Truncate if too long for a single message
      let displayText = state.accumulatedText;
      if (displayText.length > MAX_STREAMING_LENGTH) {
        displayText =
          displayText.substring(0, MAX_STREAMING_LENGTH) +
          '...\n\n_(streaming truncated, will show full response when complete)_';
      }

      await this.bot.telegram.editMessageText(chatId, state.messageId, undefined, displayText);

      // Send typing action to show we're still working
      await this.bot.telegram.sendChatAction(chatId, 'typing');
    } catch (error) {
      // Ignore edit errors (message might be deleted or unchanged)
      logger.debug('Failed to update streaming message:', error);
    }
  }

  /**
   * Finalize streaming when the response is complete
   * Called when session output is received (which happens on session.idle)
   */
  private async finalizeStreaming(chatId: string, finalText: string): Promise<void> {
    const state = this.streamingStates.get(chatId);

    // Clear any pending update timeout
    if (state?.updateTimeoutId) {
      clearTimeout(state.updateTimeoutId);
    }

    // Clean up streaming state
    this.streamingStates.delete(chatId);

    if (state) {
      // Edit the streaming message with final text (removing cursor)
      try {
        // Check if we need to chunk the message
        if (finalText.length <= 4096) {
          await this.bot.telegram.editMessageText(chatId, state.messageId, undefined, finalText, {
            parse_mode: 'Markdown',
          });
        } else {
          // Delete the streaming message and send chunked response
          try {
            await this.bot.telegram.deleteMessage(chatId, state.messageId);
          } catch {
            // Ignore delete errors
          }

          // Send chunked messages
          const chunks = chunkMessage(finalText, 4096);
          for (const chunk of chunks) {
            await this.bot.telegram.sendMessage(chatId, chunk, {
              parse_mode: 'Markdown',
            });
          }
        }
        return; // Successfully handled via streaming message
      } catch (error) {
        logger.debug('Failed to finalize streaming message, will send new message:', error);
        // Fall through to send new message
        try {
          await this.bot.telegram.deleteMessage(chatId, state.messageId);
        } catch {
          // Ignore delete errors
        }
      }
    }

    // No streaming state or edit failed - send as new message(s)
    try {
      const chunks = chunkMessage(finalText, 4096);
      for (const chunk of chunks) {
        await this.bot.telegram.sendMessage(chatId, chunk, {
          parse_mode: 'Markdown',
        });
      }
    } catch (error) {
      logger.error('Failed to send final message:', error);
      // Try without markdown
      try {
        await this.bot.telegram.sendMessage(chatId, finalText);
      } catch (retryError) {
        logger.error('Failed to send plain text final message:', retryError);
      }
    }
  }
}
