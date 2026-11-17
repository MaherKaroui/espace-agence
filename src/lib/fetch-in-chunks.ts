const PAGE = 1000;
const MAX_IN_FLIGHT = 4;

/** Runs `build(chunk)` for chunks of `ids` (100 at a time) and concatenates the rows; pages each chunk past 1,000 rows. */
export async function fetchInChunks<T>(ids: string[], build: (chunk: string[]) => any, size = 100): Promise<T[]> {
  const chunks: string[][] = [];
  for (let i = 0; i < ids.length; i += size) chunks.push(ids.slice(i, i + size));

  const fetchChunk = async (chunk: string[]): Promise<T[]> => {
    const rows: T[] = [];
    for (let from = 0; ; from += PAGE) {
      const { data, error } = await build(chunk).range(from, from + PAGE - 1);
      if (error) throw error;
      const page = (data ?? []) as T[];
      rows.push(...page);
      if (page.length < PAGE) break;
    }
    return rows;
  };

  const results: T[][] = new Array(chunks.length);
  let next = 0;
  const worker = async () => {
    while (next < chunks.length) {
      const i = next++;
      results[i] = await fetchChunk(chunks[i]);
    }
  };
  await Promise.all(Array.from({ length: Math.min(MAX_IN_FLIGHT, chunks.length) }, worker));
  return results.flat();
}
