import { logger } from '@/utils/logger.js';
import { sessionManager } from '@/sessions/SessionManager.js';
import config from '@/config';
import type { Session } from '@/sessions/Session.js';
import type { AgentTask, AgentResult } from './types.js';

/**
 * Agent Pool
 * Manages a pool of OpenCode agents (sessions) for concurrent task execution
 */
export class AgentPool {
  private maxAgents: number;
  private activeAgents: Map<string, Session> = new Map();

  constructor(maxAgents: number = 5) {
    this.maxAgents = maxAgents;
    logger.info(`Agent pool initialized with max ${maxAgents} agents`);
  }

  /**
   * Execute a task using an agent from the pool
   */
  async executeTask(task: AgentTask, executionId: string): Promise<AgentResult> {
    const startTime = new Date();
    const agentId = `${executionId}-${task.id}`;

    logger.info(`Executing task: ${task.name} (${task.id})`);

    try {
      // Check if we're at capacity
      if (this.activeAgents.size >= this.maxAgents) {
        logger.warn(`Agent pool at capacity (${this.maxAgents}), waiting...`);
        await this.waitForAvailableSlot();
      }

      // Get or create a session for this agent
      const session = await this.acquireAgent(agentId, task.projectPath);
      this.activeAgents.set(agentId, session);

      // Execute the task
      const output = await this.runTask(session, task);

      const endTime = new Date();
      const duration = endTime.getTime() - startTime.getTime();

      const result: AgentResult = {
        taskId: task.id,
        status: 'success',
        output,
        startTime,
        endTime,
        duration,
      };

      logger.info(`Task completed: ${task.name} (${duration}ms)`);
      return result;
    } catch (error) {
      const endTime = new Date();
      const duration = endTime.getTime() - startTime.getTime();

      const result: AgentResult = {
        taskId: task.id,
        status: 'failure',
        output: '',
        error: error instanceof Error ? error.message : 'Unknown error',
        startTime,
        endTime,
        duration,
      };

      logger.error(`Task failed: ${task.name}`, error);
      return result;
    } finally {
      // Release the agent
      await this.releaseAgent(agentId);
    }
  }

  /**
   * Acquire an agent (session) from the pool
   */
  private async acquireAgent(agentId: string, projectPath?: string): Promise<Session> {
    const path = projectPath || config.projectsDir;

    logger.debug(`Acquiring agent: ${agentId} for path ${path}`);

    // Create a new session for this agent
    // Use a special user ID to identify workflow agents
    const session = sessionManager.getOrCreate(agentId, 'workflow-agent', path);

    // Start the session if not already running
    if (!session.isRunning()) {
      await session.start();
    }

    return session;
  }

  /**
   * Release an agent back to the pool
   */
  private async releaseAgent(agentId: string): Promise<void> {
    const session = this.activeAgents.get(agentId);
    if (!session) {
      return;
    }

    logger.debug(`Releasing agent: ${agentId}`);

    // Clear the session
    await sessionManager.clear(agentId);
    this.activeAgents.delete(agentId);
  }

  /**
   * Run a task on a session
   */
  private async runTask(session: Session, task: AgentTask): Promise<string> {
    return new Promise((resolve, reject) => {
      let output = '';
      let hasError = false;

      // Set up timeout
      const timeout = task.timeout
        ? task.timeout * 60 * 1000
        : config.workflowTimeoutMinutes * 60 * 1000;

      const timer = setTimeout(() => {
        hasError = true;
        reject(new Error(`Task timeout after ${timeout}ms`));
      }, timeout);

      // Listen for output
      const outputHandler = (data: string) => {
        output += data;
      };

      // Listen for streaming text
      const streamingHandler = (text: string) => {
        output += text;
      };

      // Listen for errors
      const errorHandler = (error: Error) => {
        if (!hasError) {
          hasError = true;
          clearTimeout(timer);
          cleanup();
          reject(error);
        }
      };

      // Listen for status changes
      const statusHandler = (status: string) => {
        // When session becomes idle, task is complete
        if (status === 'idle' && !hasError) {
          clearTimeout(timer);
          cleanup();
          resolve(output);
        }
      };

      const cleanup = () => {
        session.off('output', outputHandler);
        session.off('streaming', streamingHandler);
        session.off('error', errorHandler);
        session.off('statusChange', statusHandler);
      };

      session.on('output', outputHandler);
      session.on('streaming', streamingHandler);
      session.on('error', errorHandler);
      session.on('statusChange', statusHandler);

      // Send the task prompt
      session.sendMessage(task.prompt).catch((error) => {
        if (!hasError) {
          hasError = true;
          clearTimeout(timer);
          cleanup();
          reject(error);
        }
      });
    });
  }

  /**
   * Wait for an available agent slot
   */
  private async waitForAvailableSlot(): Promise<void> {
    const pollInterval = 1000; // Check every second
    const maxWait = 60000; // Wait up to 1 minute
    const startTime = Date.now();

    while (this.activeAgents.size >= this.maxAgents) {
      if (Date.now() - startTime > maxWait) {
        throw new Error('Timeout waiting for available agent slot');
      }
      await new Promise((resolve) => setTimeout(resolve, pollInterval));
    }
  }

  /**
   * Get current pool status
   */
  getStatus(): { active: number; max: number; available: number } {
    return {
      active: this.activeAgents.size,
      max: this.maxAgents,
      available: this.maxAgents - this.activeAgents.size,
    };
  }

  /**
   * Shutdown all agents
   */
  async shutdown(): Promise<void> {
    logger.info('Shutting down agent pool...');

    const agents = Array.from(this.activeAgents.keys());
    for (const agentId of agents) {
      await this.releaseAgent(agentId);
    }

    logger.info('Agent pool shutdown complete');
  }
}
