/**
 * Base interface for chat platform adapters
 * Allows easy addition of new platforms (Slack, Discord, etc.)
 */
export interface ChatAdapter {
  /**
   * Start the adapter (connect to platform)
   */
  start(): Promise<void>;

  /**
   * Stop the adapter (disconnect)
   */
  stop(): Promise<void>;

  /**
   * Send a message to a chat
   */
  sendMessage(chatId: string, message: string): Promise<void>;

  /**
   * Send a message with inline keyboard/buttons
   */
  sendWithButtons?(
    chatId: string,
    message: string,
    buttons: Array<{ text: string; callbackData: string }>
  ): Promise<void>;

  /**
   * Get adapter name
   */
  getName(): string;
}

/**
 * Message received from a chat platform
 */
export interface IncomingMessage {
  chatId: string;
  userId: string;
  username?: string;
  text: string;
  isCommand: boolean;
  command?: string;
  args?: string[];
}

/**
 * Callback data from button press
 */
export interface CallbackData {
  chatId: string;
  userId: string;
  data: string;
  messageId?: string;
}