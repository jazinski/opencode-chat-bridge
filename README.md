# OpenCode Chat Bridge

> Node/Express API wrapper for OpenCode CLI - enables task dispatch via Telegram, Slack, Discord chat interfaces

🤖 **Bridge your chat platforms to OpenCode** - interact with your AI coding agent from Telegram, Slack, Discord, or any other chat interface.

## Features

- 📱 **Telegram Bot Integration** - Full-featured Telegram bot with inline keyboards
- 🔄 **Session Management** - Persistent sessions that survive restarts
- 📂 **Project Switching** - Dynamically switch between projects in `~/projects`
- 🔐 **API Key Security** - Secure REST API with authentication
- 💻 **Full PTY Emulation** - Complete terminal emulation with `node-pty`
- ✅ **Confirmation Handling** - Interactive y/n prompts with buttons
- 📦 **Chunked Output** - Long responses split for chat platform limits

## Architecture

```
┌─────────────────┐     ┌──────────────────────┐     ┌───────────────┐
│  Telegram Bot   │────▶│   Express Server     │────▶│   OpenCode    │
│  (telegraf)     │◀────│   Session Manager    │◀────│   PTY Process │
└─────────────────┘     └──────────────────────┘     └───────────────┘
```

## Quick Start

### Prerequisites

- Node.js 20+
- OpenCode CLI installed and in PATH
- Telegram Bot Token (from [@BotFather](https://t.me/botfather))

### Installation

```bash
# Clone the repository
git clone https://github.com/cjazinski/opencode-chat-bridge.git
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

# Telegram - REQUIRED
TELEGRAM_BOT_TOKEN=123456:ABC-DEF1234ghIkl-zyx57W2v1u123ew11
TELEGRAM_ALLOWED_USERS=123456789  # Your Telegram user ID

# OpenCode
OPENCODE_COMMAND=opencode
PROJECTS_DIR=~/projects

# Sessions
SESSION_TIMEOUT_MINUTES=30
SESSION_PERSIST_DIR=./sessions

# Logging
LOG_LEVEL=info
```

### Getting Your Telegram User ID

1. Message [@userinfobot](https://t.me/userinfobot) on Telegram
2. It will reply with your user ID
3. Add this ID to `TELEGRAM_ALLOWED_USERS`

### Running

```bash
# Development (with hot reload)
npm run dev

# Production
npm run build
npm start
```

## Telegram Commands

| Command | Description |
|---------|-------------|
| `/start` | Start the bot and show help |
| `/help` | Show available commands |
| `/projects` | List available projects in ~/projects |
| `/switch <name>` | Switch to a different project |
| `/status` | Show current session status |
| `/clear` | Clear/reset the current session |
| `/stop` | Interrupt current operation (Ctrl+C) |

## REST API

All API endpoints require the `X-API-Key` header.

### Endpoints

```
GET  /api/health                    - Health check
GET  /api/sessions                  - List all active sessions
GET  /api/sessions/:chatId          - Get session details
DELETE /api/sessions/:chatId        - Clear a session
POST /api/sessions/:chatId/message  - Send message to session
POST /api/sessions/:chatId/interrupt - Send Ctrl+C to session
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
│   │   ├── Session.ts        # Individual session class
│   │   └── SessionManager.ts # Session lifecycle management
│   ├── adapters/
│   │   ├── BaseAdapter.ts    # Abstract adapter interface
│   │   └── TelegramAdapter.ts # Telegram bot implementation
│   ├── pty/
│   │   └── PtyHandler.ts     # PTY process management
│   └── utils/
│       ├── logger.ts         # Winston logger
│       └── outputParser.ts   # ANSI stripping, chunking
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

Example adapters to add:
- `SlackAdapter.ts` - Using `@slack/bolt`
- `DiscordAdapter.ts` - Using `discord.js`

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
3. **Projects Directory**: Limit to directories you want to expose
4. **Network**: Consider running behind a reverse proxy with HTTPS

## Troubleshooting

### OpenCode not found

Ensure OpenCode is in your PATH:
```bash
which opencode
```

Or specify the full path in `.env`:
```bash
OPENCODE_COMMAND=/path/to/opencode
```

### Telegram bot not responding

1. Check your bot token is correct
2. Verify your user ID is in `TELEGRAM_ALLOWED_USERS`
3. Check logs for errors: `LOG_LEVEL=debug npm run dev`

### Session issues

Clear the session and restart:
```
/clear
```

## License

MIT

## Contributing

Pull requests welcome! Please follow the existing code style and add tests for new features.