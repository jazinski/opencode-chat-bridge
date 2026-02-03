/**
 * OpenCodeClient - Wrapper for the OpenCode SDK
 *
 * Manages the OpenCode server lifecycle and provides a clean API
 * for session management and message handling.
 */

import { EventEmitter } from 'events';
import {
  createOpencode,
  createOpencodeClient,
  type OpencodeClient as SDKOpencodeClient,
  type Session,
  type Part,
  type Event,
  type TextPart,
  type ToolPart,
  type FilePart,
  type ReasoningPart,
  type Permission,
  type SessionStatus,
  type Message,
  type AssistantMessage,
} from '@opencode-ai/sdk';
import { logger } from '../utils/logger.js';

export interface OpenCodeClientOptions {
  /** Port for the OpenCode server (default: auto-select) */
  port?: number;
  /** Hostname for the OpenCode server (default: localhost) */
  hostname?: string;
  /** Working directory for OpenCode */
  directory?: string;
  /** Timeout for server startup in ms (default: 30000) */
  startupTimeout?: number;
  /** Whether to auto-start the server (default: true) */
  autoStart?: boolean;
  /** AI model configuration (optional) */
  model?: {
    providerID: string;
    modelID: string;
  };
}

export interface MessageResponse {
  info: AssistantMessage;
  parts: Part[];
}

export interface OpenCodeClientEvents {
  /** Emitted when a message part is updated (streaming) */
  'message.part.updated': (data: { part: Part; delta?: string }) => void;
  /** Emitted when a message is completed */
  'message.updated': (data: { info: Message }) => void;
  /** Emitted when session status changes */
  'session.status': (data: { sessionID: string; status: SessionStatus }) => void;
  /** Emitted when session becomes idle */
  'session.idle': (data: { sessionID: string }) => void;
  /** Emitted when a permission is requested */
  'permission.updated': (data: Permission) => void;
  /** Emitted when session has an error */
  'session.error': (data: { sessionID?: string; error?: unknown }) => void;
  /** Emitted when the client is ready */
  ready: () => void;
  /** Emitted when the client encounters an error */
  error: (error: Error) => void;
  /** Emitted when the client is closed */
  closed: () => void;
}

export class OpenCodeClient extends EventEmitter {
  private client: SDKOpencodeClient | null = null;
  private serverHandle: { url: string; close: () => void } | null = null;
  private options: Required<Omit<OpenCodeClientOptions, 'model'>> &
    Pick<OpenCodeClientOptions, 'model'>;
  private eventAbortController: AbortController | null = null;
  private isReady = false;
  private isClosing = false;

  constructor(options: OpenCodeClientOptions = {}) {
    super();
    this.options = {
      port: options.port ?? 0, // 0 = auto-select
      hostname: options.hostname ?? 'localhost',
      directory: options.directory ?? process.cwd(),
      startupTimeout: options.startupTimeout ?? 30000,
      autoStart: options.autoStart ?? true,
      model: options.model,
    };

    if (this.options.autoStart) {
      this.start().catch((err) => {
        logger.error('Failed to auto-start OpenCode client', { error: err });
        this.emit('error', err);
      });
    }
  }

  /**
   * Type-safe event emitter methods
   */
  override on<K extends keyof OpenCodeClientEvents>(
    event: K,
    listener: OpenCodeClientEvents[K]
  ): this {
    return super.on(event, listener);
  }

  override emit<K extends keyof OpenCodeClientEvents>(
    event: K,
    ...args: Parameters<OpenCodeClientEvents[K]>
  ): boolean {
    return super.emit(event, ...args);
  }

  /**
   * Start the OpenCode server and initialize the client
   */
  async start(): Promise<void> {
    if (this.isReady) {
      logger.debug('OpenCode client already started');
      return;
    }

    try {
      logger.info('Starting OpenCode server...', {
        port: this.options.port,
        directory: this.options.directory,
      });

      // Use createOpencode which spawns the server and returns a client
      const result = await createOpencode({
        port: this.options.port || undefined,
        hostname: this.options.hostname,
      });

      this.serverHandle = result.server;
      this.client = result.client;

      logger.info('OpenCode server started', { url: this.serverHandle.url });

      // Start listening to events
      this.startEventStream();

      this.isReady = true;
      this.emit('ready');
    } catch (error) {
      logger.error('Failed to start OpenCode server', { error });
      throw error;
    }
  }

  /**
   * Connect to an existing OpenCode server
   */
  async connect(baseUrl: string): Promise<void> {
    if (this.isReady) {
      logger.debug('OpenCode client already connected');
      return;
    }

    try {
      logger.info('Connecting to OpenCode server...', { baseUrl });

      this.client = createOpencodeClient({
        baseUrl,
        directory: this.options.directory,
      });

      // Start listening to events
      this.startEventStream();

      this.isReady = true;
      this.emit('ready');
    } catch (error) {
      logger.error('Failed to connect to OpenCode server', { error });
      throw error;
    }
  }

  /**
   * Start listening to SSE events from the server
   */
  private startEventStream(): void {
    if (!this.client) return;

    this.eventAbortController = new AbortController();

    // Subscribe to events using the SDK's event subscription
    this.subscribeToEvents().catch((err) => {
      if (!this.isClosing) {
        logger.error('Event stream error', { error: err });
        this.emit('error', err);
      }
    });
  }

  /**
   * Subscribe to SSE events
   */
  private async subscribeToEvents(): Promise<void> {
    if (!this.client) return;

    try {
      // The SDK provides event.subscribe() which returns an SSE result with an async generator
      const sseResult = await this.client.event.subscribe({
        query: { directory: this.options.directory },
      });

      // Consume the async generator stream
      for await (const event of sseResult.stream) {
        if (this.isClosing) break;
        this.handleEvent(event as Event);
      }
    } catch (error) {
      if (!this.isClosing) {
        throw error;
      }
    }
  }

  /**
   * Handle an incoming event from the SSE stream
   */
  private handleEvent(event: Event): void {
    // Debug: log event type (not full properties to avoid noise)
    logger.debug(`[SSE] type=${event.type}`);

    switch (event.type) {
      case 'message.part.updated':
        this.emit('message.part.updated', event.properties);
        break;

      case 'message.updated':
        this.emit('message.updated', event.properties);
        break;

      case 'session.status':
        this.emit('session.status', event.properties);
        break;

      case 'session.idle':
        this.emit('session.idle', event.properties);
        break;

      case 'permission.updated':
        this.emit('permission.updated', event.properties);
        break;

      case 'session.error':
        this.emit('session.error', event.properties);
        break;

      default:
        logger.debug('Unhandled event type', { type: event.type });
    }
  }

  /**
   * Create a new session
   */
  async createSession(title?: string): Promise<Session> {
    this.ensureReady();

    const response = await this.client!.session.create({
      body: { title },
      query: { directory: this.options.directory },
    });

    if (response.error) {
      throw new Error(`Failed to create session: ${JSON.stringify(response.error)}`);
    }

    logger.info('Created session', { sessionId: response.data?.id, title });
    return response.data!;
  }

  /**
   * Get an existing session
   */
  async getSession(sessionId: string): Promise<Session> {
    this.ensureReady();

    const response = await this.client!.session.get({
      path: { id: sessionId },
      query: { directory: this.options.directory },
    });

    if (response.error) {
      throw new Error(`Failed to get session: ${JSON.stringify(response.error)}`);
    }

    return response.data!;
  }

  /**
   * List all sessions
   */
  async listSessions(): Promise<Session[]> {
    this.ensureReady();

    const response = await this.client!.session.list({
      query: { directory: this.options.directory },
    });

    if (response.error) {
      throw new Error(`Failed to list sessions: ${JSON.stringify(response.error)}`);
    }

    return response.data ?? [];
  }

  /**
   * Send a message to a session (synchronous - waits for response)
   */
  async sendMessage(
    sessionId: string,
    text: string,
    model?: { providerID: string; modelID: string }
  ): Promise<MessageResponse> {
    this.ensureReady();

    const response = await this.client!.session.prompt({
      path: { id: sessionId },
      body: {
        parts: [{ type: 'text', text }],
        model: model || this.options.model,
      },
      query: { directory: this.options.directory },
    });

    if (response.error) {
      throw new Error(`Failed to send message: ${JSON.stringify(response.error)}`);
    }

    return response.data!;
  }

  /**
   * Send a message asynchronously (returns immediately, use events for response)
   */
  async sendMessageAsync(
    sessionId: string,
    text: string,
    model?: { providerID: string; modelID: string }
  ): Promise<void> {
    this.ensureReady();

    const response = await this.client!.session.promptAsync({
      path: { id: sessionId },
      body: {
        parts: [{ type: 'text', text }],
        model: model || this.options.model,
      },
      query: { directory: this.options.directory },
    });

    if (response.error) {
      throw new Error(`Failed to send async message: ${JSON.stringify(response.error)}`);
    }
  }

  /**
   * Abort a running session
   */
  async abortSession(sessionId: string): Promise<void> {
    this.ensureReady();

    const response = await this.client!.session.abort({
      path: { id: sessionId },
      query: { directory: this.options.directory },
    });

    if (response.error) {
      throw new Error(`Failed to abort session: ${JSON.stringify(response.error)}`);
    }

    logger.info('Aborted session', { sessionId });
  }

  /**
   * Delete a session
   */
  async deleteSession(sessionId: string): Promise<void> {
    this.ensureReady();

    const response = await this.client!.session.delete({
      path: { id: sessionId },
      query: { directory: this.options.directory },
    });

    if (response.error) {
      throw new Error(`Failed to delete session: ${JSON.stringify(response.error)}`);
    }

    logger.info('Deleted session', { sessionId });
  }

  /**
   * Get messages from a session
   */
  async getMessages(
    sessionId: string,
    limit?: number
  ): Promise<Array<{ info: Message; parts: Part[] }>> {
    this.ensureReady();

    const response = await this.client!.session.messages({
      path: { id: sessionId },
      query: { directory: this.options.directory, limit },
    });

    if (response.error) {
      throw new Error(`Failed to get messages: ${JSON.stringify(response.error)}`);
    }

    return response.data ?? [];
  }

  /**
   * Reply to a permission request
   */
  async replyToPermission(
    sessionId: string,
    permissionId: string,
    permissionResponse: 'once' | 'always' | 'reject'
  ): Promise<void> {
    this.ensureReady();

    const result = await this.client!.postSessionIdPermissionsPermissionId({
      path: { id: sessionId, permissionID: permissionId },
      body: { response: permissionResponse },
      query: { directory: this.options.directory },
    });

    if (result.error) {
      throw new Error(`Failed to reply to permission: ${JSON.stringify(result.error)}`);
    }
  }

  /**
   * Get session status
   */
  async getSessionStatus(): Promise<Record<string, SessionStatus>> {
    this.ensureReady();

    const response = await this.client!.session.status({
      query: { directory: this.options.directory },
    });

    if (response.error) {
      throw new Error(`Failed to get session status: ${JSON.stringify(response.error)}`);
    }

    return response.data ?? {};
  }

  /**
   * Check if the client is ready
   */
  get ready(): boolean {
    return this.isReady;
  }

  /**
   * Get the server URL
   */
  get serverUrl(): string | null {
    return this.serverHandle?.url ?? null;
  }

  /**
   * Close the client and server
   */
  async close(): Promise<void> {
    if (this.isClosing) return;
    this.isClosing = true;

    logger.info('Closing OpenCode client...');

    // Stop event stream
    if (this.eventAbortController) {
      this.eventAbortController.abort();
      this.eventAbortController = null;
    }

    // Close server if we started it
    if (this.serverHandle) {
      this.serverHandle.close();
      this.serverHandle = null;
    }

    this.client = null;
    this.isReady = false;

    this.emit('closed');
    logger.info('OpenCode client closed');
  }

  /**
   * Ensure the client is ready before making API calls
   */
  private ensureReady(): void {
    if (!this.isReady || !this.client) {
      throw new Error('OpenCode client is not ready. Call start() or connect() first.');
    }
  }
}

/**
 * Helper functions for extracting content from message parts
 */
export function extractTextFromParts(parts: Part[]): string {
  return parts
    .filter((p): p is TextPart => p.type === 'text')
    .map((p) => p.text)
    .join('\n');
}

export function extractToolsFromParts(parts: Part[]): ToolPart[] {
  return parts.filter((p): p is ToolPart => p.type === 'tool');
}

export function extractFilesFromParts(parts: Part[]): FilePart[] {
  return parts.filter((p): p is FilePart => p.type === 'file');
}

export function extractReasoningFromParts(parts: Part[]): ReasoningPart[] {
  return parts.filter((p): p is ReasoningPart => p.type === 'reasoning');
}

export default OpenCodeClient;
