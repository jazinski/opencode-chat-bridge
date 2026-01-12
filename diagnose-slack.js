#!/usr/bin/env node
/**
 * Diagnostic script for Slack integration
 * Run this to check Slack connection and message handling
 */

import { config } from './dist/config/index.js';
import slack from '@slack/bolt';

const { App, LogLevel } = slack;

console.log('=== Slack Diagnostics ===\n');
console.log('Configuration:');
console.log('- Bot Token:', config.slackBotToken ? '✓ Set' : '✗ Missing');
console.log('- App Token:', config.slackAppToken ? '✓ Set' : '✗ Missing');
console.log('- Signing Secret:', config.slackSigningSecret ? '✓ Set' : '✗ Missing');
console.log(
  '- Allowed Channels:',
  config.slackAllowedChannels.length > 0
    ? config.slackAllowedChannels.join(', ')
    : 'All channels (no restriction)'
);
console.log('\nAttempting to connect to Slack...\n');

const app = new App({
  token: config.slackBotToken,
  appToken: config.slackAppToken,
  signingSecret: config.slackSigningSecret,
  socketMode: true,
  logLevel: LogLevel.DEBUG,
});

// Log all incoming messages for diagnostics
app.message(async ({ message, logger }) => {
  console.log('\n📨 Message received!');
  console.log('- Channel:', message.channel);
  console.log('- User:', message.user);
  console.log('- Text:', message.text?.substring(0, 100));
  console.log(
    '- Is allowed?',
    config.slackAllowedChannels.length === 0 ||
      config.slackAllowedChannels.includes(message.channel)
  );

  if (
    config.slackAllowedChannels.length > 0 &&
    !config.slackAllowedChannels.includes(message.channel)
  ) {
    console.log('❌ Message rejected: Channel not in allowed list');
    console.log('   Expected one of:', config.slackAllowedChannels.join(', '));
  } else {
    console.log('✓ Message accepted - would be processed');
  }
});

app.error(async (error) => {
  console.error('❌ Error:', error);
});

try {
  await app.start();
  console.log('✓ Slack app is running in Socket Mode');
  console.log('\nWaiting for messages...');
  console.log('Send a message in Slack to test the connection.');
  console.log('Press Ctrl+C to stop.\n');
} catch (error) {
  console.error('❌ Failed to start Slack app:', error);
  process.exit(1);
}
