#!/usr/bin/env node
/**
 * Migration script to copy chat history from SQLite to PostgreSQL
 *
 * Usage:
 *   npm run build
 *   node dist/scripts/migrate-to-postgres.js [sqlite-db-path] [postgres-connection-string]
 *
 * Or with defaults from config:
 *   node dist/scripts/migrate-to-postgres.js
 */

import path from 'path';
import Database from 'better-sqlite3';
import { Pool } from 'pg';
import config from '@/config/index.js';

interface Message {
  id: number;
  platform: string;
  channel_id: string;
  channel_name: string | null;
  user_id: string;
  user_name: string | null;
  message_id: string;
  thread_id: string | null;
  message_text: string;
  timestamp: number;
  created_at: string;
}

async function migrate(sqlitePath?: string, postgresUrl?: string) {
  const finalSqlitePath = sqlitePath || path.join(config.sessionPersistDir, 'chat-history.db');
  const finalPostgresUrl = postgresUrl || config.postgresUrl;

  if (!finalPostgresUrl) {
    console.error('Error: PostgreSQL connection string is required');
    console.error('Provide it as argument or set POSTGRES_URL env variable');
    process.exit(1);
  }

  console.log(`\n=== Chat History Migration ===`);
  console.log(`SQLite DB: ${finalSqlitePath}`);
  console.log(`PostgreSQL: ${finalPostgresUrl.replace(/:[^:@]+@/, ':****@')}`);
  console.log();

  // Open SQLite database
  console.log('Opening SQLite database...');
  const sqlite = new Database(finalSqlitePath, { readonly: true });

  // Count messages in SQLite
  const sqliteCount = sqlite.prepare('SELECT COUNT(*) as count FROM messages').get() as {
    count: number;
  };
  console.log(`Found ${sqliteCount.count} messages in SQLite`);

  if (sqliteCount.count === 0) {
    console.log('No messages to migrate. Exiting.');
    sqlite.close();
    process.exit(0);
  }

  // Connect to PostgreSQL
  console.log('\nConnecting to PostgreSQL...');
  const pool = new Pool({
    connectionString: finalPostgresUrl,
    max: 5,
    connectionTimeoutMillis: 5000,
  });

  try {
    // Test connection and check schema
    const client = await pool.connect();
    console.log('Connected to PostgreSQL successfully');

    // Check if messages table exists
    const tableCheck = await client.query(`
      SELECT EXISTS (
        SELECT FROM information_schema.tables 
        WHERE table_name = 'messages'
      ) as exists
    `);

    if (!tableCheck.rows[0].exists) {
      console.error('\nError: messages table does not exist in PostgreSQL');
      console.error(
        'Please ensure the bot has connected to PostgreSQL at least once to create the schema'
      );
      client.release();
      process.exit(1);
    }

    // Count existing messages in PostgreSQL
    const pgCountResult = await client.query('SELECT COUNT(*) as count FROM messages');
    const pgCount = parseInt(pgCountResult.rows[0].count);
    console.log(`PostgreSQL currently has ${pgCount} messages`);

    client.release();

    // Migrate messages
    console.log('\nStarting migration...');
    const messages = sqlite.prepare('SELECT * FROM messages ORDER BY id').all() as Message[];

    let inserted = 0;
    let updated = 0;
    let skipped = 0;
    let errors = 0;

    for (const message of messages) {
      try {
        const client = await pool.connect();
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
            RETURNING (xmax = 0) AS inserted
          `,
            [
              message.platform,
              message.channel_id,
              message.channel_name,
              message.user_id,
              message.user_name,
              message.message_id,
              message.thread_id,
              message.message_text,
              Math.floor(message.timestamp), // Convert float to int (remove microseconds)
            ]
          );

          // xmax = 0 means INSERT, xmax != 0 means UPDATE
          if (result.rows[0].inserted) {
            inserted++;
          } else {
            updated++;
          }

          if ((inserted + updated + skipped) % 10 === 0) {
            process.stdout.write(
              `\rProgress: ${inserted + updated + skipped}/${messages.length} (${inserted} inserted, ${updated} updated, ${errors} errors)`
            );
          }
        } finally {
          client.release();
        }
      } catch (error: any) {
        errors++;
        if (error.code === '23505') {
          // Duplicate key - should not happen with ON CONFLICT, but just in case
          skipped++;
        } else {
          console.error(`\nError migrating message ${message.message_id}:`, error.message);
        }
      }
    }

    console.log(`\n\n=== Migration Complete ===`);
    console.log(`Total messages processed: ${messages.length}`);
    console.log(`Inserted: ${inserted}`);
    console.log(`Updated: ${updated}`);
    console.log(`Errors: ${errors}`);

    // Verify final count
    const verifyClient = await pool.connect();
    const finalCountResult = await verifyClient.query('SELECT COUNT(*) as count FROM messages');
    const finalCount = parseInt(finalCountResult.rows[0].count);
    console.log(`\nFinal PostgreSQL message count: ${finalCount}`);
    verifyClient.release();
  } catch (error) {
    console.error('\nMigration failed:', error);
    process.exit(1);
  } finally {
    sqlite.close();
    await pool.end();
  }
}

// Parse command line arguments
const sqlitePath = process.argv[2];
const postgresUrl = process.argv[3];

migrate(sqlitePath, postgresUrl).catch((error) => {
  console.error('Fatal error:', error);
  process.exit(1);
});
