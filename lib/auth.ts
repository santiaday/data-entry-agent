/**
 * Auth context — single-user / no-login deployment.
 *
 * This standalone build has no authentication: anyone who can reach the app
 * has full access. `getAuthContext` therefore returns a fixed full-access
 * context bound to the single configured org. The shape is kept identical to
 * the original multi-user version so the rest of the code is unchanged — if
 * you ever reintroduce login, this is the only file (plus use-auth.tsx) that
 * needs to query real sessions/permissions again.
 *
 * `userId` is null on purpose: the de_* tables attribute rows to a user via a
 * nullable FK to auth.users, and there is no real user here.
 */

import { DEFAULT_ORG_ID } from '@/lib/constants';
import { FULL_PERMISSIONS, type Permissions } from '@/lib/permissions';

export type AuthContext = {
  userId: string | null;
  email: string | null;
  orgId: string;
  permissions: Permissions;
};

const CONTEXT: AuthContext = {
  userId: null,
  email: null,
  orgId: DEFAULT_ORG_ID,
  permissions: FULL_PERMISSIONS,
};

export async function getAuthContext(): Promise<AuthContext> {
  return CONTEXT;
}

export async function requireAuth(): Promise<AuthContext> {
  return CONTEXT;
}

export class UnauthorizedError extends Error {
  readonly status = 401;
  constructor() {
    super('Unauthorized');
  }
}

export class ForbiddenError extends Error {
  readonly status = 403;
  constructor(message = 'Forbidden') {
    super(message);
  }
}
