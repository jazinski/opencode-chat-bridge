import express, { Request, Response, NextFunction } from 'express';
import { logger } from '@/utils/logger.js';
import config from '@/config';
import { AzureDevOpsHandler } from './handlers/AzureDevOpsHandler.js';
import { workflowEngine } from '@/orchestration/WorkflowEngine.js';
import { getWorkflowForIntent, customizeWorkflow } from '@/orchestration/workflows/examples.js';
import type { AzureDevOpsWebhookPayload, WebhookValidation } from './types.js';
import type { WorkflowTrigger } from '@/orchestration/types.js';
import { azureDevOpsClient } from './AzureDevOpsApiClient.js';

const router = express.Router();

/**
 * Validate Azure DevOps webhook request
 */
function validateAzureDevOpsWebhook(req: Request): WebhookValidation {
  // Check if webhook secret is configured
  if (!config.azureDevOpsWebhookSecret) {
    logger.warn('AZURE_DEVOPS_WEBHOOK_SECRET not configured, skipping validation');
    return { valid: true };
  }

  // Basic authentication check (Azure DevOps sends credentials in Authorization header)
  const authHeader = req.headers.authorization;
  if (!authHeader) {
    return { valid: false, error: 'Missing Authorization header' };
  }

  // Extract Basic auth credentials
  const [authType, credentials] = authHeader.split(' ');
  if (authType !== 'Basic' || !credentials) {
    return { valid: false, error: 'Invalid Authorization header format' };
  }

  // Decode base64 credentials
  const decoded = Buffer.from(credentials, 'base64').toString('utf-8');
  const [, password] = decoded.split(':'); // Username can be anything

  // Verify password matches our webhook secret
  if (password !== config.azureDevOpsWebhookSecret) {
    return { valid: false, error: 'Invalid webhook secret' };
  }

  // Optional: IP whitelist check
  if (config.azureDevOpsAllowedIps.length > 0) {
    const clientIp =
      (req.headers['x-forwarded-for'] as string)?.split(',')[0] || req.ip || 'unknown';
    if (!config.azureDevOpsAllowedIps.includes(clientIp)) {
      return {
        valid: false,
        error: `IP ${clientIp} not in whitelist`,
        ipAddress: clientIp,
      };
    }
  }

  return { valid: true };
}

/**
 * Middleware to validate and parse Azure DevOps webhooks
 */
function validateWebhook(req: Request, res: Response, next: NextFunction): void {
  const validation = validateAzureDevOpsWebhook(req);

  if (!validation.valid) {
    logger.warn(`Webhook validation failed: ${validation.error}`, {
      ip: validation.ipAddress || req.ip,
      headers: req.headers,
    });
    res.status(401).json({ error: 'Unauthorized', message: validation.error });
    return;
  }

  // Validate payload structure
  if (!AzureDevOpsHandler.validatePayload(req.body)) {
    logger.warn('Invalid webhook payload structure', { body: req.body });
    res.status(400).json({ error: 'Invalid payload' });
    return;
  }

  next();
}

/**
 * Azure DevOps webhook endpoint
 * POST /webhooks/azure-devops
 */
router.post('/azure-devops', validateWebhook, async (req: Request, res: Response) => {
  const payload = req.body as AzureDevOpsWebhookPayload;

  logger.info(`Received Azure DevOps webhook: ${payload.eventType}`, {
    eventType: payload.eventType,
    resourceId: payload.eventType.startsWith('workitem') ? (payload.resource as any).id : undefined,
    projectName: payload.resourceContainers?.project?.id,
  });

  // Quick response to Azure DevOps (don't make them wait)
  res.status(200).json({ message: 'Webhook received' });

  // Process webhook asynchronously
  try {
    await processWebhook(payload);
  } catch (error) {
    logger.error('Failed to process webhook:', error);
    // Don't propagate error to Azure DevOps since we already responded
  }
});

/**
 * Process webhook payload asynchronously
 */
async function processWebhook(payload: AzureDevOpsWebhookPayload): Promise<void> {
  // Log payload for debugging
  logger.debug('Processing webhook payload');

  // Save full payload to file for inspection (temporary for debugging)
  try {
    const fs = await import('fs/promises');
    await fs.writeFile(
      '/tmp/azure-webhook-payload.json',
      JSON.stringify(payload, null, 2),
      'utf-8'
    );
    logger.debug('Saved webhook payload to /tmp/azure-webhook-payload.json');
  } catch (err) {
    logger.warn('Failed to save webhook payload', err);
  }

  // Check if this webhook contains a bot mention
  if (!AzureDevOpsHandler.hasBotMention(payload)) {
    logger.debug('No bot mention found, ignoring webhook');
    return;
  }

  // Parse mention context
  const mentionContext = AzureDevOpsHandler.parseMentionContext(payload);
  if (!mentionContext) {
    logger.warn('Failed to parse mention context');
    return;
  }

  logger.info(`Bot mentioned in work item ${mentionContext.workItemId}`, {
    workItemId: mentionContext.workItemId,
    intent: mentionContext.intent,
    mentionedBy:
      typeof mentionContext.mentionedBy === 'string'
        ? mentionContext.mentionedBy
        : mentionContext.mentionedBy.displayName,
  });

  // If no intent provided, respond with help message
  if (!mentionContext.intent) {
    logger.info('No intent provided, sending help message');

    const helpMessage = `👋 Hello! I'm ${config.azureDevOpsBotName}, your AI workflow assistant.

**Available workflows:**
- \`research [topic]\` - Multi-agent research with cross-referencing
- \`review\` or \`code review\` - Multi-perspective code review
- \`bug\` or \`issue\` or \`fix\` - Systematic bug investigation
- \`accessibility\` or \`a11y\` or \`wcag\` - WCAG compliance scan

**Example:** \`${config.azureDevOpsBotName} research authentication best practices\`

Just mention me with a command to get started!`;

    await azureDevOpsClient.addWorkItemComment(
      mentionContext.projectName,
      mentionContext.workItemId,
      helpMessage
    );
    return;
  }

  // Find matching workflow based on intent
  const workflow = getWorkflowForIntent(mentionContext.intent);
  if (!workflow) {
    logger.warn(`No workflow found for intent: "${mentionContext.intent}"`);

    const notFoundMessage = `❌ I couldn't find a workflow for: "${mentionContext.intent}"

**Available workflows:**
- \`research\` - Multi-agent research
- \`review\` - Code review
- \`bug\` - Bug investigation
- \`accessibility\` - WCAG compliance scan

Try mentioning me with one of these commands.`;

    await azureDevOpsClient.addWorkItemComment(
      mentionContext.projectName,
      mentionContext.workItemId,
      notFoundMessage
    );
    return;
  }

  logger.info(`Selected workflow: ${workflow.name} (${workflow.id})`);

  // Customize workflow with context
  const customized = customizeWorkflow(workflow, {
    TOPIC: mentionContext.intent,
    BUG_DESCRIPTION: mentionContext.mentionText,
    WORK_ITEM_ID: mentionContext.workItemId.toString(),
    WORK_ITEM_URL: mentionContext.workItemUrl,
    APP_URL: '', // TODO: Extract from work item or configuration
  });

  // Create workflow trigger
  const trigger: WorkflowTrigger = {
    type: 'webhook',
    source: 'azure-devops',
    timestamp: new Date(),
    context: {
      workItemId: mentionContext.workItemId,
      workItemType: mentionContext.workItemType,
      workItemUrl: mentionContext.workItemUrl,
      projectName: mentionContext.projectName,
      mentionedBy:
        typeof mentionContext.mentionedBy === 'string'
          ? mentionContext.mentionedBy
          : mentionContext.mentionedBy.displayName,
      intent: mentionContext.intent,
      eventType: payload.eventType,
    },
  };

  // Execute workflow
  try {
    logger.info(`Starting workflow execution for work item ${mentionContext.workItemId}`);

    // 1. Post immediate acknowledgment with eyes emoji
    await azureDevOpsClient.addWorkItemComment(
      mentionContext.projectName,
      mentionContext.workItemId,
      '👀 Got it! Starting workflow...'
    );

    // 2. Update work item status to indicate work has started
    const statusUpdate = await azureDevOpsClient.updateWorkItem(
      mentionContext.projectName,
      mentionContext.workItemId,
      [
        {
          op: 'add',
          path: '/fields/System.Tags',
          value: 'AI-Processing',
        },
      ]
    );

    if (statusUpdate.success) {
      logger.info(`Added 'AI-Processing' tag to work item ${mentionContext.workItemId}`);
    }

    // 3. Post detailed workflow start message
    const startMessage = `🚀 **Workflow Started: ${workflow.name}**

Executing ${workflow.tasks.length} specialized agents to ${workflow.strategy === 'parallel' ? 'simultaneously analyze' : 'systematically investigate'} your request.

⏱️ Estimated completion: ${workflow.timeout || 15} minutes

${workflow.strategy === 'sequential' ? "📊 I'll post updates as each agent completes." : "🔄 All agents running in parallel - I'll post results when complete."}`;

    await azureDevOpsClient.addWorkItemComment(
      mentionContext.projectName,
      mentionContext.workItemId,
      startMessage
    );

    // 4. Set up progress tracking for sequential workflows
    let completedAgents = 0;
    const totalAgents = workflow.tasks.length;

    // Listen for task completion events
    const taskCompletedListener = async (event: any) => {
      if (workflow.strategy === 'sequential') {
        completedAgents++;
        const progressMessage = `✅ Agent ${completedAgents}/${totalAgents} completed: **${event.taskName || 'Agent'}**\n\n${completedAgents < totalAgents ? `⏳ Starting agent ${completedAgents + 1}/${totalAgents}...` : '🎯 All agents complete! Synthesizing results...'}`;

        await azureDevOpsClient.addWorkItemComment(
          mentionContext.projectName,
          mentionContext.workItemId,
          progressMessage
        );
      }
    };

    // Register listener before execution starts
    workflowEngine.on('task.completed', taskCompletedListener);

    const execution = await workflowEngine.executeWorkflow(customized.id, trigger);

    // Clean up listener
    workflowEngine.removeListener('task.completed', taskCompletedListener);

    logger.info(`Workflow execution completed: ${execution.id}`, {
      status: execution.status,
      duration: execution.duration,
      taskCount: execution.results.length,
    });

    // 5. Remove AI-Processing tag and add completion tag
    await azureDevOpsClient.updateWorkItem(mentionContext.projectName, mentionContext.workItemId, [
      {
        op: 'remove',
        path: '/fields/System.Tags',
        value: 'AI-Processing',
      },
      {
        op: 'add',
        path: '/fields/System.Tags',
        value: execution.status === 'completed' ? 'AI-Complete' : 'AI-Failed',
      },
    ]);

    // Format and post final results to work item
    if (execution.status === 'completed' && execution.finalOutput) {
      const durationMinutes = Math.round((execution.duration || 0) / 1000 / 60);
      const resultMessage = `✅ **Workflow Complete: ${workflow.name}**

⏱️ Duration: ${durationMinutes} minute${durationMinutes !== 1 ? 's' : ''}
🤖 Agents: ${execution.results.length}

---

${execution.finalOutput}

---

*Generated by ${config.azureDevOpsBotName} multi-agent workflow system*`;

      await azureDevOpsClient.addWorkItemComment(
        mentionContext.projectName,
        mentionContext.workItemId,
        resultMessage
      );

      logger.info(`Posted workflow results to work item ${mentionContext.workItemId}`);
    } else if (execution.status === 'failed') {
      const errorMessage = `❌ **Workflow Failed: ${workflow.name}**

The workflow encountered an error during execution.

**Error:** ${execution.error || 'Unknown error'}

Please try again or mention me with a different command.`;

      await azureDevOpsClient.addWorkItemComment(
        mentionContext.projectName,
        mentionContext.workItemId,
        errorMessage
      );
    }
  } catch (error) {
    logger.error('Workflow execution failed:', error);

    const errorMessage = `❌ **Workflow Execution Failed**

An unexpected error occurred while running the workflow.

**Error:** ${error instanceof Error ? error.message : 'Unknown error'}

Please try again later or contact support if the issue persists.`;

    await azureDevOpsClient.addWorkItemComment(
      mentionContext.projectName,
      mentionContext.workItemId,
      errorMessage
    );
  }
}

/**
 * Health check endpoint for webhooks
 * GET /webhooks/health
 */
router.get('/health', (_req: Request, res: Response) => {
  res.json({
    status: 'ok',
    webhooks: {
      azureDevOps: {
        configured: !!config.azureDevOpsWebhookSecret,
        botName: config.azureDevOpsBotName,
        ipWhitelist: config.azureDevOpsAllowedIps.length > 0,
      },
    },
  });
});

export default router;
