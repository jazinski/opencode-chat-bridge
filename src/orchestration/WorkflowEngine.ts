import { EventEmitter } from 'events';
import { v4 as uuidv4 } from 'uuid';
import { logger } from '@/utils/logger.js';
import { AgentPool } from './AgentPool.js';
import config from '@/config';
import type {
  WorkflowDefinition,
  WorkflowExecution,
  WorkflowTrigger,
  WorkflowStatus,
  WorkflowEvent,
  AgentResult,
  ExecutionStrategy,
} from './types.js';

/**
 * Workflow Engine
 * Orchestrates multi-agent workflows with different execution strategies
 */
export class WorkflowEngine extends EventEmitter {
  private agentPool: AgentPool;
  private executions: Map<string, WorkflowExecution> = new Map();
  private workflows: Map<string, WorkflowDefinition> = new Map();

  constructor() {
    super();
    this.agentPool = new AgentPool(config.workflowMaxAgents);
  }

  /**
   * Register a workflow definition
   */
  registerWorkflow(workflow: WorkflowDefinition): void {
    this.workflows.set(workflow.id, workflow);
    logger.info(`Registered workflow: ${workflow.name} (${workflow.id})`);
  }

  /**
   * Execute a workflow
   */
  async executeWorkflow(workflowId: string, trigger: WorkflowTrigger): Promise<WorkflowExecution> {
    const workflow = this.workflows.get(workflowId);
    if (!workflow) {
      throw new Error(`Workflow not found: ${workflowId}`);
    }

    const executionId = uuidv4();
    const execution: WorkflowExecution = {
      id: executionId,
      workflowId,
      status: 'pending' as WorkflowStatus,
      trigger,
      startTime: new Date(),
      results: [],
    };

    this.executions.set(executionId, execution);
    this.emitEvent(executionId, 'workflow.started', { workflow: workflow.name });

    logger.info(`Starting workflow execution: ${executionId} (${workflow.name})`);

    try {
      // Update status to running
      execution.status = 'running' as WorkflowStatus;

      // Execute based on strategy
      const results = await this.executeStrategy(workflow, executionId);
      execution.results = results;

      // Run synthesis if configured
      if (workflow.synthesisPrompt && results.length > 0) {
        execution.finalOutput = await this.synthesizeResults(
          workflow.synthesisPrompt,
          results,
          executionId
        );
      }

      // Mark as completed
      execution.status = 'completed' as WorkflowStatus;
      execution.endTime = new Date();
      execution.duration = execution.endTime.getTime() - execution.startTime.getTime();

      this.emitEvent(executionId, 'workflow.completed', {
        duration: execution.duration,
        taskCount: results.length,
      });

      logger.info(`Workflow completed: ${executionId} (${execution.duration}ms)`);
    } catch (error) {
      execution.status = 'failed' as WorkflowStatus;
      execution.error = error instanceof Error ? error.message : 'Unknown error';
      execution.endTime = new Date();
      execution.duration = execution.endTime.getTime() - execution.startTime.getTime();

      this.emitEvent(executionId, 'workflow.failed', { error: execution.error });
      logger.error(`Workflow failed: ${executionId}`, error);
    }

    return execution;
  }

  /**
   * Execute workflow based on strategy
   */
  private async executeStrategy(
    workflow: WorkflowDefinition,
    executionId: string
  ): Promise<AgentResult[]> {
    switch (workflow.strategy) {
      case 'sequential' as ExecutionStrategy:
        return this.executeSequential(workflow, executionId);
      case 'parallel' as ExecutionStrategy:
        return this.executeParallel(workflow, executionId);
      case 'hierarchical' as ExecutionStrategy:
        return this.executeHierarchical(workflow, executionId);
      default:
        throw new Error(`Unsupported execution strategy: ${workflow.strategy}`);
    }
  }

  /**
   * Execute tasks sequentially (A → B → C)
   */
  private async executeSequential(
    workflow: WorkflowDefinition,
    executionId: string
  ): Promise<AgentResult[]> {
    const results: AgentResult[] = [];

    for (const task of workflow.tasks) {
      logger.info(`Starting sequential task: ${task.name} (${task.id})`);
      this.emitEvent(executionId, 'task.started', { taskId: task.id, taskName: task.name });

      try {
        const result = await this.agentPool.executeTask(task, executionId);
        results.push(result);

        this.emitEvent(executionId, 'task.completed', {
          taskId: task.id,
          duration: result.duration,
        });

        // If task failed, stop execution (fail-fast for sequential)
        if (result.status === 'failure') {
          throw new Error(`Task ${task.name} failed: ${result.error}`);
        }
      } catch (error) {
        const errorResult: AgentResult = {
          taskId: task.id,
          status: 'failure',
          output: '',
          error: error instanceof Error ? error.message : 'Unknown error',
          startTime: new Date(),
          endTime: new Date(),
          duration: 0,
        };
        results.push(errorResult);
        this.emitEvent(executionId, 'task.failed', { taskId: task.id, error: errorResult.error });
        throw error;
      }
    }

    return results;
  }

  /**
   * Execute tasks in parallel (A || B || C)
   */
  private async executeParallel(
    workflow: WorkflowDefinition,
    executionId: string
  ): Promise<AgentResult[]> {
    logger.info(`Starting parallel execution of ${workflow.tasks.length} tasks`);

    const promises = workflow.tasks.map(async (task) => {
      this.emitEvent(executionId, 'task.started', { taskId: task.id, taskName: task.name });

      try {
        const result = await this.agentPool.executeTask(task, executionId);
        this.emitEvent(executionId, 'task.completed', {
          taskId: task.id,
          duration: result.duration,
        });
        return result;
      } catch (error) {
        const errorResult: AgentResult = {
          taskId: task.id,
          status: 'failure',
          output: '',
          error: error instanceof Error ? error.message : 'Unknown error',
          startTime: new Date(),
          endTime: new Date(),
          duration: 0,
        };
        this.emitEvent(executionId, 'task.failed', { taskId: task.id, error: errorResult.error });
        return errorResult;
      }
    });

    // Wait for all tasks to complete (don't fail-fast)
    return Promise.all(promises);
  }

  /**
   * Execute tasks hierarchically (Manager delegates to workers)
   * TODO: Implement dynamic task delegation based on manager agent decisions
   */
  private async executeHierarchical(
    workflow: WorkflowDefinition,
    executionId: string
  ): Promise<AgentResult[]> {
    logger.warn('Hierarchical execution not yet implemented, falling back to sequential');
    return this.executeSequential(workflow, executionId);
  }

  /**
   * Synthesize results from multiple agents
   */
  private async synthesizeResults(
    synthesisPrompt: string,
    results: AgentResult[],
    executionId: string
  ): Promise<string> {
    logger.info('Synthesizing results from agents');

    // Build context from all agent results
    const context = results
      .map(
        (r, i) =>
          `## Agent ${i + 1} Output (${r.taskId}):\n${r.status === 'success' ? r.output : `FAILED: ${r.error}`}\n`
      )
      .join('\n---\n\n');

    const fullPrompt = `${synthesisPrompt}\n\n${context}`;

    // Use agent pool to run synthesis task
    const synthesisTask = {
      id: 'synthesis',
      name: 'Result Synthesis',
      prompt: fullPrompt,
    };

    const result = await this.agentPool.executeTask(synthesisTask, executionId);
    return result.output;
  }

  /**
   * Get workflow execution status
   */
  getExecution(executionId: string): WorkflowExecution | undefined {
    return this.executions.get(executionId);
  }

  /**
   * List all executions
   */
  listExecutions(): WorkflowExecution[] {
    return Array.from(this.executions.values());
  }

  /**
   * Cancel a running workflow
   */
  async cancelWorkflow(executionId: string): Promise<boolean> {
    const execution = this.executions.get(executionId);
    if (!execution) {
      return false;
    }

    if (execution.status !== 'running') {
      return false;
    }

    execution.status = 'cancelled' as WorkflowStatus;
    execution.endTime = new Date();
    execution.duration = execution.endTime.getTime() - execution.startTime.getTime();

    this.emitEvent(executionId, 'workflow.cancelled', {});
    logger.info(`Workflow cancelled: ${executionId}`);

    return true;
  }

  /**
   * Emit workflow event
   */
  private emitEvent(executionId: string, type: WorkflowEvent['type'], data?: any): void {
    const event: WorkflowEvent = {
      executionId,
      timestamp: new Date(),
      type,
      data,
    };

    this.emit('event', event);
    logger.debug(`Workflow event: ${type}`, { executionId, data });
  }

  /**
   * Cleanup old executions
   */
  cleanup(maxAge: number = 24 * 60 * 60 * 1000): void {
    const now = Date.now();
    let cleaned = 0;

    for (const [id, execution] of this.executions.entries()) {
      if (execution.endTime && now - execution.endTime.getTime() > maxAge) {
        this.executions.delete(id);
        cleaned++;
      }
    }

    if (cleaned > 0) {
      logger.info(`Cleaned up ${cleaned} old workflow executions`);
    }
  }
}

// Singleton instance
export const workflowEngine = new WorkflowEngine();
