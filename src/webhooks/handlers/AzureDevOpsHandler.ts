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

    logger.debug('Checking for bot mention', {
      botName,
      messageText: payload.message?.text,
      detailedMessageText: payload.detailedMessage?.text,
      eventType: payload.eventType,
    });

    // Check in message text
    if (payload.message?.text?.toLowerCase().includes(botName)) {
      logger.debug('Found bot mention in message.text');
      return true;
    }

    // Check in detailed message
    if (payload.detailedMessage?.text?.toLowerCase().includes(botName)) {
      logger.debug('Found bot mention in detailedMessage.text');
      return true;
    }

    // For work item events, check the History field (comments)
    if (this.isWorkItemEvent(payload.eventType as AzureDevOpsEventType)) {
      const resource = payload.resource as WorkItemResource;
      const history = resource.fields?.['System.History'];

      logger.debug('Checking work item history', {
        hasHistory: !!history,
        historyType: typeof history,
        historyPreview: history ? String(history).substring(0, 200) : null,
        hasRevision: !!resource.revision,
        revisionHistoryPreview: resource.revision?.fields?.['System.History']?.substring(0, 200),
      });

      if (history && typeof history === 'string' && history.toLowerCase().includes(botName)) {
        logger.debug('Found bot mention in System.History');
        return true;
      }

      // Check revision history if available
      if (resource.revision?.fields?.['System.History']) {
        const revHistory = resource.revision.fields['System.History'];
        if (typeof revHistory === 'string' && revHistory.toLowerCase().includes(botName)) {
          logger.debug('Found bot mention in revision.fields.System.History');
          return true;
        }
      }
    }

    logger.debug('No bot mention found in any field');
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

    // Parse mentionedBy - Azure DevOps can send either a string or an object
    const changedBy = resource.fields['System.ChangedBy'];
    const mentionedByName = this.parseIdentityDisplayName(changedBy);

    const context: MentionContext = {
      botName,
      workItemId: resource.id,
      workItemType: resource.fields['System.WorkItemType'],
      workItemTitle: resource.fields['System.Title'],
      workItemUrl: resource._links.html.href,
      projectName: resource.fields['System.TeamProject'],
      mentionedBy: changedBy,
      mentionText,
      intent,
      timestamp: new Date(payload.createdDate),
    };

    logger.info(
      `Parsed mention context: WorkItem=${context.workItemId}, Intent="${context.intent}", By=${mentionedByName}`
    );

    return context;
  }

  /**
   * Parse display name from Azure DevOps identity (handles both string and object formats)
   */
  private static parseIdentityDisplayName(identity: any): string {
    if (!identity) {
      return 'Unknown';
    }

    // If it's an object with displayName
    if (typeof identity === 'object' && identity.displayName) {
      return identity.displayName;
    }

    // If it's a string like "****Christopher Jazinski <p-mug472@utrgv.edu>"
    if (typeof identity === 'string') {
      // Extract name before < character (email part)
      const match = identity.match(/^(.+?)\s*<.*>$/);
      if (match && match[1]) {
        return match[1].replace(/^\*+/, '').trim(); // Remove leading asterisks
      }
      return identity.replace(/^\*+/, '').trim(); // Fallback: just remove asterisks
    }

    return String(identity);
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
