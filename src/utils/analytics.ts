/**
 * Analytics and monitoring utilities for tracking usage and performance
 */

import { logger } from '@/utils/logger.js';

export interface AnalyticsEvent {
  event: string;
  platform: string;
  userId?: string;
  channelId?: string;
  metadata?: Record<string, any>;
  timestamp: number;
  duration?: number; // Duration in milliseconds
}

export interface CommandStats {
  command: string;
  platform: string;
  count: number;
  totalDuration: number;
  avgDuration: number;
  errors: number;
  lastUsed: number;
}

class Analytics {
  private events: AnalyticsEvent[] = [];
  private commandStats: Map<string, CommandStats> = new Map();
  private maxEvents = 10000; // Keep last 10k events in memory

  /**
   * Track a command execution
   */
  trackCommand(command: string, platform: string, userId?: string, channelId?: string): () => void {
    const startTime = Date.now();

    // Return a finish function that calculates duration
    return () => {
      const duration = Date.now() - startTime;

      this.logEvent({
        event: 'command_executed',
        platform,
        userId,
        channelId,
        metadata: { command },
        timestamp: startTime,
        duration,
      });

      this.updateCommandStats(command, platform, duration, false);
    };
  }

  /**
   * Track a command error
   */
  trackCommandError(
    command: string,
    platform: string,
    error: Error,
    userId?: string,
    channelId?: string
  ): void {
    this.logEvent({
      event: 'command_error',
      platform,
      userId,
      channelId,
      metadata: {
        command,
        error: error.message,
        stack: error.stack,
      },
      timestamp: Date.now(),
    });

    this.updateCommandStats(command, platform, 0, true);
  }

  /**
   * Track search query performance
   */
  trackSearch(
    query: string,
    platform: string,
    resultCount: number,
    duration: number,
    userId?: string,
    channelId?: string
  ): void {
    this.logEvent({
      event: 'search_executed',
      platform,
      userId,
      channelId,
      metadata: {
        query,
        resultCount,
        hasResults: resultCount > 0,
      },
      timestamp: Date.now(),
      duration,
    });

    logger.info('Search query', {
      query: query.substring(0, 100), // Limit query length in logs
      platform,
      resultCount,
      duration,
    });
  }

  /**
   * Track database query performance
   */
  trackDatabaseQuery(operation: string, duration: number, recordCount?: number): void {
    this.logEvent({
      event: 'database_query',
      platform: 'system',
      metadata: {
        operation,
        recordCount,
      },
      timestamp: Date.now(),
      duration,
    });

    // Log slow queries
    if (duration > 1000) {
      logger.warn('Slow database query detected', {
        operation,
        duration,
        recordCount,
      });
    }
  }

  /**
   * Track user engagement
   */
  trackUserActivity(userId: string, platform: string, action: string, channelId?: string): void {
    this.logEvent({
      event: 'user_activity',
      platform,
      userId,
      channelId,
      metadata: { action },
      timestamp: Date.now(),
    });
  }

  /**
   * Log an analytics event
   */
  private logEvent(event: AnalyticsEvent): void {
    this.events.push(event);

    // Trim events if we exceed max
    if (this.events.length > this.maxEvents) {
      this.events = this.events.slice(-this.maxEvents);
    }

    // Log to logger for persistence
    logger.debug('Analytics event', event);
  }

  /**
   * Update command statistics
   */
  private updateCommandStats(
    command: string,
    platform: string,
    duration: number,
    isError: boolean
  ): void {
    const key = `${platform}:${command}`;
    const existing = this.commandStats.get(key);

    if (existing) {
      existing.count += 1;
      existing.totalDuration += duration;
      existing.avgDuration = existing.totalDuration / existing.count;
      existing.errors += isError ? 1 : 0;
      existing.lastUsed = Date.now();
    } else {
      this.commandStats.set(key, {
        command,
        platform,
        count: 1,
        totalDuration: duration,
        avgDuration: duration,
        errors: isError ? 1 : 0,
        lastUsed: Date.now(),
      });
    }
  }

  /**
   * Get command statistics
   */
  getCommandStats(command?: string, platform?: string): CommandStats[] {
    let stats = Array.from(this.commandStats.values());

    if (command) {
      stats = stats.filter((s) => s.command === command);
    }
    if (platform) {
      stats = stats.filter((s) => s.platform === platform);
    }

    return stats.sort((a, b) => b.count - a.count);
  }

  /**
   * Get recent events
   */
  getRecentEvents(limit: number = 100, eventType?: string): AnalyticsEvent[] {
    let events = this.events;

    if (eventType) {
      events = events.filter((e) => e.event === eventType);
    }

    return events.slice(-limit).reverse();
  }

  /**
   * Get summary statistics
   */
  getSummary(): {
    totalEvents: number;
    totalCommands: number;
    uniqueUsers: Set<string>;
    platforms: Set<string>;
    commandsByPlatform: Record<string, number>;
    errorRate: number;
  } {
    const uniqueUsers = new Set<string>();
    const platforms = new Set<string>();
    const commandsByPlatform: Record<string, number> = {};
    let totalCommands = 0;
    let totalErrors = 0;

    for (const event of this.events) {
      if (event.userId) uniqueUsers.add(event.userId);
      platforms.add(event.platform);

      if (event.event === 'command_executed') {
        totalCommands++;
        commandsByPlatform[event.platform] = (commandsByPlatform[event.platform] || 0) + 1;
      } else if (event.event === 'command_error') {
        totalErrors++;
      }
    }

    return {
      totalEvents: this.events.length,
      totalCommands,
      uniqueUsers,
      platforms,
      commandsByPlatform,
      errorRate: totalCommands > 0 ? totalErrors / totalCommands : 0,
    };
  }

  /**
   * Get performance metrics
   */
  getPerformanceMetrics(): {
    avgSearchDuration: number;
    avgCommandDuration: number;
    slowSearches: number; // Count of searches > 2s
    slowCommands: number; // Count of commands > 5s
  } {
    const searches = this.events.filter((e) => e.event === 'search_executed');
    const commands = this.events.filter((e) => e.event === 'command_executed');

    const avgSearchDuration =
      searches.reduce((sum, e) => sum + (e.duration || 0), 0) / searches.length || 0;

    const avgCommandDuration =
      commands.reduce((sum, e) => sum + (e.duration || 0), 0) / commands.length || 0;

    const slowSearches = searches.filter((e) => (e.duration || 0) > 2000).length;
    const slowCommands = commands.filter((e) => (e.duration || 0) > 5000).length;

    return {
      avgSearchDuration,
      avgCommandDuration,
      slowSearches,
      slowCommands,
    };
  }

  /**
   * Clear all analytics data
   */
  clear(): void {
    this.events = [];
    this.commandStats.clear();
    logger.info('Analytics data cleared');
  }
}

// Singleton instance
export const analytics = new Analytics();
export default analytics;
