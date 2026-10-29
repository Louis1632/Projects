import type { ReactNode } from 'react';
import { Navigate, useLocation } from 'react-router';
import type { SessionUser } from '@tido/contracts';
import { useSession } from '../../lib/queries';

export function Brand() {
  return (
    <div className="brand">
      <span className="brand-mark" aria-hidden="true">
        ✓
      </span>
      <span>TiDo</span>
    </div>
  );
}

export function LoadingPage({ message = 'Preparing your workspace…' }: { message?: string }) {
  return (
    <div className="loading-page" role="status">
      <Brand />
      <p>{message}</p>
    </div>
  );
}

export function RequireSession({ children }: { children: ReactNode }) {
  const session = useSession();
  const location = useLocation();
  if (session.isPending) return <LoadingPage />;
  if (session.isError) {
    return (
      <LoadingPage message="TiDo could not reach its server. Check that the API is running." />
    );
  }
  if (!session.data) return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  return children;
}

/** The signed-in user; only valid beneath <RequireSession>. */
export function useCurrentUser(): SessionUser {
  const session = useSession();
  if (!session.data) throw new Error('useCurrentUser used outside RequireSession');
  return session.data;
}

export function OwnerOnly({ children }: { children: ReactNode }) {
  const user = useCurrentUser();
  if (user.role !== 'owner') return <Navigate to="/tasks" replace />;
  return children;
}
