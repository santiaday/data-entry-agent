import { describe, it, expect, vi } from 'vitest';
import { withRetry, isRetryableHttpError } from './retry';

describe('withRetry', () => {
  it('should return the result on first success', async () => {
    const fn = vi.fn().mockResolvedValue('ok');
    const result = await withRetry(fn);
    expect(result).toBe('ok');
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('should retry on failure and succeed on second attempt', async () => {
    const fn = vi.fn()
      .mockRejectedValueOnce(new Error('fail'))
      .mockResolvedValue('ok');

    const result = await withRetry(fn, { baseDelayMs: 1 });
    expect(result).toBe('ok');
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it('should throw after exhausting all attempts', async () => {
    const fn = vi.fn().mockRejectedValue(new Error('always fails'));

    await expect(
      withRetry(fn, { maxAttempts: 3, baseDelayMs: 1 }),
    ).rejects.toThrow('always fails');

    expect(fn).toHaveBeenCalledTimes(3);
  });

  it('should not retry when retryOn returns false', async () => {
    const fn = vi.fn().mockRejectedValue(new Error('non-retryable'));

    await expect(
      withRetry(fn, {
        maxAttempts: 3,
        baseDelayMs: 1,
        retryOn: () => false,
      }),
    ).rejects.toThrow('non-retryable');

    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('should respect maxAttempts = 1 (no retry)', async () => {
    const fn = vi.fn().mockRejectedValue(new Error('fail'));

    await expect(
      withRetry(fn, { maxAttempts: 1, baseDelayMs: 1 }),
    ).rejects.toThrow('fail');

    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('should retry the correct number of times', async () => {
    const fn = vi.fn()
      .mockRejectedValueOnce(new Error('1'))
      .mockRejectedValueOnce(new Error('2'))
      .mockRejectedValueOnce(new Error('3'))
      .mockResolvedValue('ok');

    const result = await withRetry(fn, { maxAttempts: 4, baseDelayMs: 1 });
    expect(result).toBe('ok');
    expect(fn).toHaveBeenCalledTimes(4);
  });
});

describe('isRetryableHttpError', () => {
  it('should return true for 429 status', () => {
    const error = Object.assign(new Error('rate limited'), { statusCode: 429 });
    expect(isRetryableHttpError(error)).toBe(true);
  });

  it('should return true for 500 status', () => {
    const error = Object.assign(new Error('server error'), { statusCode: 500 });
    expect(isRetryableHttpError(error)).toBe(true);
  });

  it('should return true for 502 status', () => {
    const error = Object.assign(new Error('bad gateway'), { statusCode: 502 });
    expect(isRetryableHttpError(error)).toBe(true);
  });

  it('should return true for 503 status', () => {
    const error = Object.assign(new Error('unavailable'), { statusCode: 503 });
    expect(isRetryableHttpError(error)).toBe(true);
  });

  it('should return false for 400 status', () => {
    const error = Object.assign(new Error('bad request'), { statusCode: 400 });
    expect(isRetryableHttpError(error)).toBe(false);
  });

  it('should return false for 404 status', () => {
    const error = Object.assign(new Error('not found'), { statusCode: 404 });
    expect(isRetryableHttpError(error)).toBe(false);
  });

  it('should return false for non-Error values', () => {
    expect(isRetryableHttpError('string')).toBe(false);
    expect(isRetryableHttpError(null)).toBe(false);
    expect(isRetryableHttpError(undefined)).toBe(false);
  });

  it('should return true for fetch TypeError', () => {
    const error = new TypeError('fetch failed');
    expect(isRetryableHttpError(error)).toBe(true);
  });
});
