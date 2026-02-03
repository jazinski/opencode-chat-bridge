#!/usr/bin/env tsx
/**
 * Test script to verify workflow engine works independently of Azure DevOps
 *
 * This script:
 * 1. Initializes the workflow engine
 * 2. Runs a simple workflow
 * 3. Verifies the workflow completes successfully
 * 4. Reports results
 */

import { WorkflowEngine } from './src/orchestration/WorkflowEngine.js';
import type { WorkflowDefinition, WorkflowTrigger } from './src/orchestration/types.js';
import { ExecutionStrategy } from './src/orchestration/types.js';
import { logger } from './src/utils/logger.js';
import dotenv from 'dotenv';

// Load environment variables
dotenv.config();

// Create a simple test workflow
const testWorkflow: WorkflowDefinition = {
  id: 'test-workflow',
  name: 'Simple Test Workflow',
  description: 'A simple workflow to test the workflow engine',
  strategy: ExecutionStrategy.SEQUENTIAL,
  timeout: 5, // 5 minutes
  tasks: [
    {
      id: 'task-1',
      name: 'Simple Echo Test',
      prompt: `You are a test agent. Please respond with exactly:
      
TEST SUCCESSFUL: I can receive and process prompts.

Then list these three things:
1. Current date/time
2. Your model name
3. A random number between 1 and 100`,
      timeout: 2,
    },
  ],
};

async function main() {
  console.log('\n=================================');
  console.log('🧪 Workflow Engine Test');
  console.log('=================================\n');

  try {
    // Initialize workflow engine
    console.log('1️⃣  Initializing workflow engine...');
    const workflowEngine = new WorkflowEngine();

    // Register test workflow
    console.log('2️⃣  Registering test workflow...');
    workflowEngine.registerWorkflow(testWorkflow);

    // Set up event listeners
    console.log('3️⃣  Setting up event listeners...');
    workflowEngine.on('workflow.started', (event) => {
      console.log(`   ✅ Event: workflow.started - ${JSON.stringify(event)}`);
    });

    workflowEngine.on('task.started', (event) => {
      console.log(`   ✅ Event: task.started - ${JSON.stringify(event)}`);
    });

    workflowEngine.on('task.completed', (event) => {
      console.log(`   ✅ Event: task.completed - ${JSON.stringify(event)}`);
    });

    workflowEngine.on('workflow.completed', (event) => {
      console.log(`   ✅ Event: workflow.completed - ${JSON.stringify(event)}`);
    });

    workflowEngine.on('workflow.failed', (event) => {
      console.log(`   ❌ Event: workflow.failed - ${JSON.stringify(event)}`);
    });

    // Create trigger
    const trigger: WorkflowTrigger = {
      type: 'manual',
      source: 'test-script',
      context: {
        testRun: true,
      },
      timestamp: new Date(),
    };

    // Execute workflow
    console.log('4️⃣  Executing workflow...\n');
    const startTime = Date.now();
    const execution = await workflowEngine.executeWorkflow('test-workflow', trigger);
    const duration = Date.now() - startTime;

    // Display results
    console.log('\n=================================');
    console.log('📊 Test Results');
    console.log('=================================\n');

    console.log(`Execution ID: ${execution.id}`);
    console.log(`Status: ${execution.status}`);
    console.log(`Duration: ${duration}ms (${(duration / 1000).toFixed(2)}s)`);
    console.log(`Tasks completed: ${execution.results?.length || 0}`);

    if (execution.error) {
      console.log(`\n❌ Error: ${execution.error}`);
    }

    if (execution.results && execution.results.length > 0) {
      console.log('\n📝 Task Results:\n');
      execution.results.forEach((result, index) => {
        console.log(`Task ${index + 1}: ${result.taskId}`);
        console.log(`Status: ${result.status}`);
        if (result.output) {
          console.log(
            `Output:\n${result.output.substring(0, 500)}${result.output.length > 500 ? '...' : ''}`
          );
        }
        if (result.error) {
          console.log(`Error: ${result.error}`);
        }
        console.log('---');
      });
    }

    if (execution.finalOutput) {
      console.log('\n🎯 Final Synthesis Output:\n');
      console.log(execution.finalOutput);
    }

    // Determine overall test result
    console.log('\n=================================');
    if (execution.status === 'completed') {
      console.log('✅ TEST PASSED: Workflow executed successfully!');
      console.log('=================================\n');
      process.exit(0);
    } else {
      console.log('❌ TEST FAILED: Workflow did not complete successfully');
      console.log('=================================\n');
      process.exit(1);
    }
  } catch (error) {
    console.error('\n=================================');
    console.error('❌ TEST FAILED WITH EXCEPTION');
    console.error('=================================\n');
    console.error(error);
    process.exit(1);
  }
}

// Run the test
main().catch((error) => {
  console.error('Fatal error:', error);
  process.exit(1);
});
