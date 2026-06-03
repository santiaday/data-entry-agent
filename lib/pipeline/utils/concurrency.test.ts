import { describe, it, expect } from 'vitest';
import { pMap, pMapSettled } from './concurrency';

describe('pMap', () => {
  it('should process all items and return results in order', async () => {
    const items = [1, 2, 3, 4, 5];
    const results = await pMap(items, async (n) => n * 2, 3);
    expect(results).toEqual([2, 4, 6, 8, 10]);
  });

  it('should respect concurrency limit', async () => {
    let concurrent = 0;
    let maxConcurrent = 0;

    const items = [1, 2, 3, 4, 5, 6];
    await pMap(
      items,
      async () => {
        concurrent++;
        maxConcurrent = Math.max(maxConcurrent, concurrent);
        await new Promise((r) => setTimeout(r, 10));
        concurrent--;
      },
      2,
    );

    expect(maxConcurrent).toBeLessThanOrEqual(2);
  });

  it('should handle empty array', async () => {
    const results = await pMap([], async (n: number) => n, 3);
    expect(results).toEqual([]);
  });

  it('should handle concurrency of 1 (sequential)', async () => {
    const order: number[] = [];
    const items = [1, 2, 3];

    await pMap(
      items,
      async (n) => {
        order.push(n);
        await new Promise((r) => setTimeout(r, 5));
        return n;
      },
      1,
    );

    expect(order).toEqual([1, 2, 3]);
  });

  it('should propagate errors', async () => {
    const items = [1, 2, 3];
    await expect(
      pMap(items, async (n) => {
        if (n === 2) throw new Error('fail on 2');
        return n;
      }, 3),
    ).rejects.toThrow('fail on 2');
  });

  it('should handle concurrency larger than items', async () => {
    const items = [1, 2];
    const results = await pMap(items, async (n) => n * 10, 100);
    expect(results).toEqual([10, 20]);
  });
});

describe('pMapSettled', () => {
  it('should capture all results including failures', async () => {
    const items = [1, 2, 3];
    const results = await pMapSettled(
      items,
      async (n) => {
        if (n === 2) throw new Error('fail');
        return n * 10;
      },
      3,
    );

    expect(results[0]).toEqual({ status: 'fulfilled', value: 10 });
    expect(results[1]).toEqual({ status: 'rejected', reason: new Error('fail') });
    expect(results[2]).toEqual({ status: 'fulfilled', value: 30 });
  });

  it('should never throw even if all items fail', async () => {
    const items = [1, 2, 3];
    const results = await pMapSettled(
      items,
      async () => {
        throw new Error('all fail');
      },
      2,
    );

    expect(results.every((r) => r.status === 'rejected')).toBe(true);
  });

  it('should respect concurrency limit', async () => {
    let concurrent = 0;
    let maxConcurrent = 0;

    const items = [1, 2, 3, 4, 5];
    await pMapSettled(
      items,
      async () => {
        concurrent++;
        maxConcurrent = Math.max(maxConcurrent, concurrent);
        await new Promise((r) => setTimeout(r, 10));
        concurrent--;
      },
      2,
    );

    expect(maxConcurrent).toBeLessThanOrEqual(2);
  });

  it('should return results in order', async () => {
    const items = [30, 10, 20];
    const results = await pMapSettled(
      items,
      async (ms) => {
        await new Promise((r) => setTimeout(r, ms));
        return ms;
      },
      3,
    );

    expect(results.map((r) => r.status === 'fulfilled' ? r.value : null)).toEqual([30, 10, 20]);
  });
});
