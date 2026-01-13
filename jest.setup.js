// Jest setup file for global test configuration
// Mock environment variables for tests
process.env.NODE_ENV = 'test';
process.env.API_KEY = 'test-api-key';
process.env.TELEGRAM_BOT_TOKEN = 'test-telegram-token';
process.env.PROJECTS_DIR = '/tmp/test-projects';
process.env.FREE_CHAT_DIR = '/tmp/test-free-chat';
process.env.SESSION_PERSIST_DIR = '/tmp/test-sessions';
process.env.LOG_LEVEL = 'error'; // Reduce log noise in tests
