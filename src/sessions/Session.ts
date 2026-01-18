import { v4 as uuidv4 } from 'uuid';
import { EventEmitter } from 'events';
import { OpenCodeClient } from '@/opencode/OpenCodeClient.js';
import { logger } from '@/utils/logger.js';
import { formatParts, formatPermissionRequest } from '@/utils/messageFormatter.js';
import config from '@/config';
import type { Part, Permission } from '@opencode-ai/sdk';

export interface SessionData {
  id: string;
  chatId: string;
  userId: string;
  projectPath: string;
  createdAt: Date;
  lastActivity: Date;
  opencodeSessionId?: string;
}

export type SessionStatus = 'idle' | 'active' | 'busy' | 'terminated';

/**
 * Session events
 */
export interface SessionEvents {
  /** Emitted when there is output to display */
  output: (data: string) => void;
  /** Emitted when streaming text arrives */
  streaming: (text: string) => void;
  /** Emitted when a permission is requested */
  permission: (permission: Permission) => void;
  /** Emitted when session status changes */
  statusChange: (status: SessionStatus) => void;
  /** Emitted when session has an error */
  error: (error: Error) => void;
  /** Emitted when session is terminated */
  terminated: () => void;
}

/**
 * Represents a single OpenCode session tied to a chat user
 * Uses the OpenCode Server API instead of PTY for clean structured output
 */
export class Session extends EventEmitter {
  public readonly id: string;
  public readonly chatId: string;
  public readonly userId: string;
  public projectPath: string;
  public readonly createdAt: Date;
  public lastActivity: Date;

  private openCodeClient: OpenCodeClient | null = null;
  private opencodeSessionId: string | null = null;
  private status: SessionStatus = 'idle';
  private outputCallback: ((data: string) => void) | null = null;
  private pendingOutput: string[] = [];
  private accumulatedText: string = '';
  private pendingPermissions: Map<string, Permission> = new Map();
  private isSwitchingProject: boolean = false;
  private timeoutMinutes: number; // Session-specific timeout

  constructor(chatId: string, userId: string, projectPath: string, timeoutMinutes?: number) {
    super();
    this.id = uuidv4();
    this.chatId = chatId;
    this.userId = userId;
    this.projectPath = projectPath;
    this.createdAt = new Date();
    this.lastActivity = new Date();
    this.timeoutMinutes = timeoutMinutes || config.sessionTimeoutMinutes;

    logger.info(`Session created: ${this.id} for user ${userId} at ${projectPath} (timeout: ${this.timeoutMinutes}min)`);
  }

  /**
   * Type-safe event emitter methods
   */
  override on<K extends keyof SessionEvents>(event: K, listener: SessionEvents[K]): this {
    return super.on(event, listener);
  }

  override emit<K extends keyof SessionEvents>(
    event: K,
    ...args: Parameters<SessionEvents[K]>
  ): boolean {
    return super.emit(event, ...args);
  }

  /**
   * Start the OpenCode session
   */
  async start(): Promise<void> {
    if (this.status !== 'idle') {
      throw new Error(`Session is ${this.status}, cannot start`);
    }

    try {
      logger.info(`Starting OpenCode session for ${this.id} in ${this.projectPath}`);

      // Create the OpenCode client
      this.openCodeClient = new OpenCodeClient({
        port: config.opencodeServerPort,
        hostname: config.opencodeServerHostname,
        directory: this.projectPath,
        autoStart: false,
      });

      // Connect to external server or start a new one
      if (config.opencodeServerUrl) {
        logger.info(`Connecting to external OpenCode server at ${config.opencodeServerUrl}`);
        await this.openCodeClient.connect(config.opencodeServerUrl);
      } else {
        await this.openCodeClient.start();
      }

      // Set up event handlers
      this.setupEventHandlers();

      // Create an OpenCode session
      const session = await this.openCodeClient.createSession(`Chat ${this.chatId}`);
      this.opencodeSessionId = session.id;

      this.status = 'active';
      this.touch();

      logger.info(
        `OpenCode session started: ${this.opencodeSessionId} for bridge session ${this.id}`
      );
    } catch (error) {
      logger.error(`Failed to start OpenCode session for ${this.id}:`, error);
      this.status = 'terminated';
      throw error;
    }
  }

  /**
   * Set up event handlers for the OpenCode client
   */
  private setupEventHandlers(): void {
    if (!this.openCodeClient) return;

    logger.debug(`Setting up event handlers for session ${this.id}`);

    // Handle message part updates (streaming)
    this.openCodeClient.on('message.part.updated', ({ part, delta }) => {
      logger.debug(`[SSE] message.part.updated: type=${part.type}, hasDelta=${!!delta}`);
      this.touch();

      // For text parts, accumulate the text
      if (part.type === 'text') {
        if (delta) {
          // Streaming delta
          this.accumulatedText += delta;
          this.emit('streaming', delta);
        } else if ('text' in part && part.text) {
          // Full text update - replace accumulated text
          this.accumulatedText = part.text;
        }
      }
    });

    // Handle message completion
    this.openCodeClient.on('message.updated', ({ info }) => {
      logger.debug(`[SSE] message.updated: id=${info.id}, role=${info.role}`);
      this.touch();
    });

    // Handle session status changes
    this.openCodeClient.on('session.status', ({ sessionID, status }) => {
      logger.debug(`[SSE] session.status: sessionID=${sessionID}, status=${status.type}`);
      if (sessionID !== this.opencodeSessionId) return;

      if (status.type === 'busy') {
        this.status = 'busy';
        this.emit('statusChange', 'busy');
      } else if (status.type === 'idle') {
        // Also handle idle status here as a fallback
        logger.debug(`[SSE] session.status idle detected, flushing text. Length=${this.accumulatedText.length}`);
        this.status = 'active';
        this.emit('statusChange', 'active');
        
        if (this.accumulatedText) {
          this.sendOutput(this.accumulatedText);
          this.accumulatedText = '';
        }
      }
    });

    // Handle session idle
    this.openCodeClient.on('session.idle', ({ sessionID }) => {
      logger.debug(`[SSE] session.idle: sessionID=${sessionID}, accumulatedText.length=${this.accumulatedText.length}`);
      if (sessionID !== this.opencodeSessionId) return;

      this.status = 'active';
      this.emit('statusChange', 'active');

      // Flush any accumulated text
      if (this.accumulatedText) {
        logger.debug(`Flushing accumulated text (${this.accumulatedText.length} chars)`);
        this.sendOutput(this.accumulatedText);
        this.accumulatedText = '';
      }
    });

    // Handle permission requests
    this.openCodeClient.on('permission.updated', (permission) => {
      if (permission.sessionID !== this.opencodeSessionId) return;

      logger.info(`Permission requested: ${permission.id}`);
      this.pendingPermissions.set(permission.id, permission);

      // Format and emit permission request
      const formatted = formatPermissionRequest({
        id: permission.id,
        title: permission.title,
        metadata: permission.metadata,
      });
      this.sendOutput(formatted);
      this.emit('permission', permission);
    });

    // Handle session errors
    this.openCodeClient.on('session.error', ({ sessionID, error }) => {
      if (sessionID && sessionID !== this.opencodeSessionId) return;

      logger.error(`Session error:`, error);
      const errorMessage = error instanceof Error ? error.message : String(error);
      this.sendOutput(` Error: ${errorMessage}`);
      this.emit('error', error instanceof Error ? error : new Error(String(error)));
    });

    // Handle client errors
    this.openCodeClient.on('error', (error) => {
      logger.error(`OpenCode client error:`, error);
      this.emit('error', error);
    });

    // Handle client closed
    this.openCodeClient.on('closed', () => {
      logger.info('OpenCode client closed');
      this.status = 'terminated';
      // Don't emit 'terminated' if we're just switching projects
      if (!this.isSwitchingProject) {
        this.emit('terminated');
      }
    });
  }

  /**
   * Send a message to the OpenCode session
   */
  async sendMessage(message: string): Promise<void> {
    if (!this.openCodeClient || !this.opencodeSessionId) {
      throw new Error('OpenCode session is not running');
    }

    this.status = 'busy';
    this.touch();
    this.accumulatedText = '';

    try {
      // Send message asynchronously (use SSE for response)
      await this.openCodeClient.sendMessageAsync(this.opencodeSessionId, message);
    } catch (error) {
      logger.error('Failed to send message:', error);
      this.status = 'active';
      throw error;
    }
  }

  /**
   * Send a message and wait for the complete response
   */
  async sendMessageSync(message: string): Promise<{ text: string; parts: Part[] }> {
    if (!this.openCodeClient || !this.opencodeSessionId) {
      throw new Error('OpenCode session is not running');
    }

    this.status = 'busy';
    this.touch();

    try {
      const response = await this.openCodeClient.sendMessage(this.opencodeSessionId, message);
      this.status = 'active';
      this.touch();

      const text = formatParts(response.parts);
      return { text, parts: response.parts };
    } catch (error) {
      logger.error('Failed to send message:', error);
      this.status = 'active';
      throw error;
    }
  }

  /**
   * Reply to a permission request
   */
  async replyToPermission(
    permissionId: string,
    response: 'once' | 'always' | 'reject'
  ): Promise<void> {
    if (!this.openCodeClient || !this.opencodeSessionId) {
      throw new Error('OpenCode session is not running');
    }

    const permission = this.pendingPermissions.get(permissionId);
    if (!permission) {
      logger.warn(`Permission ${permissionId} not found in pending permissions`);
    }

    await this.openCodeClient.replyToPermission(this.opencodeSessionId, permissionId, response);
    this.pendingPermissions.delete(permissionId);
    this.touch();
  }

  /**
   * Reply to the most recent permission request
   */
  async replyToLatestPermission(response: 'once' | 'always' | 'reject'): Promise<void> {
    const permissions = Array.from(this.pendingPermissions.values());
    if (permissions.length === 0) {
      throw new Error('No pending permission requests');
    }

    const latest = permissions[permissions.length - 1];
    await this.replyToPermission(latest.id, response);
  }

  /**
   * Send a confirmation response (for backward compatibility)
   * Maps to permission response
   */
  async sendConfirmation(confirm: boolean): Promise<void> {
    try {
      await this.replyToLatestPermission(confirm ? 'once' : 'reject');
    } catch (error) {
      logger.warn('No pending permission to confirm:', error);
    }
    this.touch();
  }

  /**
   * Interrupt the current operation
   */
  async interrupt(): Promise<void> {
    if (!this.openCodeClient || !this.opencodeSessionId) {
      return;
    }

    try {
      await this.openCodeClient.abortSession(this.opencodeSessionId);
      this.status = 'active';
      this.sendOutput(' Operation interrupted');
    } catch (error) {
      logger.error('Failed to abort session:', error);
    }
    this.touch();
  }

  /**
   * Set the callback for receiving output
   */
  onOutput(callback: (data: string) => void): void {
    this.outputCallback = callback;

    // Send any pending output
    for (const output of this.pendingOutput) {
      callback(output);
    }
    this.pendingOutput = [];
  }

  /**
   * Remove the output callback
   */
  offOutput(): void {
    this.outputCallback = null;
  }

  /**
   * Send output to the callback or buffer it
   */
  private sendOutput(data: string): void {
    if (this.outputCallback) {
      this.outputCallback(data);
    } else {
      logger.debug(`No output callback set, buffering output (${data.length} chars)`);
      this.pendingOutput.push(data);
    }
  }

  /**
   * Switch to a different project directory
   */
  async switchProject(newProjectPath: string): Promise<void> {
    // Set flag to prevent 'terminated' event from being emitted
    this.isSwitchingProject = true;

    try {
      // Terminate current session
      await this.terminate();

      // Update project path
      this.projectPath = newProjectPath;
      this.status = 'idle';

      // Start a new session
      await this.start();
      this.touch();
    } finally {
      this.isSwitchingProject = false;
    }
  }

  /**
   * Update last activity timestamp
   */
  touch(): void {
    this.lastActivity = new Date();
  }

  /**
   * Check if session has timed out
   */
  isTimedOut(): boolean {
    const timeout = this.timeoutMinutes * 60 * 1000;
    return Date.now() - this.lastActivity.getTime() > timeout;
  }

  /**
   * Get session status
   */
  getStatus(): SessionStatus {
    return this.status;
  }

  /**
   * Check if session is running
   */
  isRunning(): boolean {
    return (
      this.openCodeClient !== null &&
      this.openCodeClient.ready &&
      this.status !== 'terminated' &&
      this.status !== 'idle'
    );
  }

  /**
   * Get the OpenCode session ID
   */
  getOpencodeSessionId(): string | null {
    return this.opencodeSessionId;
  }

  /**
   * Get pending permissions
   */
  getPendingPermissions(): Permission[] {
    return Array.from(this.pendingPermissions.values());
  }

  /**
   * Get serializable session data
   */
  toJSON(): SessionData {
    return {
      id: this.id,
      chatId: this.chatId,
      userId: this.userId,
      projectPath: this.projectPath,
      createdAt: this.createdAt,
      lastActivity: this.lastActivity,
      opencodeSessionId: this.opencodeSessionId || undefined,
    };
  }

  /**
   * Terminate the session
   */
  async terminate(): Promise<void> {
    logger.info(`Terminating session ${this.id}`);

    if (this.openCodeClient) {
      // Try to delete the OpenCode session
      if (this.opencodeSessionId) {
        try {
          await this.openCodeClient.deleteSession(this.opencodeSessionId);
        } catch (error) {
          logger.warn(`Failed to delete OpenCode session:`, error);
        }
      }

      // Close the client
      await this.openCodeClient.close();
      this.openCodeClient = null;
    }

    this.opencodeSessionId = null;
    this.status = 'terminated';
    this.pendingPermissions.clear();

    // Don't clear output callback if we're switching projects (need to keep it)
    if (!this.isSwitchingProject) {
      this.offOutput();
      this.emit('terminated');
    }
  }
}
