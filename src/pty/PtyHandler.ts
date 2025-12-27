import * as pty from 'node-pty';
import { EventEmitter } from 'events';
import { logger } from '@/utils/logger.js';
import { cleanOutput } from '@/utils/outputParser.js';

export interface PtyOptions {
  command: string;
  args?: string[];
  cwd: string;
  env?: Record<string, string>;
  cols?: number;
  rows?: number;
}

export interface PtyEvents {
  data: (data: string) => void;
  exit: (code: number, signal?: number) => void;
  error: (error: Error) => void;
}

/**
 * Handles PTY (pseudo-terminal) processes for OpenCode
 * Provides full terminal emulation for interactive CLI sessions
 */
export class PtyHandler extends EventEmitter {
  private process: pty.IPty | null = null;
  private outputBuffer: string = '';
  private outputTimeout: NodeJS.Timeout | null = null;
  private readonly bufferDelay: number = 100; // ms to wait before flushing output

  constructor() {
    super();
  }

  /**
   * Spawn a new PTY process
   */
  spawn(options: PtyOptions): void {
    if (this.process) {
      throw new Error('Process already running. Call kill() first.');
    }

    logger.info(`Spawning PTY: ${options.command} in ${options.cwd}`);

    try {
      this.process = pty.spawn(options.command, options.args || [], {
        name: 'xterm-256color',
        cols: options.cols || 120,
        rows: options.rows || 30,
        cwd: options.cwd,
        env: {
          ...process.env,
          ...options.env,
          TERM: 'xterm-256color',
          COLORTERM: 'truecolor',
        } as Record<string, string>,
      });

      this.process.onData((data) => {
        this.handleOutput(data);
      });

      this.process.onExit(({ exitCode, signal }) => {
        logger.info(`PTY process exited: code=${exitCode}, signal=${signal}`);
        this.process = null;
        this.flushBuffer();
        this.emit('exit', exitCode, signal);
      });

      logger.info(`PTY spawned with PID: ${this.process.pid}`);
    } catch (error) {
      logger.error('Failed to spawn PTY process:', error);
      this.emit('error', error instanceof Error ? error : new Error(String(error)));
      throw error;
    }
  }

  /**
   * Handle incoming output from the PTY
   * Buffers output to avoid sending too many small chunks
   */
  private handleOutput(data: string): void {
    this.outputBuffer += data;

    // Reset the flush timer
    if (this.outputTimeout) {
      clearTimeout(this.outputTimeout);
    }

    // Wait a bit for more output, then flush
    this.outputTimeout = setTimeout(() => {
      this.flushBuffer();
    }, this.bufferDelay);
  }

  /**
   * Flush the output buffer
   */
  private flushBuffer(): void {
    if (this.outputTimeout) {
      clearTimeout(this.outputTimeout);
      this.outputTimeout = null;
    }

    if (this.outputBuffer) {
      const cleaned = cleanOutput(this.outputBuffer);
      if (cleaned) {
        this.emit('data', cleaned);
      }
      this.outputBuffer = '';
    }
  }

  /**
   * Write input to the PTY process
   */
  write(data: string): void {
    if (!this.process) {
      throw new Error('No process running');
    }

    // Flush any pending output first
    this.flushBuffer();

    logger.debug(`Writing to PTY: ${data.replace(/\n/g, '\\n')}`);
    this.process.write(data);
  }

  /**
   * Send a line of text (adds newline)
   */
  writeLine(text: string): void {
    this.write(text + '\r');
  }

  /**
   * Resize the terminal
   */
  resize(cols: number, rows: number): void {
    if (this.process) {
      this.process.resize(cols, rows);
      logger.debug(`Resized PTY to ${cols}x${rows}`);
    }
  }

  /**
   * Kill the PTY process
   */
  kill(signal: string = 'SIGTERM'): void {
    if (this.process) {
      logger.info(`Killing PTY process with ${signal}`);
      this.process.kill(signal);
      this.process = null;
    }

    this.flushBuffer();
  }

  /**
   * Check if process is running
   */
  isRunning(): boolean {
    return this.process !== null;
  }

  /**
   * Get the process PID
   */
  getPid(): number | undefined {
    return this.process?.pid;
  }

  /**
   * Send interrupt signal (Ctrl+C)
   */
  interrupt(): void {
    if (this.process) {
      this.write('\x03'); // Ctrl+C
    }
  }

  /**
   * Send EOF (Ctrl+D)
   */
  sendEof(): void {
    if (this.process) {
      this.write('\x04'); // Ctrl+D
    }
  }
}
