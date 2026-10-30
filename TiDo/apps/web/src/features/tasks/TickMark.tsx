/**
 * Marks a task like marking work: a cross while it is still to do, a tick once done.
 * Hovering a cross previews the tick it turns into (styles.css).
 */
export function TickMark({ done }: { done: boolean }) {
  return (
    <svg className={done ? 'tick-mark done' : 'tick-mark'} viewBox="0 0 24 24" aria-hidden="true">
      <path className="mark-cross" d="M7 7l10 10M17 7L7 17" />
      <path className="mark-tick" d="M4 13l5 5L20 6" pathLength={1} />
    </svg>
  );
}
