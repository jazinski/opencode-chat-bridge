import express, { Request, Response, NextFunction } from 'express';
import { logger } from '@/utils/logger.js';
import config from '@/config';
import { AzureDevOpsHandler } from './handlers/AzureDevOpsHandler.js';
import { workflowEngine } from '@/orchestration/WorkflowEngine.js';
import { getWorkflowForIntent, customizeWorkflow } from '@/orchestration/workflows/examples.js';
import type { AzureDevOpsWebhookPayload, WebhookValidation } from './types.js';
import type { WorkflowTrigger } from '@/orchestration/types.js';

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
    logger.info('No intent provided, would send help message');
    // TODO: Post comment to work item with available commands
    return;
  }

  // Find matching workflow based on intent
  const workflow = getWorkflowForIntent(mentionContext.intent);
  if (!workflow) {
    logger.warn(`No workflow found for intent: "${mentionContext.intent}"`);
    // TODO: Post comment to work item explaining available workflows
    return;
  }

  logger.info(`Selected workflow: ${workflow.name} (${workflow.id})`);

  // Customize workflow with context
  const customized = customizeWorkflow(workflow, {
    TOPIC: mentionContext.intent,
    BUG_DESCRIPTION: mentionContext.mentionText,
    WORK_ITEM_ID: mentionContext.workItemId.toString(),
    WORK_ITEM_URL: mentionContext.workItemUrl,
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
    // TODO: Post initial comment to work item indicating workflow started

    const execution = await workflowEngine.executeWorkflow(customized.id, trigger);

    logger.info(`Workflow execution completed: ${execution.id}`, {
      status: execution.status,
      duration: execution.duration,
      taskCount: execution.results.length,
    });

    // TODO: Post final results to work item as comment
    // For now, log the output
    if (execution.finalOutput) {
      logger.info('Workflow final output:', { output: execution.finalOutput.substring(0, 200) });
    }
  } catch (error) {
    logger.error('Workflow execution failed:', error);
    // TODO: Post error comment to work item
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
