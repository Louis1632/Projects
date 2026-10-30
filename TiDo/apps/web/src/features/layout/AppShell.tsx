import { useQueryClient } from '@tanstack/react-query';
import { useState, type FormEvent } from 'react';
import { Link, NavLink, Outlet, useMatch, useNavigate, useOutletContext } from 'react-router';
import type { Project, SessionUser, Subtask, Task } from '@tido/contracts';
import { api } from '../../lib/api';
import { todayIn } from '../../lib/dates';
import { useDashboard, useWorkspaceMutation } from '../../lib/queries';
import { buildInfo, useNewerBuildAvailable, useVersionSeen } from '../about/version';
import { Brand, LoadingPage, useCurrentUser } from '../auth/RequireSession';
import { TaskEditor } from '../tasks/TaskEditor';

export type EditorTarget =
  { mode: 'create'; sectionId?: string; dueDate?: string } | { mode: 'edit'; task: Task | Subtask };

export interface ShellContext {
  user: SessionUser;
  today: string;
  search: string;
  openEditor: (target: EditorTarget) => void;
  notify: (message: string) => void;
  markVersionSeen: () => void;
}

export const useShell = () => useOutletContext<ShellContext>();

export function AppShell() {
  const user = useCurrentUser();
  const dashboard = useDashboard();
  const client = useQueryClient();
  const navigate = useNavigate();
  const [search, setSearch] = useState('');
  const [editor, setEditor] = useState<EditorTarget | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [newList, setNewList] = useState('');
  const [menuOpen, setMenuOpen] = useState(false);
  const today = todayIn(user.workspace.timezone);
  const version = useVersionSeen();
  const newerBuild = useNewerBuildAvailable();

  const createList = useWorkspaceMutation((name: string) => api.createProject(name));
  const archiveList = useWorkspaceMutation((project: Project) =>
    api.updateProject(project.id, { archived: true, revision: project.revision }),
  );
  const openList = useMatch('/projects/:projectId')?.params.projectId;

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
    search,
    openEditor: setEditor,
    notify: setNotice,
    markVersionSeen: version.markSeen,
  };
  const navClass = ({ isActive }: { isActive: boolean }) =>
    isActive ? 'nav-item active' : 'nav-item';
  const listClass = ({ isActive }: { isActive: boolean }) =>
    isActive ? 'project-link active' : 'project-link';
  const closeMenu = () => setMenuOpen(false);

  return (
    <div className="app-shell">
      <aside className={menuOpen ? 'sidebar open' : 'sidebar'} aria-label="Workspace navigation">
        <div className="sidebar-top">
          <Brand />
          <button
            className="icon-button menu-toggle"
            aria-label={menuOpen ? 'Close menu' : 'Open menu'}
            aria-expanded={menuOpen}
            onClick={() => setMenuOpen((open) => !open)}
          >
            {menuOpen ? '×' : '☰'}
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
                  style={{ background: project.color ?? 'var(--teal)' }}
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
        <Link to="/whats-new" className="version-link" onClick={closeMenu}>
          TiDo v{buildInfo.version}
          {version.unseen && (
            <>
              {' '}
              <span className="version-new">New</span>
            </>
          )}
        </Link>
        <div className="user-menu">
          <div className="avatar" aria-hidden="true">
            {user.displayName.slice(0, 1).toUpperCase()}
          </div>
          <Link to="/account" className="user-details" onClick={closeMenu}>
            <strong>{user.displayName}</strong>
            <small>{user.role === 'owner' ? 'Workspace owner' : 'Member'}</small>
          </Link>
          <button
            className="icon-button"
            aria-label="Sign out"
            title="Sign out"
            onClick={() => void logout()}
          >
            ↪
          </button>
        </div>
      </aside>

      <main className="main-content">
        <header className="topbar">
          <label className="searchbox">
            <span aria-hidden="true">⌕</span>
            <span className="sr-only">Search tasks</span>
            <input
              type="search"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Search tasks"
            />
          </label>
          <button className="primary-button" onClick={() => setEditor({ mode: 'create' })}>
            + New task
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
