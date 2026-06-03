'use client';

import { createContext, useContext, type ReactNode } from 'react';
import { FULL_PERMISSIONS, type Permissions } from '@/lib/permissions';

type AuthSnapshot = {
  userId: string | null;
  email: string | null;
  orgId: string | null;
  permissions: Permissions;
};

type AuthState = { status: 'authed'; data: AuthSnapshot };

/**
 * Single-user / no-login build: the client is always "authed" with full
 * permissions. Kept as a context provider so components that read
 * `usePermissions()` / `useAuth()` continue to work unchanged.
 */
const STATIC_STATE: AuthState = {
  status: 'authed',
  data: { userId: null, email: null, orgId: null, permissions: FULL_PERMISSIONS },
};

const AuthContext = createContext<AuthState>(STATIC_STATE);

export function AuthProvider({ children }: { children: ReactNode }) {
  return <AuthContext.Provider value={STATIC_STATE}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  return useContext(AuthContext);
}

export function usePermissions(): Permissions {
  return useContext(AuthContext).data.permissions;
}
