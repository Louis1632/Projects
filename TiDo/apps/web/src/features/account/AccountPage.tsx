import { useQueryClient } from '@tanstack/react-query';
import { useState, type FormEvent } from 'react';
import { api, errorMessage } from '../../lib/api';
import { keys } from '../../lib/queries';
import { useShell } from '../layout/AppShell';

export function AccountPage() {
  const { user } = useShell();
  const client = useQueryClient();
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');
  const [message, setMessage] = useState<{ kind: 'error' | 'ok'; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (next.length < 12) return setMessage({ kind: 'error', text: 'Use at least 12 characters.' });
    if (next !== confirm)
      return setMessage({ kind: 'error', text: 'The new passwords do not match.' });
    setBusy(true);
    try {
      const session = await api.changePassword(current, next);
      client.setQueryData(keys.session, session);
      setCurrent('');
      setNext('');
      setConfirm('');
      setMessage({ kind: 'ok', text: 'Password changed. Other devices have been signed out.' });
    } catch (error) {
      setMessage({ kind: 'error', text: errorMessage(error) });
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="screen">
      <div className="screen-heading">
        <div>
          <p className="eyebrow">Your account</p>
          <h1>{user.displayName}</h1>
          <p>
            {user.email} · {user.role === 'owner' ? 'Workspace owner' : 'Member'} of{' '}
            {user.workspace.name}
          </p>
        </div>
      </div>
      <section className="section-card narrow">
        <h2>Change password</h2>
        {message && (
          <div
            className={message.kind === 'error' ? 'form-error' : 'form-success'}
            role={message.kind === 'error' ? 'alert' : 'status'}
          >
            {message.text}
          </div>
        )}
        <form className="stacked-form" onSubmit={(event) => void submit(event)}>
          <label>
            Current password
            <input
              type="password"
              autoComplete="current-password"
              value={current}
              onChange={(event) => setCurrent(event.target.value)}
            />
          </label>
          <label>
            New password <span className="field-hint">At least 12 characters</span>
            <input
              type="password"
              autoComplete="new-password"
              value={next}
              onChange={(event) => setNext(event.target.value)}
            />
          </label>
          <label>
            Confirm new password
            <input
              type="password"
              autoComplete="new-password"
              value={confirm}
              onChange={(event) => setConfirm(event.target.value)}
            />
          </label>
          <button className="primary-button" disabled={busy}>
            {busy ? 'Saving…' : 'Change password'}
          </button>
        </form>
      </section>
    </section>
  );
}
