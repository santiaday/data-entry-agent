import { describe, it, expect } from 'vitest';
import { estimateTokens, truncateToTokenBudget } from './token-budget';

describe('estimateTokens', () => {
  it('should estimate ~1 token per 4 characters', () => {
    expect(estimateTokens('abcd')).toBe(1);
    expect(estimateTokens('abcdefgh')).toBe(2);
    expect(estimateTokens('a')).toBe(1); // ceil(0.25)
  });

  it('should handle empty string', () => {
    expect(estimateTokens('')).toBe(0);
  });

  it('should handle long strings', () => {
    const longString = 'a'.repeat(10000);
    expect(estimateTokens(longString)).toBe(2500);
  });
});

describe('truncateToTokenBudget', () => {
  it('should not truncate text within budget', () => {
    const text = 'Hello world';
    expect(truncateToTokenBudget(text, 100)).toBe(text);
  });

  it('should truncate text exceeding budget', () => {
    const text = 'Line 1\nLine 2\nLine 3\nLine 4\nLine 5';
    const result = truncateToTokenBudget(text, 3); // 12 chars budget

    expect(result).toContain('Line 1');
    expect(result).toContain('truncated');
    expect(result.length).toBeLessThan(text.length + 50); // truncation notice adds some
  });

  it('should truncate at newline boundary', () => {
    const text = 'Short\nThis is a much longer line that should be cut\nAnother line';
    const result = truncateToTokenBudget(text, 5); // 20 chars budget

    // Should cut at the first newline before the 20-char mark
    expect(result).toContain('Short');
    expect(result).toContain('truncated');
  });

  it('should handle text with no newlines', () => {
    const text = 'a'.repeat(100);
    const result = truncateToTokenBudget(text, 5); // 20 chars budget

    expect(result.length).toBeLessThan(100 + 50);
    expect(result).toContain('truncated');
  });
});
