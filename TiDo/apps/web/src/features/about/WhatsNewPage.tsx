import { useEffect } from 'react';
import { parseDay } from '../../lib/dates';
import { useShell } from '../layout/AppShell';
import { releases, type ChangeKind } from './releases';
import { buildInfo } from './version';

const kindLabel: Record<ChangeKind, string> = { new: 'New', improved: 'Improved', fixed: 'Fixed' };

const releaseDate = (day: string) =>
  new Intl.DateTimeFormat(undefined, { dateStyle: 'long', timeZone: 'UTC' }).format(parseDay(day));

export function WhatsNewPage() {
  const { markVersionSeen } = useShell();
  useEffect(() => markVersionSeen(), [markVersionSeen]);

  const builtAt = new Date(buildInfo.builtAt);
  return (
    <section className="screen">
      <div className="screen-heading">
        <div>
          <p className="eyebrow">TiDo {buildInfo.version}</p>
          <h1>What&apos;s new</h1>
          <p>
            Build <code>{buildInfo.revision.slice(0, 12)}</code>
            {!Number.isNaN(builtAt.getTime()) && (
              <>
                {' '}
                · built{' '}
                <time dateTime={buildInfo.builtAt}>
                  {new Intl.DateTimeFormat(undefined, {
                    dateStyle: 'medium',
                    timeStyle: 'short',
                  }).format(builtAt)}
                </time>
              </>
            )}
          </p>
        </div>
      </div>

      {releases.map((release) => (
        <article className="section-card release" key={release.version}>
          <header className="release-heading">
            <h2>Version {release.version}</h2>
            {release.version === buildInfo.version && (
              <span className="release-current">You&apos;re on this version</span>
            )}
            <time dateTime={release.date}>{releaseDate(release.date)}</time>
          </header>
          <p className="helper-copy">{release.summary}</p>
          <ul className="release-changes">
            {release.changes.map((change) => (
              <li key={change.text}>
                <span className={`change-kind ${change.kind}`}>{kindLabel[change.kind]}</span>
                <span>{change.text}</span>
              </li>
            ))}
          </ul>
        </article>
      ))}
    </section>
  );
}
