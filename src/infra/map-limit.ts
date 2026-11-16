/** 결과 순서를 지키며 limit 개까지 동시에 */
async function mapLimit<T, R>(items: readonly T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out = new Array<R>(items.length);
  let at = 0;
  const lane = async () => {
    while (at < items.length) {
      const i = at++;
      out[i] = await fn(items[i]);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, lane));
  return out;
}

export { mapLimit };
