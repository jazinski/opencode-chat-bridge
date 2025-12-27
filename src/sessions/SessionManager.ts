import { Session, SessionData } from './Session.js';
import { logger } from '../utils/logger.js';
import config from '../config/index.js';
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
        session.terminate();
        this.sessions.delete(chatId);
      }
    }
  }

  /**
   * Get or create a session for a chat
   */
  getOrCreate(chatId: string, userId: string, projectPath?: string): Session {
    let session = this.sessions.get(chatId);

    if (!session || session.getStatus() === 'terminated') {
      const effectiveProjectPath = projectPath || config.projectsDir;
      session = new Session(chatId, userId, effectiveProjectPath);
      this.sessions.set(chatId, session);
    }

    return session;
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
  clear(chatId: string): boolean {
    const session = this.sessions.get(chatId);
    if (session) {
      session.terminate();
      this.sessions.delete(chatId);
      this.deletePersistedSession(chatId);
      logger.info(`Session cleared for chat ${chatId}`);
      return true;
    }
    return false;
  }

  /**
   * Get all active sessions
   */
  getAll(): Session[] {
    return Array.from(this.sessions.values()).filter(
      (s) => s.getStatus() !== 'terminated'
    );
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
  shutdown(): void {
    logger.info('Shutting down all sessions...');

    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
      this.cleanupInterval = null;
    }

    for (const [chatId, session] of this.sessions) {
      // Persist before terminating
      this.persist(chatId);
      session.terminate();
    }

    this.sessions.clear();
    logger.info('All sessions shut down');
  }
}

// Singleton instance
export const sessionManager = new SessionManager();
export default sessionManager;