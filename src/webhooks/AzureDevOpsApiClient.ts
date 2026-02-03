import axios, { AxiosInstance } from 'axios';
import config from '@/config';
import { logger } from '@/utils/logger.js';

/**
 * Azure DevOps API Client
 * Provides methods to interact with Azure DevOps REST API
 */
export class AzureDevOpsApiClient {
  private client: AxiosInstance | null = null;
  private organization: string;

  constructor(organization?: string, personalAccessToken?: string) {
    this.organization = organization || config.azureDevOpsOrganization;
    const pat = personalAccessToken || config.azureDevOpsPersonalAccessToken;

    // Don't throw error on construction, allow lazy initialization
    if (!this.organization || !pat) {
      logger.warn('Azure DevOps API client not fully configured - organization or PAT missing');
      return;
    }

    // Create axios instance with base configuration
    this.client = axios.create({
      baseURL: `https://dev.azure.com/${this.organization}`,
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Basic ${Buffer.from(`:${pat}`).toString('base64')}`,
      },
      timeout: 30000, // 30 seconds
    });

    logger.info(`Azure DevOps API client initialized for organization: ${this.organization}`);
  }

  /**
   * Check if client is configured
   */
  isConfigured(): boolean {
    return this.client !== null;
  }

  /**
   * Ensure client is configured before making API calls
   */
  private ensureConfigured(): void {
    if (!this.client) {
      throw new Error(
        'Azure DevOps API client not configured. Set AZURE_DEVOPS_ORGANIZATION and AZURE_DEVOPS_PAT environment variables.'
      );
    }
  }

  /**
   * Add a comment to a work item
   */
  async addWorkItemComment(
    project: string,
    workItemId: number,
    commentText: string
  ): Promise<{ success: boolean; commentId?: number; error?: string }> {
    try {
      this.ensureConfigured();
      logger.info(`Adding comment to work item ${workItemId} in project ${project}`);

      const url = `/${project}/_apis/wit/workItems/${workItemId}/comments`;

      // Log the full request details for debugging
      logger.debug(`POST ${this.client!.defaults.baseURL}${url}`);
      logger.debug(`Request body: ${JSON.stringify({ text: commentText })}`);

      const response = await this.client!.post(
        url,
        { text: commentText },
        {
          params: { 'api-version': '7.0-preview.3' },
        }
      );

      // Log the full response for debugging
      logger.debug(`Response status: ${response.status}`);
      logger.debug(`Response data: ${JSON.stringify(response.data, null, 2)}`);

      // Azure DevOps API returns 'id' not 'commentId'
      const commentId = response.data.id || response.data.commentId;
      logger.info(`Comment added successfully: ${commentId}`);

      // Write successful response to file for inspection
      import('fs/promises').then((fs) => {
        fs.writeFile(
          '/tmp/azure-comment-success.json',
          JSON.stringify(response.data, null, 2),
          'utf-8'
        ).catch(() => {});
      });

      return {
        success: true,
        commentId: commentId,
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error adding comment';

      // Enhanced error logging with full details
      if (axios.isAxiosError(error)) {
        const errorDetails = {
          message: error.message,
          status: error.response?.status,
          statusText: error.response?.statusText,
          url: error.config?.url,
          baseURL: error.config?.baseURL,
          fullURL: `${error.config?.baseURL}${error.config?.url}`,
          method: error.config?.method,
          data: error.response?.data,
        };

        logger.error(
          `Failed to add comment to work item ${workItemId}: ${JSON.stringify(errorDetails, null, 2)}`
        );

        // Write to file for debugging
        import('fs/promises').then((fs) => {
          fs.writeFile(
            '/tmp/azure-api-error.json',
            JSON.stringify(errorDetails, null, 2),
            'utf-8'
          ).catch(() => {});
        });
      } else {
        logger.error(`Failed to add comment to work item ${workItemId}:`, error);
      }

      return {
        success: false,
        error: errorMessage,
      };
    }
  }

  /**
   * Get work item details
   */
  async getWorkItem(
    project: string,
    workItemId: number
  ): Promise<{ success: boolean; data?: any; error?: string }> {
    try {
      this.ensureConfigured();
      logger.debug(`Fetching work item ${workItemId} from project ${project}`);

      const url = `/${project}/_apis/wit/workItems/${workItemId}`;
      const response = await this.client!.get(url, {
        params: { 'api-version': '7.0' },
      });

      return {
        success: true,
        data: response.data,
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      logger.error(`Failed to fetch work item ${workItemId}:`, error);

      return {
        success: false,
        error: errorMessage,
      };
    }
  }

  /**
   * Update a work item field
   */
  async updateWorkItem(
    project: string,
    workItemId: number,
    updates: Array<{ op: string; path: string; value: any }>
  ): Promise<{ success: boolean; error?: string }> {
    try {
      this.ensureConfigured();
      logger.info(`Updating work item ${workItemId} in project ${project}`);

      const url = `/${project}/_apis/wit/workItems/${workItemId}`;
      await this.client!.patch(url, updates, {
        headers: {
          'Content-Type': 'application/json-patch+json',
        },
        params: { 'api-version': '7.0' },
      });

      logger.info(`Work item ${workItemId} updated successfully`);

      return { success: true };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      logger.error(`Failed to update work item ${workItemId}:`, error);

      return {
        success: false,
        error: errorMessage,
      };
    }
  }
}

// Singleton instance
export const azureDevOpsClient = new AzureDevOpsApiClient();
