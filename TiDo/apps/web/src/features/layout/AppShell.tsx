import { useQueryClient } from '@tanstack/react-query';
import { useEffect, useState, type FormEvent } from 'react';
import { Link, NavLink, Outlet, useMatch, useNavigate, useOutletContext } from 'react-router';
import type { Project, SessionUser, Subtask, Task } from '@tido/contracts';
import { api } from '../../lib/api';
import { todayIn } from '../../lib/dates';
import { invalidateWorkspace, useDashboard, useWorkspaceMutation } from '../../lib/queries';
import { buildInfo, useNewerBuildAvailable, useVersionSeen } from '../about/version';
import { Brand, LoadingPage, useCurrentUser } from '../auth/RequireSession';
import { TaskEditor } from '../tasks/TaskEditor';
import { isPhone, useNavOpen } from './nav';
import { ThemeSwitch } from './ThemeSwitch';
import { UserMenu } from './UserMenu';

export type EditorTarget =
  { mode: 'create'; sectionId?: string; dueDate?: string } | { mode: 'edit'; task: Task | Subtask };

/** A short-lived message at the foot of the screen, optionally with an action such as Undo. */
export interface Toast {
  message: string;
  action?: { label: string; run: () => Promise<unknown> };
}

export interface ShellContext {
  user: SessionUser;
  today: string;
  openEditor: (target: EditorTarget) => void;
  notify: (message: string) => void;
  announce: (toast: Toast) => void;
  markVersionSeen: () => void;
}

export const useShell = () => useOutletContext<ShellContext>();

export function AppShell() {
  const user = useCurrentUser();
  const dashboard = useDashboard();
  const client = useQueryClient();
  const navigate = useNavigate();
  const [editor, setEditor] = useState<EditorTarget | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [toast, setToast] = useState<Toast | null>(null);
  const [newList, setNewList] = useState('');
  const [navOpen, setNavOpen] = useNavOpen();
  const today = todayIn(user.workspace.timezone);
  const version = useVersionSeen();
  const newerBuild = useNewerBuildAvailable();

  const createList = useWorkspaceMutation((name: string) => api.createProject(name));
  const archiveList = useWorkspaceMutation((project: Project) =>
    api.updateProject(project.id, { archived: true, revision: project.revision }),
  );
  const openList = useMatch('/projects/:projectId')?.params.projectId;

  useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(() => setToast(null), 6000);
    return () => window.clearTimeout(timer);
  }, [toast]);

  const runToastAction = async (action: NonNullable<Toast['action']>) => {
    setToast(null);
    try {
      await action.run();
    } catch (error) {
      setNotice(error instanceof Error ? error.message : 'Could not undo that.');
    }
    await invalidateWorkspace(client);
  };

  const logout = async () => {
    try {
      await api.logout();
    } finally {
      client.clear();
      navigate('/login', { replace: true });
    }
  };

  const submitList = async (event: FormEvent) => {
    event.preventDefault();
    if (!newList.trim()) return;
    try {
      const project = await createList.mutateAsync(newList.trim());
      setNewList('');
      navigate(`/projects/${project.id}`);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : 'Could not create the list.');
    }
  };

  const archive = async (project: Project) => {
    if (!window.confirm(`Archive "${project.name}"? Its tasks are kept but hidden.`)) return;
    try {
      await archiveList.mutateAsync(project);
      if (openList === project.id) navigate('/tasks');
    } catch (error) {
      setNotice(error instanceof Error ? error.message : 'Could not archive the list.');
    }
  };

  if (dashboard.isPending) return <LoadingPage />;
  if (dashboard.isError)
    return <LoadingPage message="TiDo could not load. Check that the API is running." />;

  const context: ShellContext = {
    user,
    today,
    openEditor: setEditor,
    notify: setNotice,
    announce: setToast,
    markVersionSeen: version.markSeen,
  };
  const navClass = ({ isActive }: { isActive: boolean }) =>
    isActive ? 'nav-item active' : 'nav-item';
  const listClass = ({ isActive }: { isActive: boolean }) =>
    isActive ? 'project-link active' : 'project-link';
  // On a phone the sidebar covers the page, so picking somewhere to go closes it.
  const closeMenu = () => {
    if (isPhone()) setNavOpen(false);
  };

  return (
    <div className={navOpen ? 'app-shell nav-open' : 'app-shell'}>
      <aside id="sidebar" className="sidebar" aria-label="Workspace navigation">
        <div className="sidebar-top">
          <Brand />
          <button
            className="icon-button menu-close"
            aria-label="Hide menu"
            title="Hide menu"
            aria-controls="sidebar"
            onClick={() => setNavOpen(false)}
          >
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path d="M15 6l-6 6 6 6" />
            </svg>
          </button>
        </div>
        <nav className="sidebar-body" onClick={closeMenu}>
          <NavLink className={navClass} to="/tasks" end>
            <span aria-hidden="true">☰</span> Tasks
          </NavLink>
          <NavLink className={navClass} to="/calendar">
            <span aria-hidden="true">▦</span> Calendar
          </NavLink>
          {user.role === 'owner' && (
            <NavLink className={navClass} to="/people">
              <span aria-hidden="true">♙</span> People
            </NavLink>
          )}
          <div className="sidebar-label">Lists</div>
          {dashboard.data.projects.map((project) => (
            <div className="project-item" key={project.id}>
              <NavLink className={listClass} to={`/projects/${project.id}`}>
                <span
                  className="project-dot"
                  style={{ background: project.color ?? 'var(--accent)' }}
                />
                {project.name}
              </NavLink>
              <button
                className="icon-button small project-archive"
                aria-label={`Archive ${project.name}`}
                title="Archive list"
                onClick={(event) => {
                  event.stopPropagation();
                  void archive(project);
                }}
              >
                <svg viewBox="0 0 24 24" aria-hidden="true">
                  <rect x="3" y="4" width="18" height="5" rx="1" />
                  <path d="M5 9v10a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V9M10 13h4" />
                </svg>
              </button>
            </div>
          ))}
        </nav>
        <form className="new-list-form" onSubmit={(event) => void submitList(event)}>
          <label className="sr-only" htmlFor="new-list">
            New list name
          </label>
          <input
            id="new-list"
            value={newList}
            onChange={(event) => setNewList(event.target.value)}
            placeholder="+ New list"
            maxLength={120}
          />
        </form>
        <div className="sidebar-spacer" />
        <ThemeSwitch />
        <Link to="/whats-new" className="version-link" onClick={closeMenu}>
          TiDo v{buildInfo.version}
          {version.unseen && (
            <>
              {' '}
              <span className="version-new">New</span>
            </>
          )}
        </Link>
        <UserMenu user={user} onNavigate={closeMenu} onSignOut={() => void logout()} />
      </aside>
      {navOpen && <div className="nav-backdrop" aria-hidden="true" onClick={closeMenu} />}

      <main className="main-content">
        <header className="topbar">
          {/* Hidden while the menu is open, which has its own ‹ to hide it again. */}
          <button
            className="icon-button menu-toggle"
            aria-label="Show menu"
            aria-controls="sidebar"
            aria-expanded={navOpen}
            onClick={() => setNavOpen(true)}
          >
            ☰
          </button>
        </header>

        {newerBuild && (
          <div className="update-banner" role="status">
            <span>A new version of TiDo is available.</span>
            <button className="secondary-button" onClick={() => window.location.reload()}>
              Reload
            </button>
          </div>
        )}
        {notice && (
          <div className="notice" role="alert">
            <span>{notice}</span>
            <button className="icon-button" onClick={() => setNotice(null)} aria-label="Dismiss">
              ×
            </button>
          </div>
        )}
        <Outlet context={context} />
      </main>

      {toast && (
        <div className="toast" role="status">
          <span>{toast.message}</span>
          {toast.action && (
            <button className="text-button" onClick={() => void runToastAction(toast.action!)}>
              {toast.action.label}
            </button>
          )}
        </div>
      )}

      {editor && (
        <TaskEditor
          key={editor.mode === 'edit' ? editor.task.id : 'new'}
          target={editor}
          dashboard={dashboard.data}
          today={today}
          onClose={() => setEditor(null)}
          onOpenTask={(task) => setEditor({ mode: 'edit', task })}
        />
      )}
    </div>
  );
}
