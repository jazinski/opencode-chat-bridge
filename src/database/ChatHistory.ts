import Database from 'better-sqlite3';
import { Pool, PoolClient } from 'pg';
import path from 'path';
import { logger } from '@/utils/logger.js';
import config from '@/config';

export interface ChatMessage {
  id?: number;
  platform: 'slack' | 'telegram';
  channel_id: string;
  channel_name?: string;
  user_id: string;
  user_name?: string;
  message_id: string; // Platform-specific message ID
  thread_id?: string; // For threaded conversations
  message_text: string;
  timestamp: number; // Unix timestamp in seconds
  created_at?: string; // ISO datetime when stored
}

export interface SearchResult extends ChatMessage {
  relevance: number;
  snippet: string;
}

export interface SearchOptions {
  platform?: string;
  channelId?: string;
  userId?: string; // Filter by user_id or user_name
  sinceTimestamp?: number; // Unix timestamp in seconds
  beforeTimestamp?: number; // Unix timestamp in seconds
  limit?: number;
  offset?: number;
}

/**
 * Abstract base class for chat history storage
 */
abstract class ChatHistoryBackend {
  abstract storeMessage(message: ChatMessage): Promise<number | bigint>;
  abstract getRecentMessages(
    platform: string,
    channelId: string,
    limit?: number,
    threadId?: string
  ): Promise<ChatMessage[]>;
  abstract getRecentMessagesWithTokenLimit(
    platform: string,
    channelId: string,
    maxTokens: number,
    threadId?: string
  ): Promise<ChatMessage[]>;
  abstract getMessagesByTimeRange(
    platform: string,
    channelId: string,
    startTimestamp: number,
    endTimestamp: number,
    limit?: number
  ): Promise<ChatMessage[]>;
  abstract searchMessages(query: string, options?: SearchOptions): Promise<SearchResult[]>;
  abstract getMessageContext(
    platform: string,
    channelId: string,
    timestamp: number,
    beforeCount?: number,
    afterCount?: number
  ): Promise<ChatMessage[]>;
  abstract getStats(): Promise<any[]>;
  abstract deleteOldMessages(daysOld: number): Promise<number>;
  abstract close(): Promise<void>;
}

/**
 * SQLite implementation
 */
class SQLiteChatHistory extends ChatHistoryBackend {
  private db: Database.Database;

  constructor(dbPath: string) {
    super();
    logger.info(`Initializing SQLite chat history database at ${dbPath}`);
    this.db = new Database(dbPath);
    this.db.pragma('journal_mode = WAL');
    this.initializeSchema();
  }

  private initializeSchema(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS messages (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        platform TEXT NOT NULL,
        channel_id TEXT NOT NULL,
        channel_name TEXT,
        user_id TEXT NOT NULL,
        user_name TEXT,
        message_id TEXT NOT NULL,
        thread_id TEXT,
        message_text TEXT NOT NULL,
        timestamp INTEGER NOT NULL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(platform, message_id)
      );

      CREATE INDEX IF NOT EXISTS idx_channel_timestamp 
        ON messages(channel_id, timestamp DESC);
      
      CREATE INDEX IF NOT EXISTS idx_thread 
        ON messages(thread_id) WHERE thread_id IS NOT NULL;
      
      CREATE INDEX IF NOT EXISTS idx_platform_channel 
        ON messages(platform, channel_id);

      -- Full-text search virtual table
      CREATE VIRTUAL TABLE IF NOT EXISTS messages_fts USING fts5(
        message_text,
        user_name,
        channel_name,
        content=messages,
        content_rowid=id
      );

      -- Triggers to keep FTS table in sync
      CREATE TRIGGER IF NOT EXISTS messages_ai AFTER INSERT ON messages BEGIN
        INSERT INTO messages_fts(rowid, message_text, user_name, channel_name)
        VALUES (new.id, new.message_text, new.user_name, new.channel_name);
      END;

      CREATE TRIGGER IF NOT EXISTS messages_ad AFTER DELETE ON messages BEGIN
        DELETE FROM messages_fts WHERE rowid = old.id;
      END;

      CREATE TRIGGER IF NOT EXISTS messages_au AFTER UPDATE ON messages BEGIN
        UPDATE messages_fts 
        SET message_text = new.message_text,
            user_name = new.user_name,
            channel_name = new.channel_name
        WHERE rowid = new.id;
      END;
    `);

    logger.info('SQLite chat history database schema initialized');
  }

  async storeMessage(message: ChatMessage): Promise<number | bigint> {
    const stmt = this.db.prepare(`
      INSERT OR REPLACE INTO messages 
        (platform, channel_id, channel_name, user_id, user_name, 
         message_id, thread_id, message_text, timestamp)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    const result = stmt.run(
      message.platform,
      message.channel_id,
      message.channel_name || null,
      message.user_id,
      message.user_name || null,
      message.message_id,
      message.thread_id || null,
      message.message_text,
      message.timestamp
    );

    return result.lastInsertRowid;
  }

  async getRecentMessages(
    platform: string,
    channelId: string,
    limit: number = 50,
    threadId?: string
  ): Promise<ChatMessage[]> {
    let query = `
      SELECT * FROM messages
      WHERE platform = ? AND channel_id = ?
    `;
    const params: any[] = [platform, channelId];

    if (threadId) {
      query += ` AND thread_id = ?`;
      params.push(threadId);
    }

    query += ` ORDER BY timestamp DESC LIMIT ?`;
    params.push(limit);

    const stmt = this.db.prepare(query);
    return stmt.all(...params) as ChatMessage[];
  }

  /**
   * Estimate tokens for a message (rough approximation: ~4 chars per token)
   */
  private estimateTokens(text: string): number {
    return Math.ceil(text.length / 4);
  }

  async getRecentMessagesWithTokenLimit(
    platform: string,
    channelId: string,
    maxTokens: number,
    threadId?: string
  ): Promise<ChatMessage[]> {
    // Fetch recent messages (more than we need, then trim)
    const messages = await this.getRecentMessages(platform, channelId, 500, threadId);

    // Build result from most recent, working backwards
    const result: ChatMessage[] = [];
    let tokenCount = 0;

    for (const message of messages) {
      const messageTokens = this.estimateTokens(message.message_text);

      if (tokenCount + messageTokens > maxTokens && result.length > 0) {
        break; // Stop when we hit the limit
      }

      result.push(message);
      tokenCount += messageTokens;
    }

    // Reverse to get chronological order (oldest to newest)
    return result.reverse();
  }

  async getMessagesByTimeRange(
    platform: string,
    channelId: string,
    startTimestamp: number,
    endTimestamp: number,
    limit: number = 1000
  ): Promise<ChatMessage[]> {
    const stmt = this.db.prepare(`
      SELECT * FROM messages
      WHERE platform = ? AND channel_id = ?
        AND timestamp >= ? AND timestamp <= ?
      ORDER BY timestamp ASC
      LIMIT ?
    `);

    return stmt.all(platform, channelId, startTimestamp, endTimestamp, limit) as ChatMessage[];
  }

  async searchMessages(query: string, options?: SearchOptions): Promise<SearchResult[]> {
    const {
      platform,
      channelId,
      userId,
      sinceTimestamp,
      beforeTimestamp,
      limit = 20,
      offset = 0,
    } = options || {};

    // Try FTS5 search with OR operator for more flexible matching
    // Convert query to FTS5 OR query: "word1 OR word2 OR word3"
    const ftsQuery = query
      .split(/\s+/)
      .filter((w) => w.length > 0)
      .join(' OR ');

    let sql = `
      SELECT 
        m.*,
        snippet(messages_fts, 0, '<b>', '</b>', '...', 32) as snippet,
        rank as relevance
      FROM messages_fts
      JOIN messages m ON messages_fts.rowid = m.id
      WHERE messages_fts MATCH ?
    `;
    const params: any[] = [ftsQuery];

    if (platform) {
      sql += ` AND m.platform = ?`;
      params.push(platform);
    }

    if (channelId) {
      sql += ` AND m.channel_id = ?`;
      params.push(channelId);
    }

    if (userId) {
      sql += ` AND (m.user_id = ? OR LOWER(m.user_name) LIKE ?)`;
      params.push(userId, `%${userId.toLowerCase()}%`);
    }

    if (sinceTimestamp !== undefined) {
      sql += ` AND m.timestamp >= ?`;
      params.push(sinceTimestamp);
    }

    if (beforeTimestamp !== undefined) {
      sql += ` AND m.timestamp <= ?`;
      params.push(beforeTimestamp);
    }

    sql += ` ORDER BY rank LIMIT ? OFFSET ?`;
    params.push(limit, offset);

    try {
      const stmt = this.db.prepare(sql);
      const results = stmt.all(...params) as SearchResult[];

      // If FTS returns no results, fallback to LIKE search
      if (results.length === 0) {
        logger.debug('FTS search returned no results, falling back to LIKE search');

        const words = query
          .toLowerCase()
          .split(/\s+/)
          .filter((w) => w.length > 2);
        if (words.length > 0) {
          let fallbackSql = `
            SELECT 
              *,
              1.0 as relevance,
              substr(message_text, 1, 100) || '...' as snippet
            FROM messages
            WHERE (${words.map(() => `LOWER(message_text) LIKE ?`).join(' OR ')})
          `;
          const fallbackParams: any[] = words.map((w) => `%${w}%`);

          if (platform) {
            fallbackSql += ` AND platform = ?`;
            fallbackParams.push(platform);
          }

          if (channelId) {
            fallbackSql += ` AND channel_id = ?`;
            fallbackParams.push(channelId);
          }

          if (userId) {
            fallbackSql += ` AND (user_id = ? OR LOWER(user_name) LIKE ?)`;
            fallbackParams.push(userId, `%${userId.toLowerCase()}%`);
          }

          if (sinceTimestamp !== undefined) {
            fallbackSql += ` AND timestamp >= ?`;
            fallbackParams.push(sinceTimestamp);
          }

          if (beforeTimestamp !== undefined) {
            fallbackSql += ` AND timestamp <= ?`;
            fallbackParams.push(beforeTimestamp);
          }

          fallbackSql += ` ORDER BY timestamp DESC LIMIT ? OFFSET ?`;
          fallbackParams.push(limit, offset);

          const fallbackStmt = this.db.prepare(fallbackSql);
          return fallbackStmt.all(...fallbackParams) as SearchResult[];
        }
      }

      return results;
    } catch (error) {
      logger.error('FTS search error, falling back to LIKE:', error);

      // Fallback to simple LIKE search on error
      const words = query
        .toLowerCase()
        .split(/\s+/)
        .filter((w) => w.length > 2);
      if (words.length === 0) return [];

      let fallbackSql = `
        SELECT 
          *,
          1.0 as relevance,
          substr(message_text, 1, 100) || '...' as snippet
        FROM messages
        WHERE (${words.map(() => `LOWER(message_text) LIKE ?`).join(' OR ')})
      `;
      const fallbackParams: any[] = words.map((w) => `%${w}%`);

      if (platform) {
        fallbackSql += ` AND platform = ?`;
        fallbackParams.push(platform);
      }

      if (channelId) {
        fallbackSql += ` AND channel_id = ?`;
        fallbackParams.push(channelId);
      }

      if (userId) {
        fallbackSql += ` AND (user_id = ? OR LOWER(user_name) LIKE ?)`;
        fallbackParams.push(userId, `%${userId.toLowerCase()}%`);
      }

      if (sinceTimestamp !== undefined) {
        fallbackSql += ` AND timestamp >= ?`;
        fallbackParams.push(sinceTimestamp);
      }

      if (beforeTimestamp !== undefined) {
        fallbackSql += ` AND timestamp <= ?`;
        fallbackParams.push(beforeTimestamp);
      }

      fallbackSql += ` ORDER BY timestamp DESC LIMIT ? OFFSET ?`;
      fallbackParams.push(limit, offset);

      const fallbackStmt = this.db.prepare(fallbackSql);
      return fallbackStmt.all(...fallbackParams) as SearchResult[];
    }
  }

  async getMessageContext(
    platform: string,
    channelId: string,
    timestamp: number,
    beforeCount: number = 5,
    afterCount: number = 5
  ): Promise<ChatMessage[]> {
    const stmt = this.db.prepare(`
      SELECT * FROM (
        SELECT *, 1 as section FROM messages
        WHERE platform = ? AND channel_id = ? AND timestamp <= ?
        ORDER BY timestamp DESC LIMIT ?
      )
      UNION ALL
      SELECT * FROM (
        SELECT *, 2 as section FROM messages
        WHERE platform = ? AND channel_id = ? AND timestamp > ?
        ORDER BY timestamp ASC LIMIT ?
      )
      ORDER BY section, timestamp ASC
    `);

    return stmt.all(
      platform,
      channelId,
      timestamp,
      beforeCount,
      platform,
      channelId,
      timestamp,
      afterCount
    ) as ChatMessage[];
  }

  async getStats(): Promise<any[]> {
    const stmt = this.db.prepare(`
      SELECT 
        platform,
        COUNT(*) as message_count,
        COUNT(DISTINCT channel_id) as channel_count,
        COUNT(DISTINCT user_id) as user_count,
        MIN(timestamp) as earliest_message,
        MAX(timestamp) as latest_message
      FROM messages
      GROUP BY platform
    `);

    return stmt.all();
  }

  async deleteOldMessages(daysOld: number): Promise<number> {
    const cutoffTimestamp = Math.floor(Date.now() / 1000) - daysOld * 86400;

    const stmt = this.db.prepare(`
      DELETE FROM messages WHERE timestamp < ?
    `);

    return stmt.run(cutoffTimestamp).changes;
  }

  async close(): Promise<void> {
    this.db.close();
    logger.info('SQLite chat history database closed');
  }
}

/**
 * PostgreSQL implementation
 */
class PostgreSQLChatHistory extends ChatHistoryBackend {
  private pool: Pool;
  private initialized = false;
  private initError: Error | null = null;

  constructor(connectionString: string) {
    super();
    logger.info(`Initializing PostgreSQL chat history database`);
    this.pool = new Pool({
      connectionString,
      max: 20,
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 2000,
    });

    // Don't initialize in constructor - do it lazily on first use
    // This prevents crashes if PostgreSQL is unreachable during startup
  }

  private async ensureInitialized(): Promise<void> {
    if (this.initialized) return;
    if (this.initError) throw this.initError;

    try {
      await this.initializeSchema();
      this.initialized = true;
    } catch (error) {
      this.initError = error as Error;
      throw error;
    }
  }

  private async initializeSchema(): Promise<void> {
    const client = await this.pool.connect();
    try {
      await client.query(`
        CREATE TABLE IF NOT EXISTS messages (
          id SERIAL PRIMARY KEY,
          platform VARCHAR(20) NOT NULL,
          channel_id VARCHAR(255) NOT NULL,
          channel_name VARCHAR(255),
          user_id VARCHAR(255) NOT NULL,
          user_name VARCHAR(255),
          message_id VARCHAR(255) NOT NULL,
          thread_id VARCHAR(255),
          message_text TEXT NOT NULL,
          timestamp DOUBLE PRECISION NOT NULL,
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          UNIQUE(platform, message_id)
        );

        CREATE INDEX IF NOT EXISTS idx_channel_timestamp 
          ON messages(channel_id, timestamp DESC);
        
        CREATE INDEX IF NOT EXISTS idx_thread 
          ON messages(thread_id) WHERE thread_id IS NOT NULL;
        
        CREATE INDEX IF NOT EXISTS idx_platform_channel 
          ON messages(platform, channel_id);

        CREATE INDEX IF NOT EXISTS idx_timestamp 
          ON messages(timestamp DESC);

        -- Full-text search using PostgreSQL's built-in capabilities
        CREATE INDEX IF NOT EXISTS idx_message_text_fts 
          ON messages USING gin(to_tsvector('english', message_text));
        
        CREATE INDEX IF NOT EXISTS idx_user_name_fts 
          ON messages USING gin(to_tsvector('english', COALESCE(user_name, '')));
      `);

      logger.info('PostgreSQL chat history database schema initialized');
    } catch (error) {
      logger.error('Failed to initialize PostgreSQL schema:', error);
      throw error;
    } finally {
      client.release();
    }
  }

  async storeMessage(message: ChatMessage): Promise<number | bigint> {
    await this.ensureInitialized();
    const client = await this.pool.connect();
    try {
      const result = await client.query(
        `
        INSERT INTO messages 
          (platform, channel_id, channel_name, user_id, user_name, 
           message_id, thread_id, message_text, timestamp)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
        ON CONFLICT (platform, message_id) 
        DO UPDATE SET
          channel_name = EXCLUDED.channel_name,
          user_name = EXCLUDED.user_name,
          message_text = EXCLUDED.message_text,
          timestamp = EXCLUDED.timestamp
        RETURNING id
      `,
        [
          message.platform,
          message.channel_id,
          message.channel_name || null,
          message.user_id,
          message.user_name || null,
          message.message_id,
          message.thread_id || null,
          message.message_text,
          message.timestamp,
        ]
      );

      return result.rows[0].id;
    } finally {
      client.release();
    }
  }

  async getRecentMessages(
    platform: string,
    channelId: string,
    limit: number = 50,
    threadId?: string
  ): Promise<ChatMessage[]> {
    await this.ensureInitialized();
    const client = await this.pool.connect();
    try {
      let query = `
        SELECT * FROM messages
        WHERE platform = $1 AND channel_id = $2
      `;
      const params: any[] = [platform, channelId];

      if (threadId) {
        query += ` AND thread_id = $3`;
        params.push(threadId);
        query += ` ORDER BY timestamp DESC LIMIT $4`;
        params.push(limit);
      } else {
        query += ` ORDER BY timestamp DESC LIMIT $3`;
        params.push(limit);
      }

      const result = await client.query(query, params);
      return result.rows as ChatMessage[];
    } finally {
      client.release();
    }
  }

  /**
   * Estimate tokens for a message (rough approximation: ~4 chars per token)
   */
  private estimateTokens(text: string): number {
    return Math.ceil(text.length / 4);
  }

  async getRecentMessagesWithTokenLimit(
    platform: string,
    channelId: string,
    maxTokens: number,
    threadId?: string
  ): Promise<ChatMessage[]> {
    // Fetch recent messages (more than we need, then trim)
    const messages = await this.getRecentMessages(platform, channelId, 500, threadId);

    // Build result from most recent, working backwards
    const result: ChatMessage[] = [];
    let tokenCount = 0;

    for (const message of messages) {
      const messageTokens = this.estimateTokens(message.message_text);

      if (tokenCount + messageTokens > maxTokens && result.length > 0) {
        break; // Stop when we hit the limit
      }

      result.push(message);
      tokenCount += messageTokens;
    }

    // Reverse to get chronological order (oldest to newest)
    return result.reverse();
  }

  async getMessagesByTimeRange(
    platform: string,
    channelId: string,
    startTimestamp: number,
    endTimestamp: number,
    limit: number = 1000
  ): Promise<ChatMessage[]> {
    await this.ensureInitialized();
    const client = await this.pool.connect();
    try {
      const result = await client.query(
        `
        SELECT * FROM messages
        WHERE platform = $1 AND channel_id = $2
          AND timestamp >= $3 AND timestamp <= $4
        ORDER BY timestamp ASC
        LIMIT $5
      `,
        [platform, channelId, startTimestamp, endTimestamp, limit]
      );
      return result.rows as ChatMessage[];
    } finally {
      client.release();
    }
  }

  async searchMessages(query: string, options?: SearchOptions): Promise<SearchResult[]> {
    const {
      platform,
      channelId,
      userId,
      sinceTimestamp,
      beforeTimestamp,
      limit = 20,
      offset = 0,
    } = options || {};

    await this.ensureInitialized();
    const client = await this.pool.connect();
    try {
      // Try full-text search first with websearch_to_tsquery (more flexible, supports OR)
      let sql = `
        SELECT 
          *,
          ts_rank(to_tsvector('english', message_text), websearch_to_tsquery('english', $1)) as relevance,
          ts_headline('english', message_text, websearch_to_tsquery('english', $1), 
            'MaxWords=20, MinWords=10, ShortWord=3, HighlightAll=FALSE, MaxFragments=1') as snippet
        FROM messages
        WHERE to_tsvector('english', message_text) @@ websearch_to_tsquery('english', $1)
      `;
      const params: any[] = [query];
      let paramIndex = 2;

      if (platform) {
        sql += ` AND platform = $${paramIndex}`;
        params.push(platform);
        paramIndex++;
      }

      if (channelId) {
        sql += ` AND channel_id = $${paramIndex}`;
        params.push(channelId);
        paramIndex++;
      }

      if (userId) {
        sql += ` AND (user_id = $${paramIndex} OR LOWER(user_name) LIKE $${paramIndex + 1})`;
        params.push(userId, `%${userId.toLowerCase()}%`);
        paramIndex += 2;
      }

      if (sinceTimestamp !== undefined) {
        sql += ` AND timestamp >= $${paramIndex}`;
        params.push(sinceTimestamp);
        paramIndex++;
      }

      if (beforeTimestamp !== undefined) {
        sql += ` AND timestamp <= $${paramIndex}`;
        params.push(beforeTimestamp);
        paramIndex++;
      }

      sql += ` ORDER BY relevance DESC LIMIT $${paramIndex} OFFSET $${paramIndex + 1}`;
      params.push(limit, offset);

      let result = await client.query(sql, params);

      // If FTS returns no results, fallback to case-insensitive pattern matching
      if (result.rows.length === 0) {
        logger.debug('FTS search returned no results, falling back to ILIKE search');

        // Split query into words and search for any of them
        const words = query
          .toLowerCase()
          .split(/\s+/)
          .filter((w) => w.length > 2);

        if (words.length > 0) {
          // Build ILIKE conditions for each word
          let fallbackSql = `
            SELECT 
              *,
              1.0 as relevance,
              SUBSTRING(message_text, 1, 100) || '...' as snippet
            FROM messages
            WHERE (${words.map((_, i) => `LOWER(message_text) LIKE $${i + 1}`).join(' OR ')})
          `;
          const fallbackParams: any[] = words.map((w) => `%${w}%`);
          paramIndex = words.length + 1;

          if (platform) {
            fallbackSql += ` AND platform = $${paramIndex}`;
            fallbackParams.push(platform);
            paramIndex++;
          }

          if (channelId) {
            fallbackSql += ` AND channel_id = $${paramIndex}`;
            fallbackParams.push(channelId);
            paramIndex++;
          }

          if (userId) {
            fallbackSql += ` AND (user_id = $${paramIndex} OR LOWER(user_name) LIKE $${paramIndex + 1})`;
            fallbackParams.push(userId, `%${userId.toLowerCase()}%`);
            paramIndex += 2;
          }

          if (sinceTimestamp !== undefined) {
            fallbackSql += ` AND timestamp >= $${paramIndex}`;
            fallbackParams.push(sinceTimestamp);
            paramIndex++;
          }

          if (beforeTimestamp !== undefined) {
            fallbackSql += ` AND timestamp <= $${paramIndex}`;
            fallbackParams.push(beforeTimestamp);
            paramIndex++;
          }

          fallbackSql += ` ORDER BY timestamp DESC LIMIT $${paramIndex} OFFSET $${paramIndex + 1}`;
          fallbackParams.push(limit, offset);

          result = await client.query(fallbackSql, fallbackParams);
        }
      }

      return result.rows as SearchResult[];
    } finally {
      client.release();
    }
  }

  async getMessageContext(
    platform: string,
    channelId: string,
    timestamp: number,
    beforeCount: number = 5,
    afterCount: number = 5
  ): Promise<ChatMessage[]> {
    await this.ensureInitialized();
    const client = await this.pool.connect();
    try {
      const result = await client.query(
        `
        (
          SELECT *, 1 as section FROM messages
          WHERE platform = $1 AND channel_id = $2 AND timestamp <= $3
          ORDER BY timestamp DESC LIMIT $4
        )
        UNION ALL
        (
          SELECT *, 2 as section FROM messages
          WHERE platform = $1 AND channel_id = $2 AND timestamp > $3
          ORDER BY timestamp ASC LIMIT $5
        )
        ORDER BY section, timestamp ASC
      `,
        [platform, channelId, timestamp, beforeCount, afterCount]
      );

      return result.rows as ChatMessage[];
    } finally {
      client.release();
    }
  }

  async getStats(): Promise<any[]> {
    await this.ensureInitialized();
    const client = await this.pool.connect();
    try {
      const result = await client.query(`
        SELECT 
          platform,
          COUNT(*) as message_count,
          COUNT(DISTINCT channel_id) as channel_count,
          COUNT(DISTINCT user_id) as user_count,
          MIN(timestamp) as earliest_message,
          MAX(timestamp) as latest_message
        FROM messages
        GROUP BY platform
      `);

      return result.rows;
    } finally {
      client.release();
    }
  }

  async deleteOldMessages(daysOld: number): Promise<number> {
    await this.ensureInitialized();
    const client = await this.pool.connect();
    try {
      const cutoffTimestamp = Math.floor(Date.now() / 1000) - daysOld * 86400;

      const result = await client.query(`DELETE FROM messages WHERE timestamp < $1`, [
        cutoffTimestamp,
      ]);

      return result.rowCount || 0;
    } finally {
      client.release();
    }
  }

  async close(): Promise<void> {
    await this.pool.end();
    logger.info('PostgreSQL chat history database closed');
  }
}

/**
 * Wrapper class that provides a unified interface
 */
export class ChatHistoryDB {
  private backend: ChatHistoryBackend;
  private sqliteBackend: SQLiteChatHistory | null = null;
  private postgresBackend: PostgreSQLChatHistory | null = null;
  private syncInterval: NodeJS.Timeout | null = null;
  private isSyncing = false;

  constructor(dbPath?: string) {
    const defaultPath = path.join(config.sessionPersistDir, 'chat-history.db');
    const finalPath = dbPath || defaultPath;

    // Always initialize SQLite as fallback
    this.sqliteBackend = new SQLiteChatHistory(finalPath);

    // Check if PostgreSQL is configured
    if (config.postgresUrl) {
      logger.info('PostgreSQL URL configured, attempting to use PostgreSQL backend');
      try {
        this.postgresBackend = new PostgreSQLChatHistory(config.postgresUrl);
        this.backend = this.postgresBackend;
        logger.info('PostgreSQL backend initialized (will connect on first use)');

        // Start sync interval to check PostgreSQL health and sync SQLite data
        this.startSyncInterval();
      } catch (error) {
        logger.error('Failed to initialize PostgreSQL backend, using SQLite:', error);
        this.backend = this.sqliteBackend;
      }
    } else {
      // Use SQLite
      logger.info('No PostgreSQL URL configured, using SQLite backend');
      this.backend = this.sqliteBackend;
    }
  }

  /**
   * Start periodic sync from SQLite to PostgreSQL
   */
  private startSyncInterval(): void {
    // Check every 30 seconds
    this.syncInterval = setInterval(() => {
      this.syncSQLiteToPostgres().catch((err) => {
        logger.debug('Sync check error:', err);
      });
    }, 30000);
  }

  /**
   * Sync messages from SQLite to PostgreSQL
   */
  private async syncSQLiteToPostgres(): Promise<void> {
    if (this.isSyncing || !this.postgresBackend || !this.sqliteBackend) {
      return;
    }

    // If currently using PostgreSQL, no need to sync
    if (this.backend instanceof PostgreSQLChatHistory) {
      return;
    }

    this.isSyncing = true;

    try {
      // Try to get stats from PostgreSQL to test connection
      await this.postgresBackend.getStats();

      // PostgreSQL is available! Switch back to it
      logger.info('PostgreSQL connection restored, syncing SQLite messages...');
      this.backend = this.postgresBackend;

      // Get all messages from SQLite
      const sqliteMessages = await Promise.resolve(
        this.sqliteBackend.getRecentMessages('', '', 10000)
      );

      if (sqliteMessages.length === 0) {
        logger.info('No messages to sync from SQLite');
        return;
      }

      logger.info(`Syncing ${sqliteMessages.length} messages from SQLite to PostgreSQL...`);

      // Sync each message to PostgreSQL
      let syncedCount = 0;
      for (const msg of sqliteMessages) {
        try {
          await this.postgresBackend.storeMessage(msg);
          syncedCount++;
        } catch (error) {
          // Ignore duplicate errors (message already exists)
          if (!String(error).includes('duplicate')) {
            logger.warn('Failed to sync message:', error);
          } else {
            syncedCount++;
          }
        }
      }

      logger.info(
        `Successfully synced ${syncedCount}/${sqliteMessages.length} messages to PostgreSQL`
      );

      // Clean up SQLite after successful sync
      const cutoffTimestamp = Math.floor(Date.now() / 1000) - 1; // Delete messages older than 1 second
      await this.sqliteBackend.deleteOldMessages(0);
      logger.info('Cleared synced messages from SQLite');
    } catch (error) {
      // PostgreSQL still not available, stay on SQLite
      logger.debug('PostgreSQL not yet available for sync');
    } finally {
      this.isSyncing = false;
    }
  }

  async storeMessage(message: ChatMessage): Promise<number | bigint> {
    try {
      const result = this.backend.storeMessage(message);
      // Handle both sync (SQLite) and async (PostgreSQL) results
      if (result instanceof Promise) {
        return await result;
      }
      return result;
    } catch (error) {
      // If PostgreSQL fails and we haven't fallen back yet, fall back to SQLite
      if (this.backend instanceof PostgreSQLChatHistory && this.sqliteBackend) {
        logger.error('PostgreSQL operation failed, falling back to SQLite:', error);
        this.backend = this.sqliteBackend;
        logger.info('Fell back to SQLite backend (will auto-sync when PostgreSQL recovers)');

        // Retry with SQLite
        const result = this.backend.storeMessage(message);
        if (result instanceof Promise) {
          return await result;
        }
        return result;
      }
      throw error;
    }
  }

  getRecentMessages(
    platform: string,
    channelId: string,
    limit: number = 50,
    threadId?: string
  ): ChatMessage[] | Promise<ChatMessage[]> {
    return this.backend.getRecentMessages(platform, channelId, limit, threadId);
  }

  getRecentMessagesWithTokenLimit(
    platform: string,
    channelId: string,
    maxTokens: number,
    threadId?: string
  ): ChatMessage[] | Promise<ChatMessage[]> {
    return this.backend.getRecentMessagesWithTokenLimit(platform, channelId, maxTokens, threadId);
  }

  getMessagesByTimeRange(
    platform: string,
    channelId: string,
    startTimestamp: number,
    endTimestamp: number,
    limit: number = 1000
  ): ChatMessage[] | Promise<ChatMessage[]> {
    return this.backend.getMessagesByTimeRange(
      platform,
      channelId,
      startTimestamp,
      endTimestamp,
      limit
    );
  }

  searchMessages(query: string, options?: SearchOptions): SearchResult[] | Promise<SearchResult[]> {
    return this.backend.searchMessages(query, options);
  }

  getMessageContext(
    platform: string,
    channelId: string,
    timestamp: number,
    beforeCount: number = 5,
    afterCount: number = 5
  ): ChatMessage[] | Promise<ChatMessage[]> {
    return this.backend.getMessageContext(platform, channelId, timestamp, beforeCount, afterCount);
  }

  getStats(): any[] | Promise<any[]> {
    return this.backend.getStats();
  }

  deleteOldMessages(daysOld: number): number | Promise<number> {
    return this.backend.deleteOldMessages(daysOld);
  }

  close(): void | Promise<void> {
    // Stop sync interval
    if (this.syncInterval) {
      clearInterval(this.syncInterval);
      this.syncInterval = null;
    }
    return this.backend.close();
  }
}

// Singleton instance
let chatHistoryDB: ChatHistoryDB | null = null;

export function getChatHistoryDB(): ChatHistoryDB {
  if (!chatHistoryDB) {
    chatHistoryDB = new ChatHistoryDB();
  }
  return chatHistoryDB;
}
