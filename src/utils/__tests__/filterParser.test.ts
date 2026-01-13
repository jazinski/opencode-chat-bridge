import { parseSearchFilters, formatFiltersForDisplay } from '@/utils/filterParser.js';

describe('Search Filter Parser', () => {
  describe('Basic Query Parsing', () => {
    test('should extract query without filters', () => {
      const result = parseSearchFilters('database migration');
      expect(result.query).toBe('database migration');
      expect(result.since).toBeUndefined();
      expect(result.before).toBeUndefined();
      expect(result.from).toBeUndefined();
      expect(result.limit).toBeUndefined();
    });

    test('should handle empty query', () => {
      const result = parseSearchFilters('');
      expect(result.query).toBe('');
    });

    test('should handle query with extra whitespace', () => {
      const result = parseSearchFilters('  test   query  ');
      expect(result.query).toBe('test query');
    });
  });

  describe('Date Range Filters', () => {
    test('should parse --since today', () => {
      const result = parseSearchFilters('test query --since today');
      expect(result.query).toBe('test query');
      expect(result.since).toBeInstanceOf(Date);

      const today = new Date();
      today.setHours(0, 0, 0, 0);
      expect(result.since?.toDateString()).toBe(today.toDateString());
    });

    test('should parse --since yesterday', () => {
      const result = parseSearchFilters('test query --since yesterday');
      expect(result.query).toBe('test query');
      expect(result.since).toBeInstanceOf(Date);

      const yesterday = new Date();
      yesterday.setDate(yesterday.getDate() - 1);
      yesterday.setHours(0, 0, 0, 0);
      expect(result.since?.toDateString()).toBe(yesterday.toDateString());
    });

    test('should parse --since "2 days ago"', () => {
      const result = parseSearchFilters('test query --since 2 days ago');
      expect(result.query).toBe('test query');
      expect(result.since).toBeInstanceOf(Date);

      const expected = new Date();
      expected.setDate(expected.getDate() - 2);
      const diff = Math.abs(result.since!.getTime() - expected.getTime());
      expect(diff).toBeLessThan(1000); // Within 1 second
    });

    test('should parse --since "last 7 days"', () => {
      const result = parseSearchFilters('test query --since last 7 days');
      expect(result.query).toBe('test query');
      expect(result.since).toBeInstanceOf(Date);

      const expected = new Date();
      expected.setDate(expected.getDate() - 7);
      const diff = Math.abs(result.since!.getTime() - expected.getTime());
      expect(diff).toBeLessThan(1000); // Within 1 second
    });

    test('should parse --before with time expressions', () => {
      const result = parseSearchFilters('test query --before 1 day ago');
      expect(result.query).toBe('test query');
      expect(result.before).toBeInstanceOf(Date);

      const expected = new Date();
      expected.setDate(expected.getDate() - 1);
      expected.setHours(23, 59, 59, 999);
      const diff = Math.abs(result.before!.getTime() - expected.getTime());
      expect(diff).toBeLessThan(2000); // Within 2 seconds
    });

    test('should parse both --since and --before', () => {
      const result = parseSearchFilters('test query --since yesterday --before today');
      expect(result.query).toBe('test query');
      expect(result.since).toBeInstanceOf(Date);
      expect(result.before).toBeInstanceOf(Date);
    });

    test('should ignore invalid date expressions', () => {
      const result = parseSearchFilters('test query --since invalid date');
      expect(result.query).toBe('test query');
      expect(result.since).toBeUndefined();
    });
  });

  describe('User Filters', () => {
    test('should parse --from without @ symbol', () => {
      const result = parseSearchFilters('test query --from john');
      expect(result.query).toBe('test query');
      expect(result.from).toBe('john');
    });

    test('should parse --from with @ symbol', () => {
      const result = parseSearchFilters('test query --from @john');
      expect(result.query).toBe('test query');
      expect(result.from).toBe('john');
    });

    test('should handle --from with dots and underscores', () => {
      const result = parseSearchFilters('test query --from @john.doe_123');
      expect(result.query).toBe('test query');
      expect(result.from).toBe('john.doe_123');
    });
  });

  describe('Pagination Filters', () => {
    test('should parse --limit', () => {
      const result = parseSearchFilters('test query --limit 25');
      expect(result.query).toBe('test query');
      expect(result.limit).toBe(25);
    });

    test('should parse --offset', () => {
      const result = parseSearchFilters('test query --offset 10');
      expect(result.query).toBe('test query');
      expect(result.offset).toBe(10);
    });

    test('should parse both --limit and --offset', () => {
      const result = parseSearchFilters('test query --limit 20 --offset 40');
      expect(result.query).toBe('test query');
      expect(result.limit).toBe(20);
      expect(result.offset).toBe(40);
    });
  });

  describe('Combined Filters', () => {
    test('should parse all filter types together', () => {
      const result = parseSearchFilters('bug fix --since yesterday --from @john --limit 10');
      expect(result.query).toBe('bug fix');
      expect(result.since).toBeInstanceOf(Date);
      expect(result.from).toBe('john');
      expect(result.limit).toBe(10);
    });

    test('should handle filters in different order', () => {
      const result = parseSearchFilters('--limit 5 deployment --from @admin --since today');
      expect(result.query).toBe('deployment');
      expect(result.limit).toBe(5);
      expect(result.from).toBe('admin');
      expect(result.since).toBeInstanceOf(Date);
    });

    test('should preserve query words between filters', () => {
      const result = parseSearchFilters('database --since yesterday migration --limit 10 issues');
      expect(result.query).toBe('database migration issues');
      expect(result.since).toBeInstanceOf(Date);
      expect(result.limit).toBe(10);
    });
  });

  describe('Edge Cases', () => {
    test('should handle filters only (no query)', () => {
      const result = parseSearchFilters('--since today --limit 10');
      expect(result.query).toBe('');
      expect(result.since).toBeInstanceOf(Date);
      expect(result.limit).toBe(10);
    });

    test('should handle repeated filters (last one wins)', () => {
      const result = parseSearchFilters('test --limit 5 --limit 10');
      expect(result.query).toBe('test');
      expect(result.limit).toBe(10);
    });

    test('should handle malformed filter values', () => {
      const result = parseSearchFilters('test --limit abc');
      expect(result.query).toBe('test --limit abc'); // Invalid filter not removed
      expect(result.limit).toBeUndefined(); // No match for non-numeric limit
    });
  });

  describe('Format Filters for Display', () => {
    test('should format empty filters', () => {
      const result = formatFiltersForDisplay({ query: 'test' });
      expect(result).toBe('');
    });

    test('should format single filter', () => {
      const since = new Date('2024-01-15T00:00:00Z');
      const result = formatFiltersForDisplay({ query: 'test', since });
      expect(result).toContain('since');
      expect(result).toMatch(/1\/1[45]\/2024/); // Allow for timezone offset
    });

    test('should format multiple filters', () => {
      const since = new Date('2024-01-15T00:00:00Z');
      const result = formatFiltersForDisplay({
        query: 'test',
        since,
        from: 'john',
        limit: 10,
      });
      expect(result).toContain('since');
      expect(result).toContain('from @john');
      expect(result).toContain('limit 10');
    });

    test('should format all filters', () => {
      const since = new Date('2024-01-15T00:00:00Z');
      const before = new Date('2024-01-20T00:00:00Z');
      const result = formatFiltersForDisplay({
        query: 'test',
        since,
        before,
        from: 'admin',
        limit: 25,
        offset: 50,
      });
      expect(result).toContain('since');
      expect(result).toContain('before');
      expect(result).toContain('from @admin');
      expect(result).toContain('limit 25');
      expect(result).toContain('offset 50');
    });
  });

  describe('Time Expression Parsing', () => {
    test('should handle hour expressions', () => {
      const result = parseSearchFilters('test --since 2 hours ago');
      expect(result.since).toBeInstanceOf(Date);

      const expected = new Date();
      expected.setHours(expected.getHours() - 2);
      const diff = Math.abs(result.since!.getTime() - expected.getTime());
      expect(diff).toBeLessThan(1000);
    });

    test('should handle week expressions', () => {
      const result = parseSearchFilters('test --since last 2 weeks');
      expect(result.since).toBeInstanceOf(Date);

      const expected = new Date();
      expected.setDate(expected.getDate() - 14);
      const diff = Math.abs(result.since!.getTime() - expected.getTime());
      expect(diff).toBeLessThan(1000);
    });

    test('should handle month expressions', () => {
      const result = parseSearchFilters('test --since 1 month ago');
      expect(result.since).toBeInstanceOf(Date);

      const expected = new Date();
      expected.setMonth(expected.getMonth() - 1);
      const diff = Math.abs(result.since!.getTime() - expected.getTime());
      expect(diff).toBeLessThan(1000);
    });
  });
});
