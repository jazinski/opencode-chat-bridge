/**
 * Azure DevOps webhook event types and payload structures
 * Based on: https://learn.microsoft.com/en-us/azure/devops/service-hooks/events
 */

export interface AzureDevOpsWebhookPayload {
  id: string;
  eventType: string;
  publisherId: string;
  message: {
    text: string;
    html: string;
    markdown: string;
  };
  detailedMessage: {
    text: string;
    html: string;
    markdown: string;
  };
  resource: WorkItemResource | PullRequestResource;
  resourceVersion: string;
  resourceContainers: {
    collection: { id: string };
    account: { id: string };
    project: { id: string };
  };
  createdDate: string;
}

export interface WorkItemResource {
  id: number;
  rev: number;
  fields: {
    'System.AreaPath': string;
    'System.TeamProject': string;
    'System.IterationPath': string;
    'System.WorkItemType': string;
    'System.State': string;
    'System.Reason': string;
    'System.CreatedDate': string;
    'System.CreatedBy': AzureDevOpsIdentity;
    'System.ChangedDate': string;
    'System.ChangedBy': AzureDevOpsIdentity;
    'System.Title': string;
    'System.BoardColumn'?: string;
    'System.BoardColumnDone'?: boolean;
    'System.Description'?: string;
    'System.History'?: string;
    [key: string]: any;
  };
  _links: {
    self: { href: string };
    workItemUpdates: { href: string };
    workItemRevisions: { href: string };
    workItemComments: { href: string };
    html: { href: string };
    workItemType: { href: string };
    fields: { href: string };
  };
  url: string;
  revision?: {
    id: number;
    rev: number;
    fields: Record<string, any>;
  };
}

export interface PullRequestResource {
  repository: {
    id: string;
    name: string;
    url: string;
    project: {
      id: string;
      name: string;
      url: string;
      state: string;
    };
  };
  pullRequestId: number;
  status: string;
  createdBy: AzureDevOpsIdentity;
  creationDate: string;
  title: string;
  description: string;
  sourceRefName: string;
  targetRefName: string;
  mergeStatus: string;
  mergeId: string;
  url: string;
  _links: {
    web: { href: string };
    statuses: { href: string };
  };
}

export interface AzureDevOpsIdentity {
  displayName: string;
  url: string;
  _links: {
    avatar: { href: string };
  };
  id: string;
  uniqueName: string;
  imageUrl: string;
  descriptor: string;
}

/**
 * Parsed mention from work item comment or field
 */
export interface MentionContext {
  botName: string;
  workItemId: number;
  workItemType: string;
  workItemTitle: string;
  workItemUrl: string;
  projectName: string;
  mentionedBy: AzureDevOpsIdentity;
  mentionText: string; // Full text of the comment/field containing the mention
  intent?: string; // Extracted intent (e.g., "research X", "review PR", "analyze Y")
  timestamp: Date;
}

/**
 * Webhook validation result
 */
export interface WebhookValidation {
  valid: boolean;
  error?: string;
  ipAddress?: string;
}

/**
 * Supported Azure DevOps event types
 */
export enum AzureDevOpsEventType {
  WORK_ITEM_CREATED = 'workitem.created',
  WORK_ITEM_UPDATED = 'workitem.updated',
  WORK_ITEM_COMMENTED = 'workitem.commented',
  WORK_ITEM_DELETED = 'workitem.deleted',
  WORK_ITEM_RESTORED = 'workitem.restored',
  PULL_REQUEST_CREATED = 'git.pullrequest.created',
  PULL_REQUEST_UPDATED = 'git.pullrequest.updated',
  PULL_REQUEST_MERGED = 'git.pullrequest.merged',
  BUILD_COMPLETE = 'build.complete',
  RELEASE_CREATED = 'ms.vss-release.release-created-event',
  RELEASE_DEPLOYMENT_COMPLETED = 'ms.vss-release.deployment-completed-event',
}
