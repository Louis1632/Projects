import { useMutation, useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query';
import { api, ApiError } from './api';

export const keys = {
  session: ['session'] as const,
  dashboard: ['dashboard'] as const,
  calendar: (from: string, to: string) => ['calendar', from, to] as const,
  members: ['members'] as const,
};

export function useSession() {
  return useQuery({
    queryKey: keys.session,
    queryFn: async () => {
      try {
        return await api.session();
      } catch (error) {
        if (error instanceof ApiError && error.status === 401) return null;
        throw error;
      }
    },
    staleTime: 60_000,
    retry: false,
  });
}

export function useDashboard() {
  return useQuery({ queryKey: keys.dashboard, queryFn: api.dashboard, refetchInterval: 30_000 });
}

export function useCalendar(from: string, to: string) {
  return useQuery({ queryKey: keys.calendar(from, to), queryFn: () => api.calendar(from, to) });
}

/** Everything that shows tasks is refreshed after any change, keeping co-editors in sync. */
export function invalidateWorkspace(client: QueryClient) {
  return Promise.all([
    client.invalidateQueries({ queryKey: keys.dashboard }),
    client.invalidateQueries({ queryKey: ['calendar'] }),
    client.invalidateQueries({ queryKey: keys.members }),
    client.invalidateQueries({ queryKey: ['task'] }),
    client.invalidateQueries({ queryKey: ['completions'] }),
  ]);
}

export function useWorkspaceMutation<TInput, TResult>(fn: (input: TInput) => Promise<TResult>) {
  const client = useQueryClient();
  return useMutation({ mutationFn: fn, onSuccess: () => invalidateWorkspace(client) });
}
