/**
 * Concurrency-limited parallel map.
 * A minimal p-limit implementation with no external dependencies.
 */

/**
 * Process items in parallel with a concurrency limit.
 * Like Promise.all but only runs `concurrency` items at a time.
 *
 * Each item is processed independently — a rejected promise for one item
 * does not cancel others. Failed items are captured in the result.
 *
 * @param items - The items to process.
 * @param fn - Async function to apply to each item.
 * @param concurrency - Maximum number of concurrent executions.
 * @returns Array of results in the same order as the input items.
 */
export async function pMap<T, R>(
  items: readonly T[],
  fn: (item: T, index: number) => Promise<R>,
  concurrency: number,
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  const errors: { index: number; error: unknown }[] = [];
  const executing = new Set<Promise<void>>();

  for (let i = 0; i < items.length; i++) {
    const index = i;
    const p = fn(items[index], index)
      .then((result) => {
        results[index] = result;
      })
      .catch((error: unknown) => {
        errors.push({ index, error });
      })
      .finally(() => {
        executing.delete(p);
      });

    executing.add(p);

    if (executing.size >= concurrency) {
      await Promise.race(executing);
    }
  }

  await Promise.all(executing);

  if (errors.length > 0) {
    throw errors[0].error;
  }

  return results;
}

/**
 * Like pMap but uses Promise.allSettled semantics — never throws,
 * returns PromiseSettledResult for each item.
 */
export async function pMapSettled<T, R>(
  items: readonly T[],
  fn: (item: T, index: number) => Promise<R>,
  concurrency: number,
): Promise<PromiseSettledResult<R>[]> {
  const results: PromiseSettledResult<R>[] = new Array(items.length);
  const executing = new Set<Promise<void>>();

  for (let i = 0; i < items.length; i++) {
    const index = i;
    const p = fn(items[index], index)
      .then((value) => {
        results[index] = { status: 'fulfilled', value };
      })
      .catch((reason: unknown) => {
        results[index] = { status: 'rejected', reason };
      })
      .finally(() => {
        executing.delete(p);
      });

    executing.add(p);

    if (executing.size >= concurrency) {
      await Promise.race(executing);
    }
  }

  await Promise.all(executing);
  return results;
}
