import { v4 as uuidv4 } from 'uuid';
import { PtyHandler } from '../pty/PtyHandler.js';
import { logger } from '../utils/logger.js';
import config from '../config/index.js';

export interface SessionData {
  id: string;
  chatId: string;
  userId: string;
  projectPath: string;
  createdAt: Date;
  lastActivity: Date;
}

export type SessionStatus = 'idle' | 'active' | 'busy' | 'terminated';

/**
 * Represents a single OpenCode session tied to a chat user
 */
export class Session {
  public readonly id: string;
  public readonly chatId: string;
  public readonly userId: string;
  public projectPath: string;
  public readonly createdAt: Date;
  public lastActivity: Date;

  private ptyHandler: PtyHandler;
  private status: SessionStatus = 'idle';
  private outputCallback: ((data: string) => void) | null = null;
  private pendingOutput: string[] = [];

  constructor(chatId: string, userId: string, projectPath: string) {
    this.id = uuidv4();
    this.chatId = chatId;
    this.userId = userId;
    this.projectPath = projectPath;
    this.createdAt = new Date();
    this.lastActivity = new Date();

    this.ptyHandler = new PtyHandler();
    this.setupHandlers();

    logger.info(`Session created: ${this.id} for user ${userId} at ${projectPath}`);
  }

  /**
   * Set up event handlers for the PTY process
   */
  private setupHandlers(): void {
    this.ptyHandler.on('data', (data: string) => {
      if (this.outputCallback) {
        this.outputCallback(data);
      } else {
        this.pendingOutput.push(data);
      }
    });

    this.ptyHandler.on('exit', (code: number) => {
      logger.info(`Session ${this.id} process exited with code ${code}`);
      this.status = 'terminated';
    });

    this.ptyHandler.on('error', (error: Error) => {
      logger.error(`Session ${this.id} error:`, error);
    });
  }

  /**
   * Start the OpenCode process
   */
  start(): void {
    if (this.status !== 'idle') {
      throw new Error(`Session is ${this.status}, cannot start`);
    }

    this.ptyHandler.spawn({
      command: config.opencodeCommand,
      cwd: this.projectPath,
    });

    this.status = 'active';
    this.touch();
  }

  /**
   * Send a message to the OpenCode process
   */
  sendMessage(message: string): void {
    if (!this.ptyHandler.isRunning()) {
      throw new Error('OpenCode process is not running');
    }

    this.ptyHandler.writeLine(message);
    this.status = 'busy';
    this.touch();
  }

  /**
   * Send a confirmation response (y/n)
   */
  sendConfirmation(confirm: boolean): void {
    this.ptyHandler.writeLine(confirm ? 'y' : 'n');
    this.touch();
  }

  /**
   * Interrupt the current operation (Ctrl+C)
   */
  interrupt(): void {
    this.ptyHandler.interrupt();
    this.status = 'active';
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
   * Switch to a different project directory
   */
  switchProject(newProjectPath: string): void {
    if (this.ptyHandler.isRunning()) {
      // Exit current OpenCode session
      this.ptyHandler.writeLine('/exit');
      // Give it a moment, then kill if needed
      setTimeout(() => {
        if (this.ptyHandler.isRunning()) {
          this.ptyHandler.kill();
        }

        this.projectPath = newProjectPath;
        this.status = 'idle';
        this.start();
      }, 500);
    } else {
      this.projectPath = newProjectPath;
      this.status = 'idle';
      this.start();
    }

    this.touch();
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
    const timeout = config.sessionTimeoutMinutes * 60 * 1000;
    return Date.now() - this.lastActivity.getTime() > timeout;
  }

  /**
   * Get session status
   */
  getStatus(): SessionStatus {
    return this.status;
  }

  /**
   * Check if PTY process is running
   */
  isRunning(): boolean {
    return this.ptyHandler.isRunning();
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
    };
  }

  /**
   * Terminate the session
   */
  terminate(): void {
    logger.info(`Terminating session ${this.id}`);

    if (this.ptyHandler.isRunning()) {
      this.ptyHandler.kill();
    }

    this.status = 'terminated';
    this.offOutput();
  }
}