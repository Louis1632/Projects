import type { RecurrenceScope } from '@tido/contracts';

interface Props {
  action: 'save' | 'delete';
  /** Hide "only this one" when the change can only apply to the series (e.g. the rule). */
  allowOccurrence: boolean;
  onChoose: (scope: RecurrenceScope) => void;
  onCancel: () => void;
}

export function ScopeDialog({ action, allowOccurrence, onChoose, onCancel }: Props) {
  const verb = action === 'save' ? 'Apply changes to' : 'Delete';
  return (
    <div className="modal-backdrop nested" role="presentation">
      <section
        className="scope-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="scope-title"
      >
        <h2 id="scope-title">
          {action === 'save' ? 'Edit recurring task' : 'Delete recurring task'}
        </h2>
        <p>{verb}…</p>
        <div className="scope-options">
          {allowOccurrence && (
            <button className="secondary-button" onClick={() => onChoose('occurrence')}>
              Only this occurrence
            </button>
          )}
          <button className="secondary-button" onClick={() => onChoose('future')}>
            This and following occurrences
          </button>
          <button className="secondary-button" onClick={() => onChoose('series')}>
            All open occurrences
          </button>
        </div>
        <p className="helper-copy">Completed occurrences always keep their history.</p>
        <button className="text-button" onClick={onCancel}>
          Cancel
        </button>
      </section>
    </div>
  );
}
