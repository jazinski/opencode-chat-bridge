import dotenv from 'dotenv';
import path from 'path';
import os from 'os';

// Load environment variables
dotenv.config();

function expandHome(filepath: string): string {
  if (filepath.startsWith('~/')) {
    return path.join(os.homedir(), filepath.slice(2));
  }
  return filepath;
}

export interface Config {
  // Server
  port: number;
  nodeEnv: string;

  // API Security
  apiKey: string;

  // Telegram
  telegramBotToken: string;
  telegramAllowedUsers: number[];

  // OpenCode
  opencodeCommand: string;
  projectsDir: string;
  freeChatDir: string; // Directory for free-flowing chat mode (no project)

  // OpenCode Server API
  opencodeServerPort: number; // Port for OpenCode server (0 = auto-select)
  opencodeServerHostname: string; // Hostname for OpenCode server
  opencodeServerUrl: string | null; // Full URL to external OpenCode server (if set, port/hostname ignored)

  // Sessions
  sessionTimeoutMinutes: number;
  sessionPersistDir: string;

  // Logging
  logLevel: string;
}

function parseAllowedUsers(value: string | undefined): number[] {
  if (!value) return [];
  return value
    .split(',')
    .map((id) => parseInt(id.trim(), 10))
    .filter((id) => !isNaN(id));
}

export const config: Config = {
  // Server
  port: parseInt(process.env.PORT || '3000', 10),
  nodeEnv: process.env.NODE_ENV || 'development',

  // API Security
  apiKey: process.env.API_KEY || '',

  // Telegram
  telegramBotToken: process.env.TELEGRAM_BOT_TOKEN || '',
  telegramAllowedUsers: parseAllowedUsers(process.env.TELEGRAM_ALLOWED_USERS),

  // OpenCode
  opencodeCommand: process.env.OPENCODE_COMMAND || 'opencode',
  projectsDir: expandHome(process.env.PROJECTS_DIR || '~/projects'),
  freeChatDir: expandHome(process.env.FREE_CHAT_DIR || '~/.opencode-chat'),

  // OpenCode Server API
  opencodeServerPort: parseInt(process.env.OPENCODE_SERVER_PORT || '0', 10),
  opencodeServerHostname: process.env.OPENCODE_SERVER_HOSTNAME || 'localhost',
  opencodeServerUrl: process.env.OPENCODE_SERVER_URL || null,

  // Sessions
  sessionTimeoutMinutes: parseInt(process.env.SESSION_TIMEOUT_MINUTES || '30', 10),
  sessionPersistDir: expandHome(process.env.SESSION_PERSIST_DIR || './sessions'),

  // Logging
  logLevel: process.env.LOG_LEVEL || 'info',
};

export function validateConfig(): void {
  const errors: string[] = [];

  if (!config.telegramBotToken) {
    errors.push('TELEGRAM_BOT_TOKEN is required');
  }

  if (!config.apiKey) {
    errors.push('API_KEY is required for security');
  }

  if (errors.length > 0) {
    throw new Error(`Configuration errors:\n${errors.join('\n')}`);
  }
}

export default config;
