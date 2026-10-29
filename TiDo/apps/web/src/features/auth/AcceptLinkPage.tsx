import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState, type FormEvent } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { api } from '../../lib/api';
import { keys } from '../../lib/queries';
import { Brand, LoadingPage } from './RequireSession';

export function AcceptLinkPage({ mode }: { mode: 'invite' | 'reset' }) {
  const { token = '' } = useParams();
  const client = useQueryClient();
  const navigate = useNavigate();
  const info = useQuery({
    queryKey: ['token', token],
    queryFn: () => api.tokenInfo(token),
    retry: false,
  });
  const [displayName, setDisplayName] = useState<string | null>(null);
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  if (info.isPending) return <LoadingPage message="Checking your link…" />;
  if (info.isError) {
    return (
      <main className="login-page">
        <section className="login-card">
          <Brand />
          <h1>Link unavailable</h1>
          <p>{info.error.message}</p>
          <p>Ask a workspace owner for a new link.</p>
          <Link className="text-button" to="/login">
            Go to sign in
          </Link>
        </section>
      </main>
    );
  }

  const isInvite = info.data.kind === 'invite';
  const name = displayName ?? info.data.displayName;
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (password.length < 12) return setError('Use at least 12 characters for your password.');
    if (password !== confirm) return setError('The passwords do not match.');
    setBusy(true);
    setError(null);
    try {
      const user = await api.acceptToken({
        token,
        password,
        displayName: isInvite ? name.trim() : undefined,
      });
      client.clear();
      client.setQueryData(keys.session, user);
      navigate('/tasks', { replace: true });
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Something went wrong.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <main className="login-page">
      <section className="login-card">
        <Brand />
        <h1>{isInvite ? 'Join your workspace' : 'Choose a new password'}</h1>
        <p>
          {isInvite ? 'Set up the account for ' : 'Resetting the password for '}
          <strong>{info.data.email}</strong>.
        </p>
        {mode === 'reset' && isInvite && (
          <p className="helper-copy">This link finishes your invitation.</p>
        )}
        {error && (
          <div className="form-error" role="alert">
            {error}
          </div>
        )}
        <form onSubmit={(event) => void submit(event)}>
          {isInvite && (
            <label>
              Your name
              <input
                value={name}
                autoComplete="name"
                onChange={(event) => setDisplayName(event.target.value)}
                required
              />
            </label>
          )}
          <label>
            New password <span className="field-hint">At least 12 characters</span>
            <input
              type="password"
              autoComplete="new-password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
            />
          </label>
          <label>
            Confirm password
            <input
              type="password"
              autoComplete="new-password"
              value={confirm}
              onChange={(event) => setConfirm(event.target.value)}
            />
          </label>
          <button className="primary-button full-width" disabled={busy}>
            {busy ? 'Saving…' : isInvite ? 'Create my account' : 'Save password'}
          </button>
        </form>
      </section>
    </main>
  );
}
