/**
 * Utility for parsing search filters from command text
 */

export interface SearchFilters {
  query: string; // The actual search query with filters removed
  since?: Date; // Start date for date range
  before?: Date; // End date for date range
  from?: string; // Filter by user_name or user_id
  limit?: number; // Max results to return
  offset?: number; // Pagination offset
}

/**
 * Parse natural language time expressions into timestamps
 */
function parseTimeExpression(expr: string): Date | null {
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());

  expr = expr.toLowerCase().trim();

  // Handle "today", "yesterday"
  if (expr === 'today') {
    return today;
  }
  if (expr === 'yesterday') {
    const yesterday = new Date(today);
    yesterday.setDate(yesterday.getDate() - 1);
    return yesterday;
  }

  // Handle "N days/hours/minutes ago"
  const agoMatch = expr.match(/^(\d+)\s*(minute|hour|day|week|month)s?\s+ago$/);
  if (agoMatch) {
    const amount = parseInt(agoMatch[1], 10);
    const unit = agoMatch[2];
    const date = new Date(now);

    switch (unit) {
      case 'minute':
        date.setMinutes(date.getMinutes() - amount);
        break;
      case 'hour':
        date.setHours(date.getHours() - amount);
        break;
      case 'day':
        date.setDate(date.getDate() - amount);
        break;
      case 'week':
        date.setDate(date.getDate() - amount * 7);
        break;
      case 'month':
        date.setMonth(date.getMonth() - amount);
        break;
    }
    return date;
  }

  // Handle "last N days/hours/minutes"
  const lastMatch = expr.match(/^last\s+(\d+)\s*(minute|hour|day|week|month)s?$/);
  if (lastMatch) {
    const amount = parseInt(lastMatch[1], 10);
    const unit = lastMatch[2];
    const date = new Date(now);

    switch (unit) {
      case 'minute':
        date.setMinutes(date.getMinutes() - amount);
        break;
      case 'hour':
        date.setHours(date.getHours() - amount);
        break;
      case 'day':
        date.setDate(date.getDate() - amount);
        break;
      case 'week':
        date.setDate(date.getDate() - amount * 7);
        break;
      case 'month':
        date.setMonth(date.getMonth() - amount);
        break;
    }
    return date;
  }

  // Try parsing as ISO date or standard date formats
  try {
    const parsed = new Date(expr);
    if (!isNaN(parsed.getTime())) {
      return parsed;
    }
  } catch {
    // Fall through to return null
  }

  return null;
}

/**
 * Parse search command text and extract filters
 *
 * Supported filters:
 * - --since <date>: Messages after this date (inclusive)
 * - --before <date>: Messages before this date (inclusive)
 * - --from <user>: Messages from specific user (supports @mention)
 * - --limit <number>: Maximum number of results
 * - --offset <number>: Pagination offset
 *
 * Date formats:
 * - "today", "yesterday"
 * - "N days/hours/minutes ago" (e.g., "2 days ago")
 * - "last N days/hours/minutes" (e.g., "last 7 days")
 * - ISO date strings (e.g., "2024-01-15")
 * - Natural dates (e.g., "Jan 15 2024")
 *
 * Examples:
 * - "database migration --since yesterday"
 * - "bug fix --from @john --limit 5"
 * - "deployment --since 2 days ago --before today"
 */
export function parseSearchFilters(text: string): SearchFilters {
  const filters: SearchFilters = {
    query: text,
  };

  // Pattern for time expressions - matches specific known patterns
  // Use word boundaries and non-greedy matching to prevent capturing extra words
  const timeExprPattern =
    '(?:' +
    'today(?!\\w)|' + // "today" (word boundary)
    'yesterday(?!\\w)|' + // "yesterday" (word boundary)
    '\\d+\\s+(?:minute|hour|day|week|month)s?\\s+ago(?!\\w)|' + // "2 days ago"
    'last\\s+\\d+\\s+(?:minute|hour|day|week|month)s?(?!\\w)|' + // "last 7 days"
    '[\\d-]+(?:T[\\d:]+(?:Z|[+-][\\d:]+)?)?' + // ISO dates
    ')';

  // Extract --since filter (all occurrences, last one wins)
  // For --since, we need to capture the expression AND any following words that might be part of an invalid expression
  // Match: --since <known-pattern> OR --since <word> <word> (for invalid cases like "invalid date")
  const sinceRegex = new RegExp(
    `--since\\s+(?:(${timeExprPattern})|([a-zA-Z]+(?:\\s+[a-zA-Z]+)?))`,
    'g'
  );
  const sinceMatches = text.matchAll(sinceRegex);
  for (const match of sinceMatches) {
    // match[1] = valid time expression, match[2] = invalid expression (1-2 words)
    const sinceExpr = (match[1] || match[2] || '').trim();
    const sinceDate = parseTimeExpression(sinceExpr);
    if (sinceDate) {
      filters.since = sinceDate;
    }
    // Always remove the filter from query, even if invalid
    filters.query = filters.query.replace(match[0], '').trim();
  }

  // Extract --before filter (all occurrences, last one wins)
  // Same pattern as --since: match valid OR invalid expressions
  const beforeRegex = new RegExp(
    `--before\\s+(?:(${timeExprPattern})|([a-zA-Z]+(?:\\s+[a-zA-Z]+)?))`,
    'g'
  );
  const beforeMatches = text.matchAll(beforeRegex);
  for (const match of beforeMatches) {
    // match[1] = valid time expression, match[2] = invalid expression (1-2 words)
    const beforeExpr = (match[1] || match[2] || '').trim();
    const beforeDate = parseTimeExpression(beforeExpr);
    if (beforeDate) {
      filters.before = beforeDate;
      // Set to end of day
      filters.before.setHours(23, 59, 59, 999);
    }
    // Always remove the filter from query, even if invalid
    filters.query = filters.query.replace(match[0], '').trim();
  }

  // Extract --from filter (supports @mentions) - all occurrences, last one wins
  const fromMatches = text.matchAll(/--from\s+@?(\S+)/g);
  for (const match of fromMatches) {
    filters.from = match[1];
    // Remove from query
    filters.query = filters.query.replace(match[0], '').trim();
  }

  // Extract --limit filter - all occurrences, last one wins
  const limitMatches = text.matchAll(/--limit\s+(\d+)/g);
  for (const match of limitMatches) {
    filters.limit = parseInt(match[1], 10);
    // Remove from query
    filters.query = filters.query.replace(match[0], '').trim();
  }

  // Extract --offset filter - all occurrences, last one wins
  const offsetMatches = text.matchAll(/--offset\s+(\d+)/g);
  for (const match of offsetMatches) {
    filters.offset = parseInt(match[1], 10);
    // Remove from query
    filters.query = filters.query.replace(match[0], '').trim();
  }

  // Clean up the query - remove extra whitespace
  filters.query = filters.query.replace(/\s+/g, ' ').trim();

  return filters;
}

/**
 * Format filters for display in response messages
 */
export function formatFiltersForDisplay(filters: SearchFilters): string {
  const parts: string[] = [];

  if (filters.since) {
    parts.push(`since ${filters.since.toLocaleDateString()}`);
  }
  if (filters.before) {
    parts.push(`before ${filters.before.toLocaleDateString()}`);
  }
  if (filters.from) {
    parts.push(`from @${filters.from}`);
  }
  if (filters.limit) {
    parts.push(`limit ${filters.limit}`);
  }
  if (filters.offset) {
    parts.push(`offset ${filters.offset}`);
  }

  return parts.length > 0 ? ` (${parts.join(', ')})` : '';
}
