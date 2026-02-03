/**
 * Workflow orchestration types
 */

import type { MentionContext } from '@/webhooks/types.js';

/**
 * Workflow execution status
 */
export enum WorkflowStatus {
  PENDING = 'pending',
  RUNNING = 'running',
  COMPLETED = 'completed',
  FAILED = 'failed',
  CANCELLED = 'cancelled',
  TIMEOUT = 'timeout',
}

/**
 * Agent execution strategy
 */
export enum ExecutionStrategy {
  SEQUENTIAL = 'sequential', // A → B → C
  PARALLEL = 'parallel', // A || B || C → merge
  HIERARCHICAL = 'hierarchical', // Manager → Workers
}

/**
 * Individual agent task configuration
 */
export interface AgentTask {
  id: string;
  name: string;
  prompt: string; // What to ask this agent
  projectPath?: string; // Optional: specific project to use
  timeout?: number; // Task-specific timeout in minutes
  dependencies?: string[]; // IDs of tasks that must complete first
}

/**
 * Workflow definition
 */
export interface WorkflowDefinition {
  id: string;
  name: string;
  description: string;
  strategy: ExecutionStrategy;
  tasks: AgentTask[];
  synthesisPrompt?: string; // Prompt for final synthesis agent (optional)
  timeout?: number; // Total workflow timeout in minutes
}

/**
 * Agent execution result
 */
export interface AgentResult {
  taskId: string;
  status: 'success' | 'failure' | 'timeout';
  output: string;
  error?: string;
  startTime: Date;
  endTime: Date;
  duration: number; // milliseconds
}

/**
 * Workflow execution state
 */
export interface WorkflowExecution {
  id: string;
  workflowId: string;
  status: WorkflowStatus;
  trigger: WorkflowTrigger;
  startTime: Date;
  endTime?: Date;
  duration?: number; // milliseconds
  results: AgentResult[];
  finalOutput?: string; // Synthesized result
  error?: string;
}

/**
 * What triggered this workflow
 */
export interface WorkflowTrigger {
  type: 'webhook' | 'api' | 'manual';
  source: string; // e.g., 'azure-devops', 'slack', 'api'
  context: MentionContext | Record<string, any>;
  timestamp: Date;
}

/**
 * Workflow event for observability
 */
export interface WorkflowEvent {
  executionId: string;
  timestamp: Date;
  type:
    | 'workflow.started'
    | 'workflow.completed'
    | 'workflow.failed'
    | 'workflow.cancelled'
    | 'task.started'
    | 'task.completed'
    | 'task.failed';
  data?: any;
}
