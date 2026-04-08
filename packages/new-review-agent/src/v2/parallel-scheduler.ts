export async function runWithConcurrency<T, R>(
  items: T[],
  concurrency: number,
  worker: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  if (items.length === 0) {
    return [];
  }

  const limit = Math.max(1, Math.min(concurrency, items.length));
  const output = new Array<R>(items.length);
  let cursor = 0;

  const runners = Array.from({ length: limit }, async () => {
    while (cursor < items.length) {
      const index = cursor;
      cursor += 1;
      output[index] = await worker(items[index]!, index);
    }
  });

  await Promise.all(runners);
  return output;
}
