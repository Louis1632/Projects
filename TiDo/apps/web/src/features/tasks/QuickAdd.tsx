import { useState, type FormEvent } from 'react';

interface QuickAddProps {
  /** The button's text, such as "+ Subtask". */
  label: string;
  /** Names the button and the field for screen readers and tests. */
  buttonLabel: string;
  fieldLabel: string;
  placeholder: string;
  className: string;
  /** Saves one title; rejecting keeps it in the field so nothing typed is lost. */
  onAdd: (title: string) => Promise<unknown>;
}

/**
 * A button that opens into a one-line field. Enter adds the title and leaves the field open
 * for the next one; Escape, or leaving it empty, closes it. Details are added later by
 * opening the item.
 */
export function QuickAdd({
  label,
  buttonLabel,
  fieldLabel,
  placeholder,
  className,
  onAdd,
}: QuickAddProps) {
  const [title, setTitle] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const submit = (event: FormEvent) => {
    event.preventDefault();
    const value = title?.trim();
    if (!value || saving) return;
    setSaving(true);
    onAdd(value)
      .then(
        () => setTitle(''),
        () => undefined,
      )
      .finally(() => setSaving(false));
  };

  if (title === null) {
    return (
      <button
        className={`text-button ${className}`}
        aria-label={buttonLabel}
        onClick={() => setTitle('')}
      >
        {label}
      </button>
    );
  }
  return (
    <form className={`${className}-form`} onSubmit={submit}>
      <input
        autoFocus
        aria-label={fieldLabel}
        placeholder={placeholder}
        value={title}
        maxLength={500}
        onChange={(event) => setTitle(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === 'Escape') setTitle(null);
        }}
        onBlur={() => {
          if (!title.trim()) setTitle(null);
        }}
      />
    </form>
  );
}
