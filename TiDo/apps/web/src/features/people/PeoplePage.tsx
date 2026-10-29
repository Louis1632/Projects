import { useState, type FormEvent } from 'react';
import type { AccountLink, Member, Role } from '@tido/contracts';
import { api, errorMessage } from '../../lib/api';
import { prettyDay } from '../../lib/dates';
import { useDashboard, useWorkspaceMutation } from '../../lib/queries';
import { useShell } from '../layout/AppShell';

function LinkResult({ title, link }: { title: string; link: AccountLink }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="invite-result" role="status">
      <strong>{title}</strong>
      <code>{link.url}</code>
      <small>
        Single use · expires {prettyDay(link.expiresAt.slice(0, 10))}. Share it through a trusted
        channel.
      </small>
      <button
        className="text-button"
        onClick={() =>
          void navigator.clipboard?.writeText(link.url).then(
            () => setCopied(true),
            () => setCopied(false),
          )
        }
      >
        {copied ? 'Copied' : 'Copy link'}
      </button>
    </div>
  );
}

export function PeoplePage() {
  const { user, notify } = useShell();
  const members = useDashboard().data!.members;
  const [email, setEmail] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [role, setRole] = useState<Role>('member');
  const [result, setResult] = useState<{ title: string; link: AccountLink } | null>(null);

  const invite = useWorkspaceMutation(api.invite);
  const reset = useWorkspaceMutation(api.resetLink);
  const deactivate = useWorkspaceMutation(api.deactivate);
  const reactivate = useWorkspaceMutation(api.reactivate);
  const setMemberRole = useWorkspaceMutation((input: { id: string; role: Role }) =>
    api.setRole(input.id, input.role),
  );

  const guard = async (work: () => Promise<unknown>) => {
    try {
      await work();
    } catch (error) {
      notify(errorMessage(error));
    }
  };

  const submitInvite = (event: FormEvent) => {
    event.preventDefault();
    void guard(async () => {
      const response = await invite.mutateAsync({ email, displayName, role });
      setResult({ title: `Invite link for ${response.member.displayName}`, link: response.link });
      setEmail('');
      setDisplayName('');
      setRole('member');
    });
  };

  const actions = (member: Member) => {
    if (member.id === user.id) return <span className="status-pill">You</span>;
    return (
      <span className="member-actions">
        {member.active && (
          <button
            className="text-button"
            onClick={() =>
              void guard(async () => {
                const link = await reset.mutateAsync(member.id);
                setResult({
                  title: member.pending
                    ? `New invite link for ${member.displayName}`
                    : `Password reset link for ${member.displayName}`,
                  link,
                });
              })
            }
          >
            {member.pending ? 'New invite link' : 'Reset password'}
          </button>
        )}
        {member.active && (
          <button
            className="text-button"
            onClick={() =>
              void guard(() =>
                setMemberRole.mutateAsync({
                  id: member.id,
                  role: member.role === 'owner' ? 'member' : 'owner',
                }),
              )
            }
          >
            {member.role === 'owner' ? 'Make member' : 'Make owner'}
          </button>
        )}
        {member.active ? (
          <button
            className="text-button danger"
            onClick={() => {
              if (
                window.confirm(
                  `Deactivate ${member.displayName}? They will be signed out everywhere.`,
                )
              ) {
                void guard(() => deactivate.mutateAsync(member.id));
              }
            }}
          >
            Deactivate
          </button>
        ) : (
          <button
            className="text-button"
            onClick={() => void guard(() => reactivate.mutateAsync(member.id))}
          >
            Reactivate
          </button>
        )}
      </span>
    );
  };

  return (
    <section className="screen">
      <div className="screen-heading">
        <div>
          <p className="eyebrow">Workspace owner</p>
          <h1>People</h1>
          <p>Every person has their own secure account; everyone can co-edit shared tasks.</p>
        </div>
      </div>
      <div className="people-layout">
        <section className="section-card">
          <h2>Members</h2>
          <div className="member-list">
            {members.map((member) => (
              <div className="member-row" key={member.id}>
                <div className="avatar" aria-hidden="true">
                  {member.displayName.slice(0, 1).toUpperCase()}
                </div>
                <div className="member-details">
                  <strong>{member.displayName}</strong>
                  <small>
                    {member.email} · {member.role}
                  </small>
                </div>
                <span
                  className={
                    member.active
                      ? member.pending
                        ? 'status-pill pending'
                        : 'status-pill'
                      : 'status-pill inactive'
                  }
                >
                  {member.active ? (member.pending ? 'Invited' : 'Active') : 'Inactive'}
                </span>
                {actions(member)}
              </div>
            ))}
          </div>
        </section>
        <section className="section-card">
          <h2>Invite someone</h2>
          <p className="helper-copy">
            The link expires after 7 days and lets the new member choose their own password. TiDo
            does not send email — share it yourself.
          </p>
          <form className="stacked-form" onSubmit={submitInvite}>
            <label>
              Name
              <input
                value={displayName}
                onChange={(event) => setDisplayName(event.target.value)}
                required
                maxLength={120}
              />
            </label>
            <label>
              Email
              <input
                type="email"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                required
              />
            </label>
            <label>
              Role
              <select value={role} onChange={(event) => setRole(event.target.value as Role)}>
                <option value="member">Member — can edit all tasks</option>
                <option value="owner">Owner — can also manage people</option>
              </select>
            </label>
            <button className="primary-button" disabled={invite.isPending}>
              {invite.isPending ? 'Creating…' : 'Create invite'}
            </button>
          </form>
          {result && <LinkResult title={result.title} link={result.link} />}
        </section>
      </div>
    </section>
  );
}
