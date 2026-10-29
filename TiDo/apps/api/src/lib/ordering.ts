/**
 * Places `movedId` at `position` within `orderedIds` (which must not include it) and
 * returns the new full order. Callers persist positions as each id's index.
 */
export function placeAt(orderedIds: string[], movedId: string, position: number): string[] {
  const next = orderedIds.filter((id) => id !== movedId);
  next.splice(Math.max(0, Math.min(position, next.length)), 0, movedId);
  return next;
}

/** Yields only the ids whose index changed, so renumbering touches as few rows as possible. */
export function changedPositions(
  previous: { id: string; position: number }[],
  order: string[],
): { id: string; position: number }[] {
  const before = new Map(previous.map((row) => [row.id, row.position]));
  return order
    .map((id, position) => ({ id, position }))
    .filter(({ id, position }) => before.get(id) !== position);
}
