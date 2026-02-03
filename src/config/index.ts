import dotenv from 'dotenv';
import path from 'path';
import os from 'os';

// Load environment variables from .env file
// override: false means existing environment variables take precedence
// This is important for systemd services that use EnvironmentFile
dotenv.config({ override: false });

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

  // Slack
  slackBotToken: string;
  slackAppToken: string;
  slackSigningSecret: string;
  slackAllowedChannels: string[];

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
  dmSessionTimeoutMinutes: number; // Longer timeout for DM sessions
  sessionPersistDir: string;
  contextInjectionMaxTokens: number; // Max tokens to inject as context from history

  // Database
  postgresUrl: string | null;

  // Logging
  logLevel: string;

  // Azure DevOps Webhooks
  azureDevOpsWebhookSecret: string;
  azureDevOpsBotName: string;
  azureDevOpsAllowedIps: string[];

  // Workflows
  workflowTimeoutMinutes: number;
  workflowMaxAgents: number;
}

function parseAllowedUsers(value: string | undefined): number[] {
  if (!value) return [];
  // Remove inline comments (everything after #)
  const cleanValue = value.split('#')[0].trim();
  if (!cleanValue) return [];
  return cleanValue
    .split(',')
    .map((id) => parseInt(id.trim(), 10))
    .filter((id) => !isNaN(id));
}

function parseAllowedChannels(value: string | undefined): string[] {
  if (!value) return [];
  // Remove inline comments (everything after #)
  const cleanValue = value.split('#')[0].trim();
  if (!cleanValue) return [];
  return cleanValue
    .split(',')
    .map((channel) => channel.trim())
    .filter((channel) => channel.length > 0);
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

  // Slack
  slackBotToken: process.env.SLACK_BOT_TOKEN || '',
  slackAppToken: process.env.SLACK_APP_TOKEN || '',
  slackSigningSecret: process.env.SLACK_SIGNING_SECRET || '',
  slackAllowedChannels: parseAllowedChannels(process.env.SLACK_ALLOWED_CHANNELS),

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
  dmSessionTimeoutMinutes: parseInt(process.env.DM_SESSION_TIMEOUT_MINUTES || '1440', 10), // Default 24 hours for DMs
  sessionPersistDir: expandHome(process.env.SESSION_PERSIST_DIR || './sessions'),
  contextInjectionMaxTokens: parseInt(process.env.CONTEXT_INJECTION_MAX_TOKENS || '8000', 10), // Default 8K tokens

  // Database
  postgresUrl: process.env.POSTGRES_URL || null,

  // Logging
  logLevel: process.env.LOG_LEVEL || 'info',

  // Azure DevOps Webhooks
  azureDevOpsWebhookSecret: process.env.AZURE_DEVOPS_WEBHOOK_SECRET || '',
  azureDevOpsBotName: process.env.AZURE_DEVOPS_BOT_NAME || '@OpenCodeBot',
  azureDevOpsAllowedIps: parseAllowedChannels(process.env.AZURE_DEVOPS_ALLOWED_IPS),

  // Workflows
  workflowTimeoutMinutes: parseInt(process.env.WORKFLOW_TIMEOUT_MINUTES || '30', 10),
  workflowMaxAgents: parseInt(process.env.WORKFLOW_MAX_AGENTS || '5', 10),
};

export function validateConfig(): void {
  const errors: string[] = [];

  // At least one chat adapter must be configured
  const hasTelegram = !!config.telegramBotToken;
  const hasSlack = !!config.slackBotToken && !!config.slackAppToken && !!config.slackSigningSecret;

  if (!hasTelegram && !hasSlack) {
    errors.push('At least one chat adapter must be configured (Telegram or Slack)');
  }

  if (!config.apiKey) {
    errors.push('API_KEY is required for security');
  }

  if (errors.length > 0) {
    throw new Error(`Configuration errors:\n${errors.join('\n')}`);
  }
}

export default config;
