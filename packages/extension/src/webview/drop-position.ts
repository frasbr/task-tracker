/**
 * The one piece of drag-and-drop math worth testing outside a browser: given the ids
 * already in a column (in rank order, the dragged card excluded) and the index the
 * pointer is over, which single neighbour flag tells the host where the gap is.
 *
 * Kept out of `main.ts` because that module calls `acquireVsCodeApi()` and touches
 * `document` at load time, which makes it uninmportable under `node --test`. Reading
 * geometry (`getBoundingClientRect`, `dataset`) to produce `ids` and `idx` stays in
 * `main.ts` — that part genuinely needs a DOM. This part does not, and it is exactly
 * where a silent off-by-one would send the wrong `--before`/`--after` to `tasks move`.
 *
 * Never sends both flags: `resolveNeighbours` in core's store only needs one to find
 * the gap, and a single flag is enough to express all three edge cases tt-4 calls out
 * — dropped above the first card, below the last, and into an empty column.
 */
export interface DropPosition {
  before?: string;
  after?: string;
}

/**
 * `ids` is the target column's cards in rank order, excluding whichever one is being
 * dragged. `idx` is where the drop lands among them: `0` is above everything, `ids.length`
 * is below everything.
 */
export function dropPosition(ids: readonly string[], idx: number): DropPosition {
  if (ids.length === 0) return {};
  if (idx <= 0) return { before: ids[0]! };
  if (idx >= ids.length) return { after: ids[ids.length - 1]! };
  return { before: ids[idx]! };
}
