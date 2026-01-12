# OpenCode Chat Bridge

> Node/Express API wrapper for OpenCode - enables AI coding agent interaction
> via Telegram, Slack, Discord chat interfaces

**Bridge your chat platforms to OpenCode** - interact with your AI coding agent
from Telegram, Slack, Discord, or any other chat interface.

## Features

- **Telegram Bot Integration** - Full-featured Telegram bot with inline
  keyboards
- **Slack Bot Integration** - Socket Mode enabled Slack bot (no webhooks
  required)
- **OpenCode Server API** - Uses the official `@opencode-ai/sdk` for clean,
  structured output
- **Real-time Streaming** - SSE-based event streaming for live responses
- **Thinking Indicator** - Animated status while AI is processing your request
- **Session Management** - Persistent sessions that survive restarts
- **Project Switching** - Dynamically switch between projects in `~/projects`
- **Permission Handling** - Interactive permission prompts with Allow/Reject
  buttons
- **API Key Security** - Secure REST API with authentication
- **Chunked Output** - Long responses automatically split for chat platform
  limits

## Architecture

```
┌─────────────────┐     ┌──────────────────────┐     ┌───────────────────┐
│  Telegram Bot   │────▶│   Express Server     │────▶│  OpenCode Server  │
│  (telegraf)     │◀────│   Session Manager    │◀────│  (@opencode-ai/sdk)│
└─────────────────┘     └──────────────────────┘     └───────────────────┘
        OR                         │
┌─────────────────┐                │
│   Slack Bot     │────────────────┤
│ (@slack/bolt)   │◀───────────────┤
└─────────────────┘                ▼
                         ┌──────────────────────┐
                         │   SSE Event Stream   │
                         │  - message.part.updated │
                         │  - session.status    │
                         │  - permission.updated│
                         └──────────────────────┘
```

### How It Works

1. **User sends a message** via Telegram or Slack
2. **Adapter** (TelegramAdapter or SlackAdapter) receives the message and
   forwards it to the Session
3. **Session** uses `OpenCodeClient` to send the message to the OpenCode server
4. **OpenCode Server** processes the request with the configured AI model (e.g.,
   Claude Sonnet 4.5)
5. **SSE Events** stream back with response parts, status updates, and
   permission requests
6. **Session** accumulates the response and sends it back to Telegram when
   complete

## Quick Start

### Prerequisites

- Node.js 20+
- OpenCode CLI installed (`npm install -g opencode` or via installer)
- **At least one** of the following:
  - Telegram Bot Token (from [@BotFather](https://t.me/botfather))
  - Slack App with Socket Mode enabled (see Slack Setup below)

### Installation

```bash
# Clone the repository
git clone https://github.com/jazinski/opencode-chat-bridge.git
cd opencode-chat-bridge

# Install dependencies
npm install

# Copy and configure environment
cp .env.example .env
```

### Configuration

Edit `.env` with your settings:

```bash
# Server
PORT=3000
NODE_ENV=production

# Security - REQUIRED
API_KEY=your-secure-api-key-here

# Telegram - Optional (at least one adapter required)
TELEGRAM_BOT_TOKEN=123456:ABC-DEF1234ghIkl-zyx57W2v1u123ew11
TELEGRAM_ALLOWED_USERS=123456789  # Your Telegram user ID

# Slack - Optional (at least one adapter required)
SLACK_BOT_TOKEN=xoxb-your-bot-token-here
SLACK_APP_TOKEN=xapp-your-app-token-here
SLACK_SIGNING_SECRET=your-signing-secret-here
# SLACK_ALLOWED_CHANNELS=C01234567,C89ABCDEF  # Optional channel restriction

# OpenCode Server - Choose ONE option:

# Option 1: Connect to external server (used by systemd service)
# OPENCODE_SERVER_URL=http://127.0.0.1:4096

# Option 2: Start embedded server (default when URL not set)
# OPENCODE_SERVER_PORT=0            # 0 = auto-select port
# OPENCODE_SERVER_HOSTNAME=localhost

# Projects
PROJECTS_DIR=~/projects

# Sessions
SESSION_TIMEOUT_MINUTES=30
SESSION_PERSIST_DIR=./sessions

# Logging
LOG_LEVEL=info
```

### OpenCode Configuration

The bridge uses your OpenCode configuration from
`~/.config/opencode/opencode.json`. Make sure you have a model configured:

```json
{
  "$schema": "https://opencode.ai/config.json",
  "model": "github-copilot/claude-sonnet-4.5",
  ...
}
```

Available models can be listed with:

```bash
opencode models
```

### Getting Your Telegram User ID

1. Message [@userinfobot](https://t.me/userinfobot) on Telegram
2. It will reply with your user ID
3. Add this ID to `TELEGRAM_ALLOWED_USERS`

### Slack Setup

To use the Slack adapter:

1. **Create a Slack App** at [api.slack.com/apps](https://api.slack.com/apps)
   - Click "Create New App" → "From scratch"
   - Choose a name (e.g., "OpenCode Chat Bridge") and workspace

2. **Enable Socket Mode**
   - Go to "Socket Mode" in the left sidebar
   - Toggle "Enable Socket Mode" to ON
   - Generate an app-level token with `connections:write` scope
   - Copy the `xapp-...` token → This is your `SLACK_APP_TOKEN`

3. **Add Bot Token Scopes**
   - Go to "OAuth & Permissions" → "Scopes" → "Bot Token Scopes"
   - Add these scopes:
     - `chat:write` - Send messages
     - `channels:history` - Read channel messages
     - `im:history` - Read DM messages
     - `app_mentions:read` - Receive mentions
     - `channels:read` - List channels
     - `groups:read` - List private channels

4. **Install to Workspace**
   - Go to "OAuth & Permissions"
   - Click "Install to Workspace" and authorize
   - Copy the `xoxb-...` token → This is your `SLACK_BOT_TOKEN`

5. **Get Signing Secret**
   - Go to "Basic Information" → "App Credentials"
   - Copy the "Signing Secret" → This is your `SLACK_SIGNING_SECRET`

6. **Enable Event Subscriptions**
   - Go to "Event Subscriptions"
   - Toggle "Enable Events" to ON
   - Under "Subscribe to bot events", add:
     - `message.channels` - Listen to channel messages
     - `message.im` - Listen to direct messages
     - `app_mention` - Listen to mentions
   - Click "Save Changes"

7. **Update your `.env` file**:
   ```bash
   SLACK_BOT_TOKEN=xoxb-your-bot-token
   SLACK_APP_TOKEN=xapp-your-app-token
   SLACK_SIGNING_SECRET=your-signing-secret
   ```

8. **Invite the bot to a channel**:
   - In Slack, type: `/invite @OpenCode Chat Bridge` (or your bot name)
   - Or add it to a channel via the channel settings

**Optional**: Restrict to specific channels by setting `SLACK_ALLOWED_CHANNELS`:

```bash
SLACK_ALLOWED_CHANNELS=C01234567,C89ABCDEF  # Channel IDs only
```

### Running

```bash
# Development (with hot reload)
npm run dev

# Production
npm run build
npm start
```

### Running as a Systemd Service (Linux)

For always-on operation, install as systemd user services:

```bash
# Build the project first
npm run build

# Install the services
./scripts/install-services.sh

# Start both services
systemctl --user start opencode-server opencode-chat-bridge

# Check status
systemctl --user status opencode-server opencode-chat-bridge

# View logs
journalctl --user -u opencode-chat-bridge -f

# Stop services
systemctl --user stop opencode-chat-bridge opencode-server

# Uninstall
./scripts/install-services.sh --uninstall
```

**Enable services to start at boot** (without requiring login):

```bash
sudo loginctl enable-linger $USER
```

**After code changes:**

```bash
npm run build
systemctl --user restart opencode-chat-bridge
```

The install script creates two services:

| Service                | Description                             |
| ---------------------- | --------------------------------------- |
| `opencode-server`      | Headless OpenCode server on port 4096   |
| `opencode-chat-bridge` | Chat bridge for Telegram and Slack bots |

## Telegram Commands

| Command           | Description                                |
| ----------------- | ------------------------------------------ |
| `/start`          | Start the bot and show help                |
| `/help`           | Show available commands                    |
| `/chat [new]`     | Start free chat mode (no project required) |
| `/projects`       | List available projects with buttons       |
| `/switch <name>`  | Switch to a different project              |
| `/status`         | Show current session status                |
| `/clear`          | Clear/reset the current session            |
| `/stop`           | Interrupt current operation                |
| `/search <query>` | Search chat history                        |
| `/history_stats`  | View chat history statistics               |

## Slack Commands

The Slack bot supports the following slash commands:

| Command          | Description                                |
| ---------------- | ------------------------------------------ |
| `/help`          | Show available commands                    |
| `/chat [new]`    | Start free chat mode (no project required) |
| `/projects`      | List available projects with buttons       |
| `/switch <name>` | Switch to a different project              |
| `/ai-status`     | Show current session status                |
| `/clear`         | Clear/reset the current session            |
| `/stop`          | Interrupt current operation                |

## Slack Usage

The Slack bot responds to all messages in channels where it's invited:

- **Direct messages**: Just send a message to the bot
- **Channel messages**: Simply message in any channel where the bot is present
- **Mentions**: You can also mention the bot with `@OpenCode Chat Bridge`

Each user in each channel gets their own OpenCode session. Sessions persist
across restarts.

### Interactive Features

**Project Switching**: Use `/projects` to see clickable buttons for all
available projects. Tap a button to instantly switch, or use
`/switch <project-name>` to switch by typing.

**Permission Handling**: When OpenCode needs permission for an action (file
writes, command execution), you'll see buttons: **✅ Allow Once**, **✅
Always**, **❌ Reject**. Tap to respond instantly.

**Thinking Indicator**: While waiting for responses, you'll see an animated
indicator that cycles through phrases like "🤔 Thinking...", "🔍 Analyzing...",
showing elapsed time after 5 seconds.

**Free Chat Mode**: Use `/chat` to start a general conversation mode without
needing a project. Great for brainstorming, asking questions, or getting help
with anything.

**Note**: Responses are automatically split into chunks if they exceed 3000
characters (Slack message limit).

## Features in Detail

### Thinking Indicator

When you send a message, the bot shows an animated thinking indicator:

- Cycles through phrases: "Thinking...", "Analyzing...", "Processing...", etc.
- Shows elapsed time after 5 seconds
- Sends Telegram "typing" action periodically
- Automatically disappears when the response arrives

### Permission Handling

When OpenCode needs permission for an action (file writes, command execution,
etc.):

- Bot shows a permission request with details
- Inline buttons: **Allow Once**, **Always Allow**, **Reject**
- Response is sent back to OpenCode to continue or cancel

### Project Switching

Switch between projects without losing session context:

- Use `/projects` to see available projects
- Tap a project button or use `/switch <name>`
- Session reconnects to OpenCode with the new project path

## REST API

All API endpoints require the `X-API-Key` header.

### Endpoints

```
GET  /api/health                    - Health check
GET  /api/sessions                  - List all active sessions
GET  /api/sessions/:chatId          - Get session details
DELETE /api/sessions/:chatId        - Clear a session
POST /api/sessions/:chatId/message  - Send message to session
POST /api/sessions/:chatId/interrupt - Interrupt current operation
```

### Example API Usage

```bash
# Health check
curl http://localhost:3000/api/health

# List sessions
curl -H "X-API-Key: your-api-key" http://localhost:3000/api/sessions

# Send a message
curl -X POST \
  -H "X-API-Key: your-api-key" \
  -H "Content-Type: application/json" \
  -d '{"message": "Hello OpenCode!"}' \
  http://localhost:3000/api/sessions/12345/message
```

## Project Structure

```
opencode-chat-bridge/
├── src/
│   ├── index.ts              # Main entry point
│   ├── config/
│   │   └── index.ts          # Configuration loader
│   ├── server/
│   │   ├── app.ts            # Express application
│   │   └── routes/
│   │       └── api.ts        # API endpoints
│   ├── sessions/
│   │   ├── Session.ts        # Individual session (uses OpenCodeClient)
│   │   └── SessionManager.ts # Session lifecycle management
│   ├── adapters/
│   │   ├── BaseAdapter.ts    # Abstract adapter interface
│   │   ├── index.ts          # Adapter exports
│   │   ├── TelegramAdapter.ts # Telegram bot implementation
│   │   └── SlackAdapter.ts   # Slack bot implementation (Socket Mode)
│   ├── opencode/
│   │   ├── OpenCodeClient.ts # OpenCode SDK wrapper
│   │   ├── types.ts          # TypeScript types
│   │   └── index.ts          # OpenCode exports
│   └── utils/
│       ├── logger.ts         # Winston logger
│       └── messageFormatter.ts # Message formatting utilities
├── scripts/
│   ├── install-services.sh   # Systemd service installer
│   ├── opencode-server.service       # Template (reference only)
│   └── opencode-chat-bridge.service  # Template (reference only)
├── package.json
├── tsconfig.json
└── .env.example
```

## Session Persistence

Sessions are automatically saved when:

- You switch projects
- The server shuts down gracefully

Sessions are restored when:

- You send `/start` to the bot
- You send any message after a restart

To clear a session completely: `/clear`

## Adding More Chat Platforms

The adapter pattern makes it easy to add new platforms:

1. Create a new adapter in `src/adapters/` implementing `ChatAdapter`
2. Add configuration options to `src/config/index.ts`
3. Initialize the adapter in `src/index.ts`

Example adapters already implemented:

- ✅ `TelegramAdapter.ts` - Using `telegraf` with full command support
- ✅ `SlackAdapter.ts` - Using `@slack/bolt` with Socket Mode

Potential adapters to add:

- `DiscordAdapter.ts` - Using `discord.js`
- `MSTeamsAdapter.ts` - Using `@microsoft/teams-js`

## Development

```bash
# Install dependencies
npm install

# Run in development mode (hot reload)
npm run dev

# Type checking
npm run typecheck

# Linting
npm run lint

# Format code
npm run format

# Build for production
npm run build
```

## Security Considerations

1. **API Key**: Always set a strong `API_KEY` in production
2. **Telegram Users**: Only allow trusted user IDs in `TELEGRAM_ALLOWED_USERS`
3. **Slack Channels**: Optionally restrict bot to specific channels with
   `SLACK_ALLOWED_CHANNELS`
4. **Projects Directory**: Limit to directories you want to expose
5. **Network**: Consider running behind a reverse proxy with HTTPS
6. **OpenCode Permissions**: The AI can execute code - review permission
   requests carefully
7. **Socket Mode**: Slack uses Socket Mode (WebSocket) - no public URL required

## Troubleshooting

### OpenCode not found

Ensure OpenCode is installed and in your PATH:

```bash
which opencode
opencode --version
```

### No response from AI

1. Check your OpenCode model configuration in `~/.config/opencode/opencode.json`
2. Verify the model is available: `opencode models`
3. Check logs for SSE event errors: `LOG_LEVEL=debug npm run dev`

### Telegram bot not responding

1. Check your bot token is correct
2. Verify your user ID is in `TELEGRAM_ALLOWED_USERS`
3. Check logs for errors: `LOG_LEVEL=debug npm run dev`

### Slack bot not responding

1. Verify all three tokens are correct in `.env`:
   - `SLACK_BOT_TOKEN` (starts with `xoxb-`)
   - `SLACK_APP_TOKEN` (starts with `xapp-`)
   - `SLACK_SIGNING_SECRET`
2. Check Socket Mode is enabled in your Slack App settings
3. Verify the bot is invited to the channel: `/invite @YourBotName`
4. Check logs: `journalctl --user -u opencode-chat-bridge -f`
5. Look for "Slack bot started successfully" and "Now connected to Slack" in
   logs

### Slack Socket Mode connection issues

If you see "SlackBolt.App is not a constructor" or import errors:

1. Ensure `@slack/bolt` is properly installed: `npm install`
2. Check Node.js version is 20+: `node --version`
3. Rebuild the project: `npm run build`

### Session issues

Clear the session and restart:

```
/clear
```

### Thinking indicator doesn't disappear

This usually means SSE events aren't being received properly:

1. Check OpenCode server is running (logs should show "OpenCode server started")
2. Verify SSE subscription is active
3. Try `/clear` and send a new message

### Systemd service issues

```bash
# Check service status
systemctl --user status opencode-server opencode-chat-bridge

# View full logs
journalctl --user -u opencode-server --no-pager
journalctl --user -u opencode-chat-bridge --no-pager

# Restart after fixing issues
systemctl --user restart opencode-server opencode-chat-bridge

# If services don't start at boot
sudo loginctl enable-linger $USER
```

## License

MIT

## Contributing

Pull requests welcome! Please follow the existing code style and add tests for
new features.
