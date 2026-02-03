import { Session, SessionData } from '@/sessions/Session.js';
import { logger } from '@/utils/logger.js';
import config from '@/config';
import { getChatHistoryDB } from '@/database/ChatHistory.js';
import fs from 'fs';
import path from 'path';

/**
 * Manages all active OpenCode sessions
 * Maps chat IDs to sessions and handles lifecycle
 */
export class SessionManager {
  private sessions: Map<string, Session> = new Map();
  private cleanupInterval: NodeJS.Timeout | null = null;

  constructor() {
    // Start cleanup interval
    this.startCleanupInterval();

    // Ensure persistence directory exists
    this.ensurePersistDir();
  }

  /**
   * Ensure the session persistence directory exists
   */
  private ensurePersistDir(): void {
    if (!fs.existsSync(config.sessionPersistDir)) {
      fs.mkdirSync(config.sessionPersistDir, { recursive: true });
      logger.info(`Created session persistence directory: ${config.sessionPersistDir}`);
    }
  }

  /**
   * Start periodic cleanup of timed-out sessions
   */
  private startCleanupInterval(): void {
    // Check every minute
    this.cleanupInterval = setInterval(() => {
      this.cleanupTimedOutSessions();
    }, 60 * 1000);
  }

  /**
   * Clean up sessions that have timed out
   */
  private cleanupTimedOutSessions(): void {
    for (const [chatId, session] of this.sessions) {
      if (session.isTimedOut()) {
        logger.info(`Session ${session.id} timed out, terminating`);
        // Fire and forget - we don't need to wait for cleanup
        session.terminate().catch((err) => {
          logger.error(`Error terminating timed out session ${session.id}:`, err);
        });
        this.sessions.delete(chatId);
      }
    }
  }

  /**
   * Check if a chat ID represents a direct message (DM)
   * Slack DM channels start with 'D', Telegram DMs are numeric user IDs
   */
  private isDM(chatId: string): boolean {
    // Slack DMs start with 'D' (e.g., D0A65LJSSTU)
    // Telegram group chats are negative numbers, DMs are positive
    return chatId.startsWith('D') || (!chatId.startsWith('-') && !isNaN(Number(chatId)));
  }

  /**
   * Get platform from chatId
   */
  private getPlatform(chatId: string): 'slack' | 'telegram' {
    // Slack channel IDs start with C, D, or G
    return chatId.match(/^[CDG]/) ? 'slack' : 'telegram';
  }

  /**
   * Extract channel ID from composite chatId (format: channelId-userId or just channelId)
   */
  private extractChannelId(chatId: string): string {
    // For Slack: chatId is "channelId-userId", extract channelId
    // For Telegram: chatId is just the channel/user ID
    const parts = chatId.split('-');
    return parts[0];
  }

  /**
   * Get or create a session for a chat
   * If no projectPath is provided, defaults to free chat mode
   * Note: Session is NOT automatically started - caller must start it
   */
  getOrCreate(
    chatId: string, 
    userId: string, 
    projectPath?: string,
    model?: { providerID: string; modelID: string }
  ): Session {
    let session = this.sessions.get(chatId);

    if (!session || session.getStatus() === 'terminated') {
      // Default to free chat directory if no project specified
      const effectiveProjectPath = projectPath || config.freeChatDir;
      
      // Ensure the free chat directory exists
      if (!projectPath && !fs.existsSync(config.freeChatDir)) {
        fs.mkdirSync(config.freeChatDir, { recursive: true });
        logger.info(`Created free chat directory: ${config.freeChatDir}`);
      }
      
      // Determine timeout based on whether this is a DM or channel
      const timeoutMinutes = this.isDM(chatId) 
        ? config.dmSessionTimeoutMinutes 
        : config.sessionTimeoutMinutes;
      
      session = new Session(chatId, userId, effectiveProjectPath, timeoutMinutes, model);
      this.sessions.set(chatId, session);
    }

    return session;
  }

  /**
   * Inject conversation context into a session from chat history
   * Should be called after session.start() but before first user message
   */
  async injectContext(session: Session): Promise<{ injected: boolean; messageCount: number }> {
    try {
      const chatId = session.chatId;
      const platform = this.getPlatform(chatId);
      const channelId = this.extractChannelId(chatId);
      const historyDB = getChatHistoryDB();
      
      // Get recent messages within token limit
      const messagesResult = historyDB.getRecentMessagesWithTokenLimit(
        platform,
        channelId,
        config.contextInjectionMaxTokens
      );
      
      // Handle both sync and async results
      const messages = messagesResult instanceof Promise 
        ? await messagesResult 
        : messagesResult;
      
      if (messages.length === 0) {
        return { injected: false, messageCount: 0 };
      }
      
      // Format as context
      const contextLines = [
        '--- Previous conversation context ---',
        '',
      ];
      
      for (const msg of messages) {
        const userName = msg.user_name || msg.user_id;
        const timestamp = new Date(msg.timestamp * 1000).toISOString();
        contextLines.push(`[${timestamp}] ${userName}: ${msg.message_text}`);
      }
      
      contextLines.push('');
      contextLines.push('--- End of context ---');
      contextLines.push('');
      contextLines.push('Please continue the conversation based on the context above.');
      
      const contextMessage = contextLines.join('\n');
      
      logger.info(`Injecting ${messages.length} messages as context for ${chatId}`);
      
      // Send context as a system message (sync to ensure it's processed before user message)
      await session.sendMessageSync(contextMessage);
      
      return { injected: true, messageCount: messages.length };
    } catch (error) {
      logger.error(`Failed to inject context for ${session.chatId}:`, error);
      return { injected: false, messageCount: 0 };
    }
  }

  /**
   * Get context stats for a chat (how many messages would be injected)
   */
  async getContextStats(chatId: string): Promise<{ messageCount: number; oldestMessage: Date | null; newestMessage: Date | null }> {
    try {
      const platform = this.getPlatform(chatId);
      const channelId = this.extractChannelId(chatId);
      const historyDB = getChatHistoryDB();
      
      // Get recent messages within token limit
      const messagesResult = historyDB.getRecentMessagesWithTokenLimit(
        platform,
        channelId,
        config.contextInjectionMaxTokens
      );
      
      // Handle both sync and async results
      const messages = messagesResult instanceof Promise 
        ? await messagesResult 
        : messagesResult;
      
      if (messages.length === 0) {
        return { messageCount: 0, oldestMessage: null, newestMessage: null };
      }
      
      const oldestMessage = new Date(messages[0].timestamp * 1000);
      const newestMessage = new Date(messages[messages.length - 1].timestamp * 1000);
      
      return { messageCount: messages.length, oldestMessage, newestMessage };
    } catch (error) {
      logger.error(`Failed to get context stats for ${chatId}:`, error);
      return { messageCount: 0, oldestMessage: null, newestMessage: null };
    }
  }

  /**
   * Get an existing session
   */
  get(chatId: string): Session | undefined {
    return this.sessions.get(chatId);
  }

  /**
   * Check if a session exists
   */
  has(chatId: string): boolean {
    const session = this.sessions.get(chatId);
    return session !== undefined && session.getStatus() !== 'terminated';
  }

  /**
   * Clear/reset a session
   */
  async clear(chatId: string): Promise<boolean> {
    const session = this.sessions.get(chatId);
    if (session) {
      this.sessions.delete(chatId);
      this.deletePersistedSession(chatId);
      try {
        await session.terminate();
      } catch (err) {
        logger.error(`Error terminating session ${session.id}:`, err);
      }
      logger.info(`Session cleared for chat ${chatId}`);
      return true;
    }
    return false;
  }

  /**
   * Get all active sessions
   */
  getAll(): Session[] {
    return Array.from(this.sessions.values()).filter((s) => s.getStatus() !== 'terminated');
  }

  /**
   * Get session count
   */
  count(): number {
    return this.getAll().length;
  }

  /**
   * Persist a session to disk
   */
  persist(chatId: string): void {
    const session = this.sessions.get(chatId);
    if (session) {
      const data = session.toJSON();
      const filePath = this.getSessionFilePath(chatId);
      fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
      logger.debug(`Session persisted: ${chatId}`);
    }
  }

  /**
   * Restore a session from disk
   */
  restore(chatId: string): Session | null {
    const filePath = this.getSessionFilePath(chatId);

    if (!fs.existsSync(filePath)) {
      return null;
    }

    try {
      const raw = fs.readFileSync(filePath, 'utf-8');
      const data: SessionData = JSON.parse(raw);

      // Create a new session with the same project
      const session = new Session(data.chatId, data.userId, data.projectPath);
      this.sessions.set(chatId, session);

      logger.info(`Session restored for chat ${chatId}`);
      return session;
    } catch (error) {
      logger.error(`Failed to restore session for ${chatId}:`, error);
      return null;
    }
  }

  /**
   * Delete persisted session file
   */
  private deletePersistedSession(chatId: string): void {
    const filePath = this.getSessionFilePath(chatId);
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
      logger.debug(`Deleted persisted session: ${chatId}`);
    }
  }

  /**
   * Get the file path for a persisted session
   */
  private getSessionFilePath(chatId: string): string {
    return path.join(config.sessionPersistDir, `${chatId}.json`);
  }

  /**
   * List all persisted sessions
   */
  listPersistedSessions(): string[] {
    if (!fs.existsSync(config.sessionPersistDir)) {
      return [];
    }

    return fs
      .readdirSync(config.sessionPersistDir)
      .filter((f) => f.endsWith('.json'))
      .map((f) => f.replace('.json', ''));
  }

  /**
   * Shutdown all sessions
   */
  async shutdown(): Promise<void> {
    logger.info('Shutting down all sessions...');

    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
      this.cleanupInterval = null;
    }

    // Persist all sessions first
    for (const chatId of this.sessions.keys()) {
      this.persist(chatId);
    }

    // Terminate all sessions concurrently
    const terminationPromises = Array.from(this.sessions.values()).map((session) =>
      session.terminate().catch((err) => {
        logger.error(`Error terminating session ${session.id}:`, err);
      })
    );

    await Promise.all(terminationPromises);

    this.sessions.clear();
    logger.info('All sessions shut down');
  }
}

// Singleton instance
export const sessionManager = new SessionManager();
export default sessionManager;
