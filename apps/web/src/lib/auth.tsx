import { useQuery, useQueryClient } from '@tanstack/react-query';
import { createContext, useContext, useMemo } from 'react';
import type { ReactNode } from 'react';
import { ApiError, api } from './api';

export interface MeResponse {
  admin: {
    id: string;
    username: string;
    email: string | null;
    role: string;
    roleLabelFa: string;
    totpEnabled: boolean;
    lastLoginAt: string | null;
    createdAt: string;
  };
  permissions: string[];
  csrfToken: string;
  settings: {
    panelName: string;
    language: string;
    theme: 'light' | 'dark' | 'system';
    calendar: 'jalali' | 'gregorian';
    timezone: string;
    edgeUrl: string;
    maintenanceMode: boolean;
    environment: string;
    version: string;
  };
}

export interface SetupStatus {
  completed: boolean;
  hasAdmin: boolean;
  environment: string;
  version: string;
  panelName: string;
  cloudflareConfigured: boolean;
  secretKeyConfigured: boolean;
}

interface AuthContextValue {
  me: MeResponse | null;
  loading: boolean;
  authenticated: boolean;
  can: (permission: string) => boolean;
  refresh: () => Promise<void>;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function useSetupStatus() {
  return useQuery({
    queryKey: ['setup-status'],
    queryFn: () => api.get<SetupStatus>('/setup/status'),
    staleTime: 0,
  });
}

export function AuthProvider({ children }: { children: ReactNode }): JSX.Element {
  const queryClient = useQueryClient();

  const query = useQuery({
    queryKey: ['me'],
    queryFn: () => api.get<MeResponse>('/auth/me'),
    retry: false,
  });

  const value = useMemo<AuthContextValue>(() => {
    const me = query.data ?? null;
    const unauthenticated = query.error instanceof ApiError && query.error.status === 401;
    return {
      me,
      loading: query.isLoading,
      authenticated: Boolean(me) && !unauthenticated,
      can: (permission: string) => Boolean(me?.permissions.includes(permission)),
      refresh: async () => {
        await queryClient.invalidateQueries({ queryKey: ['me'] });
      },
      logout: async () => {
        await api.post('/auth/logout');
        queryClient.clear();
        window.location.href = '/';
      },
    };
  }, [query.data, query.error, query.isLoading, queryClient]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const context = useContext(AuthContext);
  if (!context) throw new Error('useAuth باید داخل AuthProvider استفاده شود.');
  return context;
}
