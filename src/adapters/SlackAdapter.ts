import slack from '@slack/bolt';
import { ChatAdapter } from '@/adapters/BaseAdapter.js';
import { sessionManager } from '@/sessions/SessionManager.js';
import { chunkMessage } from '@/utils/messageFormatter.js';
import { logger } from '@/utils/logger.js';
import config from '@/config';
import fs from 'fs';
import path from 'path';
import type { Session } from '@/sessions/Session.js';
import { getChatHistoryDB } from '@/database/ChatHistory.js';

const { App, LogLevel } = slack;
const chatHistoryDB = getChatHistoryDB();

/** Thinking indicator state */
interface ThinkingState {
  channel: string;
  ts: string;
  intervalId: NodeJS.Timeout;
  startTime: number;
}

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
 * Slack bot adapter for OpenCode
 * Uses Slack Bolt SDK with Socket Mode
 */
export class SlackAdapter implements ChatAdapter {
  private app: InstanceType<typeof App>;
  private isRunning: boolean = false;
  private thinkingStates: Map<string, ThinkingState> = new Map();
  /** Track chats where termination message should be suppressed (user-initiated clear) */
  private suppressTerminationMessage: Set<string> = new Set();
  /** Cache bot user ID for mention detection */
  private botUserId: string | null = null;

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
      if (config.slackAllowedChannels.length > 0) {
        // Extract channel ID from different payload types
        const channelId =
          payload.channel || payload.channel_id || (payload.event && payload.event.channel);

        logger.info(
          `[Slack Auth] Checking channel authorization. Channel: ${channelId}, Allowed: ${config.slackAllowedChannels.join(',')}, Payload type: ${payload.type || 'unknown'}`
        );

        if (channelId && !config.slackAllowedChannels.includes(channelId)) {
          logger.warn(`Unauthorized access attempt from channel ${channelId}`);
          return;
        }
      }

      await next();
    });

    // Slash command handlers
    this.app.command('/projects', this.handleProjects.bind(this));
    this.app.command('/switch', this.handleSwitch.bind(this));
    this.app.command('/ai-status', this.handleStatus.bind(this));
    this.app.command('/clear', this.handleClear.bind(this));
    this.app.command('/stop', this.handleStop.bind(this));
    this.app.command('/help', this.handleHelp.bind(this));
    this.app.command('/chat', this.handleChat.bind(this));
    this.app.command('/search', this.handleSearch.bind(this));
    this.app.command('/history-stats', this.handleHistoryStats.bind(this));

    // Interactive button handler
    this.app.action(/^switch_project_/, this.handleProjectSwitch.bind(this));
    this.app.action('permission_once', this.handlePermissionOnce.bind(this));
    this.app.action('permission_always', this.handlePermissionAlways.bind(this));
    this.app.action('permission_reject', this.handlePermissionReject.bind(this));

    // Handle direct messages and mentions
    this.app.message(async ({ message, say, client }: any) => {
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
      const channelType = message.channel_type; // 'channel', 'group', 'im' (direct message)

      logger.info(
        `Received message from Slack user ${userId} in ${channel} (type: ${channelType}): "${text.substring(0, 50)}..."`
      );

      // Store message in chat history (always store, regardless of whether we respond)
      try {
        // Get user info for better context
        let userName = undefined;
        let channelName = undefined;

        try {
          const userInfo = await client.users.info({ user: userId });
          userName = userInfo.user?.real_name || userInfo.user?.name;
        } catch (error) {
          logger.debug('Failed to fetch user info:', error);
        }

        try {
          const channelInfo = await client.conversations.info({ channel });
          channelName = channelInfo.channel?.name;
        } catch (error) {
          logger.debug('Failed to fetch channel info:', error);
        }

        chatHistoryDB.storeMessage({
          platform: 'slack',
          channel_id: channel,
          channel_name: channelName,
          user_id: userId,
          user_name: userName,
          message_id: message.ts,
          thread_id: message.thread_ts,
          message_text: text,
          timestamp: parseFloat(message.ts),
        });

        logger.debug(`Stored message in chat history: ${message.ts}`);
      } catch (error) {
        logger.error('Failed to store message in chat history:', error);
        // Don't fail the whole message handling if storage fails
      }

      // Only respond to:
      // 1. Direct messages (channel_type === 'im')
      // 2. Messages that mention the bot (text contains bot user ID)
      const isDM = channelType === 'im';

      // Check if bot is mentioned using cached bot user ID
      let isBotMentioned = false;
      if (this.botUserId) {
        isBotMentioned = text.includes(`<@${this.botUserId}>`);
      }

      const shouldRespond = isDM || isBotMentioned;

      if (!shouldRespond) {
        logger.debug(`Message stored but not responding (not a DM or mention)`);
        return;
      }

      logger.info(`Responding to message (DM: ${isDM}, Mentioned: ${isBotMentioned})`);

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
      await this.startThinking(channel, chatId);

      // Check if we should inject chat history context
      let messageToSend = text;
      if (this.shouldInjectChatHistory(text)) {
        const contextText = await this.getChatHistoryContext(channel, text);
        if (contextText) {
          messageToSend =
            `${text}\n\n---\n**Relevant chat history:**\n${contextText}\n---\n` +
            `Please answer considering the chat history above.`;
          logger.info('Injected chat history context into message');
        }
      }

      await session.sendMessage(messageToSend);
      logger.info(`Message sent successfully`);
    } catch (error) {
      await this.stopThinking(chatId);
      logger.error('Failed to send message:', error);
      await say('❌ Failed to send message to OpenCode');
    }
  }

  /**
   * /help command
   */
  private async handleHelp({ command, ack, respond }: any): Promise<void> {
    await ack();

    await respond({
      text:
        `🤖 *OpenCode Chat Bridge*\n\n` +
        `I'm your bridge to OpenCode! Send me messages and I'll forward them to your OpenCode session.\n\n` +
        `*Commands:*\n` +
        `/chat - Free chat mode (no project needed)\n` +
        `/projects - List available projects\n` +
        `/switch <project> - Switch to a project\n` +
        `/ai-status - Show session status\n` +
        `/clear - Clear/reset session\n` +
        `/stop - Stop current operation\n` +
        `/search <query> - Search chat history\n` +
        `/history-stats - View chat history statistics\n` +
        `/help - Show this help\n\n` +
        `Send any text to interact with OpenCode!`,
    });
  }

  /**
   * /chat command - start or continue free-flowing chat mode
   */
  private async handleChat({ command, ack, respond }: any): Promise<void> {
    await ack();

    const channel = command.channel_id;
    const userId = command.user_id;
    const chatId = `${channel}-${userId}`;
    const args = command.text.trim().split(/\s+/);
    const isNewChat = args[0]?.toLowerCase() === 'new';

    // Ensure the free chat directory exists
    if (!fs.existsSync(config.freeChatDir)) {
      fs.mkdirSync(config.freeChatDir, { recursive: true });
      logger.info(`Created free chat directory: ${config.freeChatDir}`);
    }

    let session = sessionManager.get(chatId);

    try {
      if (isNewChat && session) {
        // Clear the current session for a fresh start
        await sessionManager.clear(chatId);
        session = undefined;
      }

      if (session) {
        // Check if already in chat mode
        if (session.toJSON().projectPath === config.freeChatDir) {
          await respond({
            text:
              `💬 *Free Chat Mode*\n\n` +
              `You're already in free chat mode! Just send me any message.\n\n` +
              `Use \`/chat new\` to start a fresh conversation.\n` +
              `Use \`/projects\` to switch to a project.`,
          });
          return;
        }

        // Switch existing session to free chat
        await respond({ text: '💬 Switching to free chat mode...' });
        await session.switchProject(config.freeChatDir);
      } else {
        // Create new session for free chat
        session = sessionManager.getOrCreate(chatId, userId, config.freeChatDir);
        this.setupSessionOutput(channel, chatId, session);
        await session.start();
      }

      // Persist the session
      sessionManager.persist(chatId);

      const freshNote = isNewChat ? ' (fresh start)' : '';
      await respond({
        text:
          `💬 *Free Chat Mode${freshNote}*\n\n` +
          `Ask me anything! I can help with general questions, brainstorming, writing, and more.\n\n` +
          `Use \`/chat new\` to start a fresh conversation.\n` +
          `Use \`/projects\` to switch to a coding project.`,
      });
    } catch (error) {
      logger.error('Error switching to chat mode:', error);
      await respond({ text: '❌ Failed to start chat mode. Please try again.' });
    }
  }

  /**
   * /projects command - list available projects with interactive buttons
   */
  private async handleProjects({ command, ack, respond }: any): Promise<void> {
    await ack();

    try {
      const projectsDir = config.projectsDir;

      if (!fs.existsSync(projectsDir)) {
        await respond({ text: `📁 Projects directory not found: ${projectsDir}` });
        return;
      }

      const entries = fs.readdirSync(projectsDir, { withFileTypes: true });
      const projects = entries
        .filter((entry) => entry.isDirectory() && !entry.name.startsWith('.'))
        .map((entry) => entry.name);

      if (projects.length === 0) {
        await respond({ text: '📁 No projects found in ' + projectsDir });
        return;
      }

      // Create buttons for projects (Slack allows up to 5 per row, max 25 elements)
      const buttons = projects.slice(0, 25).map((project) => ({
        type: 'button',
        text: { type: 'plain_text', text: `📂 ${project}` },
        action_id: `switch_project_${project}`,
        value: project,
      }));

      // Group buttons into rows of 5
      const rows = [];
      for (let i = 0; i < buttons.length; i += 5) {
        rows.push({
          type: 'actions',
          elements: buttons.slice(i, i + 5),
        });
      }

      await respond({
        text: '📁 Available Projects',
        blocks: [
          {
            type: 'section',
            text: {
              type: 'mrkdwn',
              text: '*📁 Available Projects*\n\nTap to switch, or use `/switch <name>`',
            },
          },
          ...rows,
        ],
      });
    } catch (error) {
      logger.error('Error listing projects:', error);
      await respond({ text: '❌ Error listing projects' });
    }
  }

  /**
   * /switch command - switch to a project
   */
  private async handleSwitch({ command, ack, respond }: any): Promise<void> {
    await ack();

    const channel = command.channel_id;
    const userId = command.user_id;
    const chatId = `${channel}-${userId}`;
    const projectName = command.text.trim();

    if (!projectName) {
      await respond({ text: 'Usage: `/switch <project-name>`' });
      return;
    }

    await this.switchToProject(channel, chatId, userId, projectName, respond);
  }

  /**
   * Switch to a project (helper method)
   */
  private async switchToProject(
    channel: string,
    chatId: string,
    userId: string,
    projectName: string,
    respond: any
  ): Promise<void> {
    const projectPath = path.join(config.projectsDir, projectName);

    if (!fs.existsSync(projectPath)) {
      await respond({ text: `❌ Project not found: ${projectName}` });
      return;
    }

    let session = sessionManager.get(chatId);

    try {
      if (session) {
        await respond({ text: `🔄 Switching to project: *${projectName}*...` });
        await session.switchProject(projectPath);
      } else {
        session = sessionManager.getOrCreate(chatId, userId, projectPath);
        this.setupSessionOutput(channel, chatId, session);
        await session.start();
        await respond({ text: `📂 Started session in: *${projectName}*` });
      }

      // Persist the session
      sessionManager.persist(chatId);
    } catch (error) {
      logger.error('Error switching project:', error);
      await respond({ text: `❌ Failed to switch to project: ${projectName}` });
    }
  }

  /**
   * /status command
   */
  private async handleStatus({ command, ack, respond }: any): Promise<void> {
    await ack();

    const channel = command.channel_id;
    const userId = command.user_id;
    const chatId = `${channel}-${userId}`;
    const session = sessionManager.get(chatId);

    if (!session) {
      await respond({ text: '📊 No active session. Send a message to start one.' });
      return;
    }

    const data = session.toJSON();
    const status = session.getStatus();
    const running = session.isRunning() ? '✅ Running' : '❌ Stopped';
    const opencodeSessionId = session.getOpencodeSessionId();

    await respond({
      text:
        `📊 *Session Status*\n\n` +
        `Status: ${status}\n` +
        `Process: ${running}\n` +
        `Project: \`${data.projectPath}\`\n` +
        `OpenCode Session: \`${opencodeSessionId || 'N/A'}\`\n` +
        `Created: ${data.createdAt.toISOString()}\n` +
        `Last Activity: ${data.lastActivity.toISOString()}`,
    });
  }

  /**
   * /clear command - reset session
   */
  private async handleClear({ command, ack, respond }: any): Promise<void> {
    await ack();

    const channel = command.channel_id;
    const userId = command.user_id;
    const chatId = `${channel}-${userId}`;

    // Suppress the 'terminated' event message since we'll send our own
    this.suppressTerminationMessage.add(chatId);

    if (await sessionManager.clear(chatId)) {
      await respond({ text: '🧹 Session cleared.' });
    } else {
      await respond({ text: '📊 No active session to clear.' });
    }

    // Clean up the flag after a short delay
    setTimeout(() => this.suppressTerminationMessage.delete(chatId), 1000);
  }

  /**
   * /stop command - interrupt current operation
   */
  private async handleStop({ command, ack, respond }: any): Promise<void> {
    await ack();

    const channel = command.channel_id;
    const userId = command.user_id;
    const chatId = `${channel}-${userId}`;
    const session = sessionManager.get(chatId);

    if (session?.isRunning()) {
      try {
        await session.interrupt();
        await respond({ text: '⏹ Operation interrupted' });
      } catch (error) {
        logger.error('Error interrupting session:', error);
        await respond({ text: '❌ Failed to interrupt operation' });
      }
    } else {
      await respond({ text: '📊 No running operation to stop.' });
    }
  }

  /**
   * /search command - search chat history
   */
  private async handleSearch({ command, ack, respond }: any): Promise<void> {
    await ack();

    const query = command.text.trim();
    if (!query) {
      await respond({
        text:
          '🔍 *Search Chat History*\n\n' +
          'Usage: `/search <query>`\n\n' +
          'Example: `/search database migration`',
      });
      return;
    }

    try {
      const channelId = command.channel_id;
      const results = await Promise.resolve(
        chatHistoryDB.searchMessages(query, 'slack', channelId, 10)
      );

      if (results.length === 0) {
        await respond({
          text: `🔍 No results found for "${query}"`,
        });
        return;
      }

      const formatTimestamp = (timestamp: number) => {
        const date = new Date(timestamp * 1000);
        return date.toLocaleString('en-US', {
          month: 'short',
          day: 'numeric',
          hour: '2-digit',
          minute: '2-digit',
        });
      };

      let response = `🔍 *Found ${results.length} message${results.length > 1 ? 's' : ''} matching "${query}"*\n\n`;

      for (const result of results) {
        const userName = result.user_name || result.user_id;
        const time = formatTimestamp(result.timestamp);
        // Remove HTML tags from snippet (FTS adds <b> tags)
        const snippet = result.snippet.replace(/<\/?b>/g, '*');

        response += `*${userName}* (${time})\n${snippet}\n\n`;
      }

      response += '_Use `/history-stats` to see storage statistics._';

      await respond({ text: response });
    } catch (error) {
      logger.error('Error searching chat history:', error);
      await respond({ text: '❌ Failed to search chat history' });
    }
  }

  /**
   * /history-stats command - show chat history statistics
   */
  private async handleHistoryStats({ command, ack, respond }: any): Promise<void> {
    await ack();

    try {
      const stats = await Promise.resolve(chatHistoryDB.getStats());

      if (stats.length === 0) {
        await respond({
          text: '📊 No chat history stored yet.',
        });
        return;
      }

      const slackStats: any = stats.find((s: any) => s.platform === 'slack');
      if (!slackStats) {
        await respond({
          text: '📊 No Slack chat history stored yet.',
        });
        return;
      }

      const formatDate = (timestamp: number) => {
        const date = new Date(timestamp * 1000);
        return date.toLocaleDateString('en-US', {
          year: 'numeric',
          month: 'short',
          day: 'numeric',
        });
      };

      const response =
        '📊 *Chat History Statistics*\n\n' +
        `*Messages stored:* ${slackStats.message_count.toLocaleString()}\n` +
        `*Channels:* ${slackStats.channel_count}\n` +
        `*Users:* ${slackStats.user_count}\n` +
        `*First message:* ${formatDate(slackStats.earliest_message)}\n` +
        `*Latest message:* ${formatDate(slackStats.latest_message)}\n\n` +
        '_Use `/search <query>` to search messages._';

      await respond({ text: response });
    } catch (error) {
      logger.error('Error getting chat history stats:', error);
      await respond({ text: '❌ Failed to get chat history statistics' });
    }
  }

  /**
   * Check if a message should trigger chat history context injection
   */
  private shouldInjectChatHistory(text: string): boolean {
    const lowerText = text.toLowerCase();

    // Keywords that suggest the user is referencing past conversations
    const historyKeywords = [
      'what did',
      'earlier',
      'previously',
      'before',
      'chat history',
      'discussed',
      'mentioned',
      'talked about',
      'said',
      'last time',
      'conversation',
      'we discussed',
      'you said',
      'i said',
      'remember when',
      'recall',
      'earlier today',
      'yesterday',
      'last week',
    ];

    return historyKeywords.some((keyword) => lowerText.includes(keyword));
  }

  /**
   * Get relevant chat history context for a query
   */
  private async getChatHistoryContext(channel: string, query: string): Promise<string | null> {
    try {
      // Search for relevant messages
      const searchResults = await Promise.resolve(
        chatHistoryDB.searchMessages(query, 'slack', channel, 5)
      );

      // Also get recent messages for general context
      const recentMessages = await Promise.resolve(
        chatHistoryDB.getRecentMessages('slack', channel, 10)
      );

      if (searchResults.length === 0 && recentMessages.length === 0) {
        return null;
      }

      let context = '';

      // Add search results if found
      if (searchResults.length > 0) {
        context += '**Relevant messages:**\n';
        for (const msg of searchResults) {
          const date = new Date(msg.timestamp * 1000);
          const timeStr = date.toLocaleString('en-US', {
            month: 'short',
            day: 'numeric',
            hour: '2-digit',
            minute: '2-digit',
          });
          const userName = msg.user_name || msg.user_id;
          context += `- [${timeStr}] ${userName}: ${msg.message_text}\n`;
        }
      }

      // Add recent messages for context
      if (recentMessages.length > 0) {
        if (context) context += '\n';
        context += '**Recent conversation:**\n';

        // Only show last 5 recent messages to keep context manageable
        const messagesToShow = recentMessages.slice(-5);
        for (const msg of messagesToShow) {
          const date = new Date(msg.timestamp * 1000);
          const timeStr = date.toLocaleString('en-US', {
            month: 'short',
            day: 'numeric',
            hour: '2-digit',
            minute: '2-digit',
          });
          const userName = msg.user_name || msg.user_id;
          // Truncate long messages
          const msgText =
            msg.message_text.length > 200
              ? msg.message_text.substring(0, 200) + '...'
              : msg.message_text;
          context += `- [${timeStr}] ${userName}: ${msgText}\n`;
        }
      }

      return context || null;
    } catch (error) {
      logger.error('Error getting chat history context:', error);
      return null;
    }
  }

  /**
   * Handle project switch button click
   */
  private async handleProjectSwitch({ ack, body, respond }: any): Promise<void> {
    await ack();

    const channel = body.channel.id;
    const userId = body.user.id;
    const chatId = `${channel}-${userId}`;
    const projectName = body.actions[0].value;

    await this.switchToProject(channel, chatId, userId, projectName, respond);
  }

  /**
   * Handle permission "Allow Once" button
   */
  private async handlePermissionOnce({ ack, body, respond }: any): Promise<void> {
    await ack();

    const channel = body.channel.id;
    const userId = body.user.id;
    const chatId = `${channel}-${userId}`;
    const session = sessionManager.get(chatId);

    if (session) {
      try {
        await session.replyToLatestPermission('once');
        await respond({ text: '✅ Allowed once' });
      } catch (error) {
        logger.error('Error replying to permission:', error);
        await respond({ text: '❌ Failed to respond to permission' });
      }
    }
  }

  /**
   * Handle permission "Always" button
   */
  private async handlePermissionAlways({ ack, body, respond }: any): Promise<void> {
    await ack();

    const channel = body.channel.id;
    const userId = body.user.id;
    const chatId = `${channel}-${userId}`;
    const session = sessionManager.get(chatId);

    if (session) {
      try {
        await session.replyToLatestPermission('always');
        await respond({ text: '✅ Always allowed' });
      } catch (error) {
        logger.error('Error replying to permission:', error);
        await respond({ text: '❌ Failed to respond to permission' });
      }
    }
  }

  /**
   * Handle permission "Reject" button
   */
  private async handlePermissionReject({ ack, body, respond }: any): Promise<void> {
    await ack();

    const channel = body.channel.id;
    const userId = body.user.id;
    const chatId = `${channel}-${userId}`;
    const session = sessionManager.get(chatId);

    if (session) {
      try {
        await session.replyToLatestPermission('reject');
        await respond({ text: '❌ Rejected' });
      } catch (error) {
        logger.error('Error replying to permission:', error);
        await respond({ text: '❌ Failed to respond to permission' });
      }
    }
  }

  /**
   * Start showing a thinking indicator for a chat
   */
  private async startThinking(channel: string, chatId: string): Promise<void> {
    // Clear any existing thinking state
    await this.stopThinking(chatId);

    try {
      // Send initial thinking message
      const result = await this.app.client.chat.postMessage({
        channel,
        text: THINKING_PHRASES[0],
      });

      if (!result.ts) return;

      // Start periodic updates
      let phraseIndex = 0;
      const intervalId = setInterval(async () => {
        try {
          phraseIndex = (phraseIndex + 1) % THINKING_PHRASES.length;
          const state = this.thinkingStates.get(chatId);
          if (state) {
            const elapsed = Math.floor((Date.now() - state.startTime) / 1000);
            const timeStr = elapsed > 5 ? ` (${elapsed}s)` : '';
            await this.app.client.chat.update({
              channel: state.channel,
              ts: state.ts,
              text: `${THINKING_PHRASES[phraseIndex]}${timeStr}`,
            });
          }
        } catch (error) {
          logger.debug('Failed to update thinking indicator:', error);
        }
      }, 3000); // Update every 3 seconds

      this.thinkingStates.set(chatId, {
        channel,
        ts: result.ts,
        intervalId,
        startTime: Date.now(),
      });
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
      await this.app.client.chat.delete({
        channel: state.channel,
        ts: state.ts,
      });
    } catch (error) {
      logger.debug('Failed to delete thinking message:', error);
    }

    this.thinkingStates.delete(chatId);
  }

  /**
   * Set up output handler for a session
   */
  private setupSessionOutput(channel: string, chatId: string, session: Session | undefined): void {
    if (!session) return;

    // Handle regular output
    session.onOutput(async (data: string) => {
      // Stop thinking indicator when we get output
      await this.stopThinking(chatId);

      try {
        // Check if this looks like a permission request
        if (data.includes('*Permission Required*')) {
          await this.app.client.chat.postMessage({
            channel,
            text: data,
            blocks: [
              {
                type: 'section',
                text: {
                  type: 'mrkdwn',
                  text: data,
                },
              },
              {
                type: 'actions',
                elements: [
                  {
                    type: 'button',
                    text: { type: 'plain_text', text: '✅ Allow Once' },
                    action_id: 'permission_once',
                    style: 'primary',
                  },
                  {
                    type: 'button',
                    text: { type: 'plain_text', text: '✅ Always' },
                    action_id: 'permission_always',
                  },
                  {
                    type: 'button',
                    text: { type: 'plain_text', text: '❌ Reject' },
                    action_id: 'permission_reject',
                    style: 'danger',
                  },
                ],
              },
            ],
          });
          return;
        }

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

    // Handle permission events
    session.on('permission', async (permission) => {
      try {
        await this.app.client.chat.postMessage({
          channel,
          text: `🔐 *Permission Required*\n\n${permission.title}`,
          blocks: [
            {
              type: 'section',
              text: {
                type: 'mrkdwn',
                text: `🔐 *Permission Required*\n\n${permission.title}`,
              },
            },
            {
              type: 'actions',
              elements: [
                {
                  type: 'button',
                  text: { type: 'plain_text', text: '✅ Allow Once' },
                  action_id: 'permission_once',
                  style: 'primary',
                },
                {
                  type: 'button',
                  text: { type: 'plain_text', text: '✅ Always' },
                  action_id: 'permission_always',
                },
                {
                  type: 'button',
                  text: { type: 'plain_text', text: '❌ Reject' },
                  action_id: 'permission_reject',
                  style: 'danger',
                },
              ],
            },
          ],
        });
      } catch (error) {
        logger.error('Failed to send permission request to Slack:', error);
      }
    });

    // Handle errors
    session.on('error', async (error) => {
      // Stop thinking indicator on error
      await this.stopThinking(chatId);

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
      // Stop thinking indicator on termination
      await this.stopThinking(chatId);

      // Only send termination message if not user-initiated (e.g., /clear)
      if (this.suppressTerminationMessage.has(chatId)) {
        return;
      }

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

    // Get bot user ID for mention detection
    try {
      const authInfo = await this.app.client.auth.test();
      this.botUserId = authInfo.user_id as string;
      logger.info(`Slack bot started successfully (Bot User ID: ${this.botUserId})`);
    } catch (error) {
      logger.error('Failed to get bot user ID:', error);
      logger.info('Slack bot started successfully');
    }
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
