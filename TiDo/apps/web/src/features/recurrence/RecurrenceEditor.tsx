import {
  describeRule,
  draftToRule,
  presetLabel,
  previewDates,
  WEEKDAYS,
  type Preset,
  type RecurrenceDraft,
} from '../../lib/recurrence';
import { prettyDay } from '../../lib/dates';

const PRESETS: Preset[] = [
  'none',
  'daily',
  'weekdays',
  'weekly',
  'monthly-date',
  'monthly-last',
  'monthly-nth',
  'yearly',
  'custom',
];

interface Props {
  draft: RecurrenceDraft;
  anchor: string;
  onChange: (draft: RecurrenceDraft) => void;
}

export function RecurrenceEditor({ draft, anchor, onChange }: Props) {
  const set = (patch: Partial<RecurrenceDraft>) => onChange({ ...draft, ...patch });
  const rule = draftToRule(draft, anchor);
  const preview = rule ? previewDates(rule, anchor) : [];
  const supportsInterval = [
    'daily',
    'weekly',
    'monthly-date',
    'monthly-last',
    'monthly-nth',
    'yearly',
  ].includes(draft.preset);

  return (
    <fieldset className="recurrence-editor">
      <legend>Repeat</legend>
      <label>
        <span className="sr-only">Repeat pattern</span>
        <select
          aria-label="Repeat pattern"
          value={draft.preset}
          onChange={(event) =>
            set({ preset: event.target.value as Preset, custom: draft.custom || (rule ?? '') })
          }
        >
          {PRESETS.map((preset) => (
            <option key={preset} value={preset}>
              {presetLabel(preset, anchor)}
            </option>
          ))}
        </select>
      </label>

      {supportsInterval && (
        <label className="inline-field">
          Every
          <input
            type="number"
            min={1}
            max={99}
            value={draft.interval}
            aria-label="Repeat interval"
            onChange={(event) => set({ interval: Math.max(1, Number(event.target.value) || 1) })}
          />
          {{ daily: 'day(s)', weekly: 'week(s)', yearly: 'year(s)' }[draft.preset as string] ??
            'month(s)'}
        </label>
      )}

      {draft.preset === 'weekly' && (
        <div className="weekday-picker" role="group" aria-label="Repeat on">
          {WEEKDAYS.map((day) => {
            const selected = draft.weekdays.includes(day.code);
            return (
              <button
                type="button"
                key={day.code}
                aria-pressed={selected}
                className={selected ? 'weekday selected' : 'weekday'}
                onClick={() =>
                  set({
                    weekdays: selected
                      ? draft.weekdays.filter((code) => code !== day.code)
                      : [...draft.weekdays, day.code],
                  })
                }
              >
                {day.label}
              </button>
            );
          })}
        </div>
      )}

      {draft.preset === 'custom' && (
        <label>
          Custom rule <span className="field-hint">RFC 5545 RRULE</span>
          <input
            value={draft.custom}
            onChange={(event) => set({ custom: event.target.value.toUpperCase() })}
            placeholder="FREQ=WEEKLY;INTERVAL=2;BYDAY=FR"
            spellCheck={false}
          />
          <small>
            Examples: <code>FREQ=MONTHLY;BYDAY=1SA</code>,{' '}
            <code>FREQ=YEARLY;BYMONTH=3;BYMONTHDAY=1</code>
          </small>
        </label>
      )}

      {draft.preset !== 'none' && draft.preset !== 'custom' && (
        <div className="inline-field">
          Ends
          <select
            aria-label="Ends"
            value={draft.end}
            onChange={(event) => set({ end: event.target.value as RecurrenceDraft['end'] })}
          >
            <option value="never">Never</option>
            <option value="count">After a number of times</option>
            <option value="until">On a date</option>
          </select>
          {draft.end === 'count' && (
            <input
              type="number"
              min={1}
              max={999}
              aria-label="Number of occurrences"
              value={draft.count}
              onChange={(event) => set({ count: Math.max(1, Number(event.target.value) || 1) })}
            />
          )}
          {draft.end === 'until' && (
            <input
              type="date"
              aria-label="End date"
              value={draft.until}
              min={anchor}
              onChange={(event) => set({ until: event.target.value })}
            />
          )}
        </div>
      )}

      {rule && (
        <p className="recurrence-summary" aria-live="polite">
          Repeats {describeRule(rule, anchor)}
          {preview.length > 0 && <> · next: {preview.map((day) => prettyDay(day)).join(', ')}</>}
        </p>
      )}
    </fieldset>
  );
}
