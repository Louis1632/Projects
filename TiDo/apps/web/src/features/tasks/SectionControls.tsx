import { useId, useRef, useState, type FormEvent } from 'react';

/** A section's name; clicking it turns it into a field so the section can be renamed. */
export function SectionName({
  name,
  onRename,
  onEditingChange,
}: {
  name: string;
  onRename: (name: string) => Promise<unknown>;
  onEditingChange: (editing: boolean) => void;
}) {
  const id = useId();
  const [draft, setDraft] = useState<string | null>(null);
  // Enter, Escape and the blur that follows can all try to close the field; only the first counts.
  const closed = useRef(false);
  const edit = (value: string | null) => {
    setDraft(value);
    onEditingChange(value !== null);
  };
  const close = (keep: boolean) => {
    if (closed.current) return;
    closed.current = true;
    const value = draft?.trim();
    edit(null);
    if (keep && value && value !== name) void onRename(value);
  };

  if (draft === null) {
    return (
      <h3>
        <button
          className="section-name"
          title="Rename section"
          aria-label={`Rename section ${name}`}
          onClick={() => {
            closed.current = false;
            edit(name);
          }}
        >
          {name}
        </button>
      </h3>
    );
  }
  return (
    <form
      className="section-rename"
      onSubmit={(event) => {
        event.preventDefault();
        close(true);
      }}
    >
      <label className="sr-only" htmlFor={id}>
        Section name
      </label>
      <input
        id={id}
        autoFocus
        value={draft}
        maxLength={120}
        onChange={(event) => setDraft(event.target.value)}
        onBlur={() => close(true)}
        onKeyDown={(event) => {
          if (event.key === 'Escape') close(false);
        }}
      />
    </form>
  );
}

/** The "+" tile after a list's last column; it opens into a small form for the new name. */
export function AddSection({ onAdd }: { onAdd: (name: string) => Promise<unknown> }) {
  const id = useId();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  const close = () => {
    setOpen(false);
    setName('');
  };
  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (!name.trim()) return;
    void onAdd(name.trim()).then(close);
  };

  if (!open) {
    return (
      <button
        className="add-section-tile"
        aria-label="Add section"
        title="Add section"
        onClick={() => setOpen(true)}
      >
        +
      </button>
    );
  }
  return (
    <form className="section-card add-section-form" onSubmit={submit}>
      <label className="sr-only" htmlFor={id}>
        New section name
      </label>
      <input
        id={id}
        autoFocus
        value={name}
        onChange={(event) => setName(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === 'Escape') close();
        }}
        placeholder="Section name"
        maxLength={120}
      />
      <div className="add-section-actions">
        <button type="button" className="text-button" onClick={close}>
          Cancel
        </button>
        <button className="primary-button" disabled={!name.trim()}>
          Add section
        </button>
      </div>
    </form>
  );
}
