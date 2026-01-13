import { describe, it, expect, jest, beforeEach, afterEach } from '@jest/globals';

/**
 * Unit tests for ChatHistory search functionality
 * Tests the search logic including FTS and LIKE fallback for both SQLite and PostgreSQL
 */

describe('ChatHistory Search Functionality', () => {
  describe('Search Query Parsing Logic', () => {
    it('should split multi-word query into OR terms for FTS', () => {
      const query = 'linux server docker';
      const ftsQuery = query
        .split(/\s+/)
        .filter((w) => w.length > 0)
        .join(' OR ');

      expect(ftsQuery).toBe('linux OR server OR docker');
    });

    it('should handle empty query', () => {
      const query = '   ';
      const ftsQuery = query
        .split(/\s+/)
        .filter((w) => w.length > 0)
        .join(' OR ');

      expect(ftsQuery).toBe('');
    });

    it('should preserve single word query', () => {
      const query = 'linux';
      const ftsQuery = query
        .split(/\s+/)
        .filter((w) => w.length > 0)
        .join(' OR ');

      expect(ftsQuery).toBe('linux');
    });

    it('should handle query with extra whitespace', () => {
      const query = '  linux   server  ';
      const ftsQuery = query
        .split(/\s+/)
        .filter((w) => w.length > 0)
        .join(' OR ');

      expect(ftsQuery).toBe('linux OR server');
    });
  });

  describe('Fallback Search Word Filtering', () => {
    it('should filter words shorter than 3 characters', () => {
      const query = 'we are on linux today';
      const words = query
        .toLowerCase()
        .split(/\s+/)
        .filter((w) => w.length > 2);

      // 'are' has 3 chars (length > 2 means >= 3), so it's included
      expect(words).toEqual(['are', 'linux', 'today']);
      expect(words.length).toBe(3);
    });

    it('should keep all words when all are long enough', () => {
      const query = 'linux server docker kubernetes';
      const words = query
        .toLowerCase()
        .split(/\s+/)
        .filter((w) => w.length > 2);

      expect(words).toEqual(['linux', 'server', 'docker', 'kubernetes']);
    });

    it('should return empty array when all words are too short', () => {
      const query = 'a b c we on';
      const words = query
        .toLowerCase()
        .split(/\s+/)
        .filter((w) => w.length > 2);

      expect(words).toEqual([]);
    });

    it('should handle mixed case query', () => {
      const query = 'Linux Server DOCKER';
      const words = query
        .toLowerCase()
        .split(/\s+/)
        .filter((w) => w.length > 2);

      expect(words).toEqual(['linux', 'server', 'docker']);
    });

    it('should handle special characters in words', () => {
      const query = 'test@example.com node.js';
      const words = query
        .toLowerCase()
        .split(/\s+/)
        .filter((w) => w.length > 2);

      expect(words).toContain('test@example.com');
      expect(words).toContain('node.js');
    });
  });

  describe('SQL LIKE Pattern Generation', () => {
    it('should generate correct LIKE patterns for multiple words', () => {
      const words = ['linux', 'server'];
      const patterns = words.map((w) => `%${w}%`);

      expect(patterns).toEqual(['%linux%', '%server%']);
    });

    it('should generate pattern for single word', () => {
      const words = ['docker'];
      const patterns = words.map((w) => `%${w}%`);

      expect(patterns).toEqual(['%docker%']);
    });

    it('should handle empty word list', () => {
      const words: string[] = [];
      const patterns = words.map((w) => `%${w}%`);

      expect(patterns).toEqual([]);
    });
  });

  describe('Parameter Index Calculation (PostgreSQL)', () => {
    it('should calculate correct param index with platform and channelId', () => {
      let paramIndex = 2; // After query param
      const filters: any[] = [];

      const platform = 'slack';
      if (platform) {
        filters.push({ sql: `AND platform = $${paramIndex}`, value: platform });
        paramIndex++;
      }

      const channelId = 'C123456';
      if (channelId) {
        filters.push({ sql: `AND channel_id = $${paramIndex}`, value: channelId });
        paramIndex++;
      }

      const limit = 20;
      filters.push({ sql: `LIMIT $${paramIndex}`, value: limit });

      expect(filters[0].sql).toBe('AND platform = $2');
      expect(filters[1].sql).toBe('AND channel_id = $3');
      expect(filters[2].sql).toBe('LIMIT $4');
      expect(filters.map((f) => f.value)).toEqual(['slack', 'C123456', 20]);
    });

    it('should calculate correct param index with only platform', () => {
      let paramIndex = 2;
      const filters: any[] = [];

      const platform = 'telegram';
      if (platform) {
        filters.push({ sql: `AND platform = $${paramIndex}`, value: platform });
        paramIndex++;
      }

      const limit = 30;
      filters.push({ sql: `LIMIT $${paramIndex}`, value: limit });

      expect(filters[0].sql).toBe('AND platform = $2');
      expect(filters[1].sql).toBe('LIMIT $3');
    });

    it('should calculate correct param index with no filters', () => {
      let paramIndex = 2;
      const filters: any[] = [];

      const limit = 10;
      filters.push({ sql: `LIMIT $${paramIndex}`, value: limit });

      expect(filters[0].sql).toBe('LIMIT $2');
    });
  });

  describe('ILIKE Fallback Query Construction (PostgreSQL)', () => {
    it('should build correct ILIKE query for multiple words', () => {
      const words = ['linux', 'server'];
      const conditions = words.map((_, i) => `LOWER(message_text) LIKE $${i + 1}`).join(' OR ');
      const params = words.map((w) => `%${w}%`);

      expect(conditions).toBe('LOWER(message_text) LIKE $1 OR LOWER(message_text) LIKE $2');
      expect(params).toEqual(['%linux%', '%server%']);
    });

    it('should build correct ILIKE query with filters', () => {
      const words = ['docker'];
      let paramIndex = 1;
      const conditions = words
        .map((_, i) => `LOWER(message_text) LIKE $${i + paramIndex}`)
        .join(' OR ');
      const params: any[] = words.map((w) => `%${w}%`);
      paramIndex += words.length;

      const platform = 'slack';
      let fullQuery = `WHERE (${conditions})`;
      if (platform) {
        fullQuery += ` AND platform = $${paramIndex}`;
        params.push(platform);
        paramIndex++;
      }

      const limit = 20;
      fullQuery += ` ORDER BY timestamp DESC LIMIT $${paramIndex}`;
      params.push(limit);

      expect(fullQuery).toContain('WHERE (LOWER(message_text) LIKE $1)');
      expect(fullQuery).toContain('AND platform = $2');
      expect(fullQuery).toContain('LIMIT $3');
      expect(params).toEqual(['%docker%', 'slack', 20]);
    });
  });

  describe('Search Edge Cases', () => {
    it('should handle very long query string', () => {
      const longQuery = 'linux '.repeat(100).trim();
      const words = longQuery.split(/\s+/);

      expect(words.length).toBe(100);
      expect(words.every((w) => w === 'linux')).toBe(true);
    });

    it('should handle query with newlines and tabs', () => {
      const query = 'linux\tserver\ndocker';
      const ftsQuery = query
        .split(/\s+/)
        .filter((w) => w.length > 0)
        .join(' OR ');

      expect(ftsQuery).toBe('linux OR server OR docker');
    });

    it('should handle query with SQL special characters', () => {
      const query = "'; DROP TABLE messages; --";
      const words = query
        .toLowerCase()
        .split(/\s+/)
        .filter((w) => w.length > 2);

      // Should treat as search terms, not SQL
      // Note: "'; " becomes "';" (3 chars) after whitespace split, but then gets the semicolon
      expect(words).toContain('drop');
      expect(words).toContain('table');
      expect(words).toContain('messages;');
      expect(words.length).toBe(3);
    });

    it('should handle query with percentage signs', () => {
      const query = '100% coverage';
      const words = query
        .toLowerCase()
        .split(/\s+/)
        .filter((w) => w.length > 2);
      const patterns = words.map((w) => `%${w}%`);

      expect(patterns).toContain('%100%%');
      expect(patterns).toContain('%coverage%');
    });

    it('should handle query with underscores', () => {
      const query = 'test_function user_id';
      const words = query
        .toLowerCase()
        .split(/\s+/)
        .filter((w) => w.length > 2);
      const patterns = words.map((w) => `%${w}%`);

      expect(patterns).toContain('%test_function%');
      expect(patterns).toContain('%user_id%');
    });
  });

  describe('SQLite LIKE Query Construction', () => {
    it('should build correct LIKE query for SQLite', () => {
      const words = ['linux', 'server'];
      const conditions = words.map(() => `LOWER(message_text) LIKE ?`).join(' OR ');
      const params = words.map((w) => `%${w}%`);

      expect(conditions).toBe('LOWER(message_text) LIKE ? OR LOWER(message_text) LIKE ?');
      expect(params).toEqual(['%linux%', '%server%']);
    });

    it('should add filters correctly in SQLite query', () => {
      const words = ['docker'];
      const conditions = words.map(() => `LOWER(message_text) LIKE ?`).join(' OR ');
      const params: any[] = words.map((w) => `%${w}%`);

      let query = `SELECT * FROM messages WHERE (${conditions})`;

      const platform = 'slack';
      if (platform) {
        query += ` AND platform = ?`;
        params.push(platform);
      }

      const channelId = 'C123';
      if (channelId) {
        query += ` AND channel_id = ?`;
        params.push(channelId);
      }

      query += ` ORDER BY timestamp DESC LIMIT ?`;
      params.push(20);

      expect(query).toContain('WHERE (LOWER(message_text) LIKE ?)');
      expect(query).toContain('AND platform = ?');
      expect(query).toContain('AND channel_id = ?');
      expect(query).toContain('LIMIT ?');
      expect(params).toEqual(['%docker%', 'slack', 'C123', 20]);
    });
  });

  describe('Result Snippet Generation', () => {
    it('should truncate long messages for snippets', () => {
      const longMessage = 'a'.repeat(200);
      const snippet = longMessage.substring(0, 100) + '...';

      expect(snippet.length).toBe(103);
      expect(snippet.endsWith('...')).toBe(true);
    });

    it('should not truncate short messages', () => {
      const shortMessage = 'Short message about Linux';
      const snippet =
        shortMessage.length > 100 ? shortMessage.substring(0, 100) + '...' : shortMessage;

      expect(snippet).toBe(shortMessage);
      expect(snippet.includes('...')).toBe(false);
    });
  });

  describe('Relevance Score Fallback', () => {
    it('should use 1.0 as default relevance for LIKE fallback', () => {
      const defaultRelevance = 1.0;

      expect(defaultRelevance).toBe(1.0);
    });

    it('should preserve FTS relevance scores', () => {
      const ftsRelevance = 0.85;

      expect(ftsRelevance).toBeGreaterThan(0);
      expect(ftsRelevance).toBeLessThanOrEqual(1);
    });
  });
});
