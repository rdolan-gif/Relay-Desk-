import { useQuery, useQueryClient } from '@tanstack/react-query';
import { createContext, useContext, type ReactNode } from 'react';
import { checkModuleAccess, type ModuleKey, type Verb } from '@relay-desk/domain';
import { ApiError, api, setCsrfToken } from './api';
import type { Me } from './types';

interface AuthState {
  me: Me | null;
  loading: boolean;
  refresh: () => Promise<void>;
  /** UI convenience only; the API enforces the same rule. */
  can: (module: ModuleKey, verb: Verb) => boolean;
}

const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const qc = useQueryClient();
  const query = useQuery({
    queryKey: ['me'],
    queryFn: async () => {
      try {
        const me = await api<Me>('GET', '/auth/me');
        setCsrfToken(me.csrfToken);
        return me;
      } catch (err) {
        if (err instanceof ApiError && err.status === 401) return null;
        throw err;
      }
    },
    retry: false,
  });
  const me = query.data ?? null;
  const value: AuthState = {
    me,
    loading: query.isLoading,
    refresh: async () => {
      await qc.invalidateQueries({ queryKey: ['me'] });
    },
    can: (module, verb) =>
      !!me &&
      checkModuleAccess({ userId: me.user.id, type: me.user.type, isActive: true, access: me.access }, module, verb)
        .allowed,
  };
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth outside AuthProvider');
  return ctx;
}
