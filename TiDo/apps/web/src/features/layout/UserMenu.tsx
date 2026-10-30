import { useEffect, useId, useRef, useState } from 'react';
import { Link } from 'react-router';
import type { SessionUser } from '@tido/contracts';

/** The signed-in person at the foot of the sidebar; it opens upwards into account and sign out. */
export function UserMenu({
  user,
  onNavigate,
  onSignOut,
}: {
  user: SessionUser;
  onNavigate: () => void;
  onSignOut: () => void;
}) {
  const id = useId();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const away = (event: PointerEvent) => {
      if (!ref.current?.contains(event.target as Node)) setOpen(false);
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };
    document.addEventListener('pointerdown', away);
    document.addEventListener('keydown', escape);
    return () => {
      document.removeEventListener('pointerdown', away);
      document.removeEventListener('keydown', escape);
    };
  }, [open]);

  return (
    <div className="user-menu" ref={ref}>
      {open && (
        <div className="account-menu" id={id}>
          <Link
            to="/account"
            onClick={() => {
              setOpen(false);
              onNavigate();
            }}
          >
            Account settings
          </Link>
          <button onClick={onSignOut}>Sign out</button>
        </div>
      )}
      <button
        className="user-button"
        aria-expanded={open}
        aria-controls={id}
        onClick={() => setOpen((current) => !current)}
      >
        <span className="avatar" aria-hidden="true">
          {user.displayName.slice(0, 1).toUpperCase()}
        </span>
        <span className="user-details">
          <strong>{user.displayName}</strong>
          <small>{user.role === 'owner' ? 'Workspace owner' : 'Member'}</small>
        </span>
        <span className="user-caret" aria-hidden="true">
          ⌃
        </span>
      </button>
    </div>
  );
}
