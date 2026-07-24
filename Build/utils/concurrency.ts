export const DEFAULT_CONCURRENCY_LIMIT = 6;

export async function boundedMap<T, R>(
  items: readonly T[],
  mapper: (item: T, index: number) => Promise<R>,
  options: { limit?: number } = {}
): Promise<R[]> {
  const limit = options.limit ?? DEFAULT_CONCURRENCY_LIMIT;
  if (!Number.isInteger(limit) || limit <= 0) {
    throw new RangeError('Concurrency limit must be a positive integer');
  }

  const results = new Array<R>(items.length);
  let nextIndex = 0;
  const worker = async () => {
    while (nextIndex < items.length) {
      const index = nextIndex++;
      // eslint-disable-next-line no-await-in-loop -- each worker claims the next bounded task
      results[index] = await mapper(items[index], index);
    }
  };
  const workers = Array.from({ length: Math.min(limit, items.length) }, worker);
  await Promise.all(workers);
  return results;
}
