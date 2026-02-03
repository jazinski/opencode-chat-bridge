import { logger } from '@/utils/logger.js';
import config from '@/config';
import type {
  AzureDevOpsWebhookPayload,
  MentionContext,
  WorkItemResource,
  AzureDevOpsEventType,
} from '../types.js';

/**
 * Azure DevOps Webhook Handler
 * Parses Azure DevOps webhook payloads and extracts @mention information
 */
export class AzureDevOpsHandler {
  /**
   * Check if a webhook payload contains a mention of the bot
   */
  static hasBotMention(payload: AzureDevOpsWebhookPayload): boolean {
    const botName = config.azureDevOpsBotName.toLowerCase();

    // Check in message text
    if (payload.message?.text?.toLowerCase().includes(botName)) {
      return true;
    }

    // Check in detailed message
    if (payload.detailedMessage?.text?.toLowerCase().includes(botName)) {
      return true;
    }

    // For work item events, check the History field (comments)
    if (this.isWorkItemEvent(payload.eventType as AzureDevOpsEventType)) {
      const resource = payload.resource as WorkItemResource;
      const history = resource.fields?.['System.History'];
      if (history && typeof history === 'string' && history.toLowerCase().includes(botName)) {
        return true;
      }

      // Check revision history if available
      if (resource.revision?.fields?.['System.History']) {
        const revHistory = resource.revision.fields['System.History'];
        if (typeof revHistory === 'string' && revHistory.toLowerCase().includes(botName)) {
          return true;
        }
      }
    }

    return false;
  }

  /**
   * Parse mention context from webhook payload
   */
  static parseMentionContext(payload: AzureDevOpsWebhookPayload): MentionContext | null {
    if (!this.hasBotMention(payload)) {
      logger.debug('No bot mention found in payload');
      return null;
    }

    if (!this.isWorkItemEvent(payload.eventType as AzureDevOpsEventType)) {
      logger.warn(`Unsupported event type for mention parsing: ${payload.eventType}`);
      return null;
    }

    const resource = payload.resource as WorkItemResource;
    const botName = config.azureDevOpsBotName;

    // Extract the text containing the mention
    let mentionText = '';
    const history = resource.fields?.['System.History'];
    if (
      history &&
      typeof history === 'string' &&
      history.toLowerCase().includes(botName.toLowerCase())
    ) {
      mentionText = this.stripHtml(history);
    } else if (resource.revision?.fields?.['System.History']) {
      mentionText = this.stripHtml(resource.revision.fields['System.History']);
    } else if (payload.message?.text) {
      mentionText = payload.message.text;
    }

    // Extract intent (text after the @mention)
    const intent = this.extractIntent(mentionText, botName);

    const context: MentionContext = {
      botName,
      workItemId: resource.id,
      workItemType: resource.fields['System.WorkItemType'],
      workItemTitle: resource.fields['System.Title'],
      workItemUrl: resource._links.html.href,
      projectName: resource.fields['System.TeamProject'],
      mentionedBy: resource.fields['System.ChangedBy'],
      mentionText,
      intent,
      timestamp: new Date(payload.createdDate),
    };

    logger.info(
      `Parsed mention context: WorkItem=${context.workItemId}, Intent="${context.intent}", By=${context.mentionedBy.displayName}`
    );

    return context;
  }

  /**
   * Extract intent from mention text
   * Example: "@OpenCodeBot research authentication best practices" -> "research authentication best practices"
   */
  private static extractIntent(text: string, botName: string): string | undefined {
    const botNamePattern = botName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); // Escape regex chars
    const regex = new RegExp(`${botNamePattern}\\s+(.+)`, 'i');
    const match = text.match(regex);

    if (match && match[1]) {
      return match[1].trim();
    }

    // Fallback: return text after the bot name if no clear pattern
    const botIndex = text.toLowerCase().indexOf(botName.toLowerCase());
    if (botIndex !== -1) {
      const afterBot = text.substring(botIndex + botName.length).trim();
      if (afterBot.length > 0) {
        return afterBot;
      }
    }

    return undefined;
  }

  /**
   * Strip HTML tags from text
   */
  private static stripHtml(html: string): string {
    return html
      .replace(/<[^>]*>/g, '') // Remove HTML tags
      .replace(/&nbsp;/g, ' ') // Replace &nbsp; with space
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&amp;/g, '&')
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'")
      .trim();
  }

  /**
   * Check if event type is a work item event
   */
  private static isWorkItemEvent(eventType: AzureDevOpsEventType): boolean {
    return (
      eventType === 'workitem.created' ||
      eventType === 'workitem.updated' ||
      eventType === 'workitem.commented' ||
      eventType === 'workitem.deleted' ||
      eventType === 'workitem.restored'
    );
  }

  /**
   * Validate webhook payload structure
   */
  static validatePayload(payload: any): payload is AzureDevOpsWebhookPayload {
    if (!payload || typeof payload !== 'object') {
      return false;
    }

    // Check required fields
    if (!payload.eventType || !payload.resource) {
      logger.warn('Webhook payload missing required fields');
      return false;
    }

    return true;
  }
}
