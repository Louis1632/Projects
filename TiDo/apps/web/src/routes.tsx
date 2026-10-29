import { Navigate, type RouteObject } from 'react-router';
import { WhatsNewPage } from './features/about/WhatsNewPage';
import { AccountPage } from './features/account/AccountPage';
import { AcceptLinkPage } from './features/auth/AcceptLinkPage';
import { LoginPage } from './features/auth/LoginPage';
import { OwnerOnly, RequireSession } from './features/auth/RequireSession';
import { CalendarPage } from './features/calendar/CalendarPage';
import { AppShell } from './features/layout/AppShell';
import { PeoplePage } from './features/people/PeoplePage';
import { TasksPage } from './features/tasks/TasksPage';

export const routes: RouteObject[] = [
  { path: '/login', element: <LoginPage /> },
  { path: '/invite/:token', element: <AcceptLinkPage mode="invite" /> },
  { path: '/reset/:token', element: <AcceptLinkPage mode="reset" /> },
  {
    path: '/',
    element: (
      <RequireSession>
        <AppShell />
      </RequireSession>
    ),
    children: [
      { index: true, element: <Navigate to="/tasks" replace /> },
      { path: 'tasks', element: <TasksPage /> },
      { path: 'projects/:projectId', element: <TasksPage /> },
      { path: 'calendar', element: <CalendarPage /> },
      {
        path: 'people',
        element: (
          <OwnerOnly>
            <PeoplePage />
          </OwnerOnly>
        ),
      },
      { path: 'account', element: <AccountPage /> },
      { path: 'whats-new', element: <WhatsNewPage /> },
    ],
  },
  { path: '*', element: <Navigate to="/tasks" replace /> },
];
