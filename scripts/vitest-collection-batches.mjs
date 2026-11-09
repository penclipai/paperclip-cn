// Keep individual Windows CreateProcess command lines well below the 32 KiB
// limit. This applies to collection validation only; every requested filter is
// retained and its collected results are merged by the caller.
export const maxVitestCollectionFilterCharacters = 12_000;

export function batchVitestCollectionFilters(filters, baseArgs = [], limit = maxVitestCollectionFilterCharacters) {
  if (!Number.isInteger(limit) || limit <= 0) throw new Error("Collection command limit must be a positive integer");
  const batches = [];
  let batch = [];
  let length = baseArgs.reduce((total, arg) => total + String(arg).length + 1, 0);
  for (const filter of filters) {
    const text = String(filter);
    const nextLength = length + text.length + 1;
    if (batch.length > 0 && nextLength > limit) {
      batches.push(batch);
      batch = [];
      length = baseArgs.reduce((total, arg) => total + String(arg).length + 1, 0);
    }
    batch.push(filter);
    length += text.length + 1;
  }
  if (batch.length > 0) batches.push(batch);
  return batches;
}
