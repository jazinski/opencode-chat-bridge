# PostgreSQL Setup Guide

This guide explains how to set up PostgreSQL as the backend for chat history
storage instead of SQLite.

## Prerequisites

- PostgreSQL server accessible from the bot machine
- PostgreSQL user and database created
- Network access configured in PostgreSQL

## Current Status

✅ Bot code supports both SQLite and PostgreSQL\
✅ Bot will gracefully fall back to SQLite if PostgreSQL is unavailable\
✅ Migration script created to move data from SQLite to PostgreSQL\
❌ PostgreSQL server needs `pg_hba.conf` configuration (see below)

## Bot Configuration

The bot detects which backend to use based on the `POSTGRES_URL` environment
variable.

### Environment Variables

Add to your `.env` file:

```bash
# PostgreSQL connection string
POSTGRES_URL=postgresql://user:password@host:port/database

# Example:
POSTGRES_URL=postgresql://opencode-chat:opencode@10.15.15.13:5432/opencode-chat
```

If `POSTGRES_URL` is not set or the connection fails, the bot will automatically
fall back to SQLite.

## PostgreSQL Server Setup

### 1. Create Database and User

On your PostgreSQL server:

```bash
# Connect as postgres user
su - postgres -c psql

# Create user
CREATE USER "opencode-chat" WITH PASSWORD 'your-secure-password';

# Create database
CREATE DATABASE "opencode-chat" OWNER "opencode-chat";

# Grant privileges
GRANT ALL PRIVILEGES ON DATABASE "opencode-chat" TO "opencode-chat";

# Exit
\q
```

### 2. Configure Network Access (pg_hba.conf)

**This is the critical step that's currently preventing the bot from
connecting.**

#### Find pg_hba.conf

```bash
# On Alpine/Debian
find /etc -name pg_hba.conf 2>/dev/null

# Common locations:
# /etc/postgresql/*/main/pg_hba.conf (Debian/Ubuntu)
# /var/lib/postgresql/data/pg_hba.conf (Alpine)
```

#### Edit pg_hba.conf

Add an entry to allow the bot machine to connect. Add this line **before** any
reject rules:

```
# TYPE  DATABASE        USER            ADDRESS                 METHOD
host    opencode-chat   opencode-chat   10.0.0.169/32          md5
```

Or to allow the entire subnet:

```
host    opencode-chat   opencode-chat   10.0.0.0/24            md5
```

Or to allow all hosts (less secure):

```
host    opencode-chat   opencode-chat   0.0.0.0/0              md5
```

#### Explanation of Fields:

- `host` - TCP/IP connection
- `opencode-chat` - database name
- `opencode-chat` - username
- `10.0.0.169/32` - IP address/CIDR (bot's IP address)
- `md5` - password authentication method

### 3. Configure PostgreSQL to Listen on Network

Edit `postgresql.conf`:

```bash
# Find postgresql.conf
find /etc -name postgresql.conf 2>/dev/null

# Edit the file
vi /path/to/postgresql.conf
```

Find and update:

```
listen_addresses = '*'
```

### 4. Reload/Restart PostgreSQL

```bash
# Alpine (OpenRC)
rc-service postgresql reload    # For pg_hba.conf changes
rc-service postgresql restart   # For postgresql.conf changes

# Debian/Ubuntu (systemd)
systemctl reload postgresql     # For pg_hba.conf changes
systemctl restart postgresql    # For postgresql.conf changes
```

## Testing the Connection

### From Bot Machine

Test connection using psql:

```bash
# Install PostgreSQL client if needed
apt install postgresql-client

# Test connection
psql "postgresql://opencode-chat:opencode@10.15.15.13:5432/opencode-chat" -c "SELECT version();"
```

### Check Bot Logs

```bash
systemctl --user restart opencode-chat-bridge
journalctl --user -u opencode-chat-bridge -n 50 --no-pager
```

Look for:

- ✅ `PostgreSQL chat history database schema initialized`
- ❌ `no pg_hba.conf entry for host` (needs pg_hba.conf fix)
- ⚠️ `Fell back to SQLite backend` (connection failed, using fallback)

## Migrating Existing Data

Once PostgreSQL is connected, migrate existing SQLite messages:

```bash
cd /home/cjazinski/projects/opencode-chat-bridge

# With default paths (uses .env config)
node dist/scripts/migrate-to-postgres.js

# With custom paths
node dist/scripts/migrate-to-postgres.js \
  /path/to/chat-history.db \
  postgresql://user:pass@host:port/db
```

The script will:

- Read all messages from SQLite
- Insert them into PostgreSQL (skipping duplicates)
- Show progress and final counts
- Handle errors gracefully

## Database Schema

The PostgreSQL schema is automatically created on first connection:

```sql
CREATE TABLE messages (
  id SERIAL PRIMARY KEY,
  platform VARCHAR(20) NOT NULL,
  channel_id VARCHAR(255) NOT NULL,
  channel_name VARCHAR(255),
  user_id VARCHAR(255) NOT NULL,
  user_name VARCHAR(255),
  message_id VARCHAR(255) NOT NULL,
  thread_id VARCHAR(255),
  message_text TEXT NOT NULL,
  timestamp BIGINT NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(platform, message_id)
);

-- Indexes for performance
CREATE INDEX idx_channel_timestamp ON messages(channel_id, timestamp DESC);
CREATE INDEX idx_thread ON messages(thread_id) WHERE thread_id IS NOT NULL;
CREATE INDEX idx_platform_channel ON messages(platform, channel_id);
CREATE INDEX idx_timestamp ON messages(timestamp DESC);

-- Full-text search indexes
CREATE INDEX idx_message_text_fts ON messages USING gin(to_tsvector('english', message_text));
CREATE INDEX idx_user_name_fts ON messages USING gin(to_tsvector('english', COALESCE(user_name, '')));
```

## Verification

### Check Messages in PostgreSQL

```bash
# Connect to database
psql "postgresql://opencode-chat:opencode@10.15.15.13:5432/opencode-chat"

# View message count
SELECT COUNT(*) FROM messages;

# View recent messages
SELECT 
  platform,
  channel_name,
  user_name,
  message_text,
  to_timestamp(timestamp) as sent_at
FROM messages
ORDER BY timestamp DESC
LIMIT 10;

# View statistics
SELECT 
  platform,
  COUNT(*) as message_count,
  COUNT(DISTINCT channel_id) as channel_count,
  COUNT(DISTINCT user_id) as user_count,
  to_timestamp(MIN(timestamp)) as earliest,
  to_timestamp(MAX(timestamp)) as latest
FROM messages
GROUP BY platform;
```

## Troubleshooting

### Connection Refused

```
Error: connect ECONNREFUSED
```

**Solutions:**

- Check PostgreSQL is running: `rc-service postgresql status`
- Check `listen_addresses` in postgresql.conf
- Restart PostgreSQL: `rc-service postgresql restart`

### No pg_hba.conf Entry

```
error: no pg_hba.conf entry for host "10.0.0.169", user "opencode-chat", database "opencode-chat"
```

**Solutions:**

- Add entry to pg_hba.conf (see section 2 above)
- Reload PostgreSQL: `rc-service postgresql reload`
- Verify with: `cat /path/to/pg_hba.conf | grep opencode`

### Authentication Failed

```
error: password authentication failed for user "opencode-chat"
```

**Solutions:**

- Check password in connection string
- Reset password: `ALTER USER "opencode-chat" WITH PASSWORD 'new-password';`
- Ensure user exists: `\du` in psql

### Database Does Not Exist

```
error: database "opencode-chat" does not exist
```

**Solutions:**

- Create database: `CREATE DATABASE "opencode-chat";`
- List databases: `\l` in psql

## Performance Considerations

### PostgreSQL vs SQLite

**PostgreSQL Advantages:**

- Concurrent access (multiple bots can share database)
- Better full-text search performance
- Network-accessible (centralized storage)
- Better for large datasets (> 100K messages)
- ACID compliance with multiple writers

**SQLite Advantages:**

- No network latency
- Simpler setup (no server required)
- Better for single-bot deployments
- Built-in file locking

### Optimization Tips

1. **Connection Pooling** (already configured)
   - Max 20 connections
   - 30s idle timeout
   - 2s connection timeout

2. **Indexes** (already created)
   - All high-use columns indexed
   - GIN indexes for full-text search

3. **Vacuum** (periodic cleanup)
   ```sql
   VACUUM ANALYZE messages;
   ```

## Security Best Practices

1. **Use Strong Passwords**
   - Generate: `openssl rand -base64 32`
   - Store in `.env`, never commit to git

2. **Restrict Network Access**
   - Use specific IP addresses in pg_hba.conf
   - Don't use `0.0.0.0/0` unless necessary

3. **Use SSL/TLS** (recommended for production)
   ```bash
   POSTGRES_URL=postgresql://user:pass@host:port/db?sslmode=require
   ```

4. **Regular Backups**
   ```bash
   pg_dump -h 10.15.15.13 -U opencode-chat opencode-chat > backup.sql
   ```

## Current Configuration (User's Setup)

- **PostgreSQL Server:** 10.15.15.13
- **Database:** opencode-chat
- **User:** opencode-chat
- **Bot Machine IP:** 10.0.0.169
- **Connection String:**
  `postgresql://opencode-chat:opencode@10.15.15.13:5432/opencode-chat`

**Next Steps for User:**

1. SSH to PostgreSQL server (10.15.15.13)
2. Edit `/etc/postgresql/.../pg_hba.conf`
3. Add line: `host opencode-chat opencode-chat 10.0.0.169/32 md5`
4. Run: `rc-service postgresql reload`
5. Restart bot: `systemctl --user restart opencode-chat-bridge`
6. Run migration: `node dist/scripts/migrate-to-postgres.js`
