/**
 * Auth context.
 *
 * Outer gate: DeployBay's ingress grant (every app-subdomain request passes the
 * `auth_request` cookie handshake) and/or the optional shared-password gate
 * (`APP_ACCESS_PASSWORD`, see middleware.ts). Anyone reaching a route is already
 * past that gate.
 *
 * This layer adds ATTRIBUTION + ROLES on top:
 *   - A trusted identity header (set by DeployBay's ingress after grant, or a
 *     reverse proxy) names the acting user. Configurable via REVOPS_USER_HEADER;
 *     common forwarded-email headers are also checked.
 *   - Role resolution: if REVOPS_EDITOR_EMAILS is set AND we have a user email,
 *     editors get full data-entry control and everyone else is read-only.
 *     Otherwise every authenticated user gets REVOPS_DEFAULT_ROLE (default
 *     'editor' — single-tenant full control behind the shared-password gate).
 *
 * Every state-changing route enforces these server-side (the real boundary).
 * The resolved email flows into config/queue writes as the actor for audit.
 */

import { headers } from 'next/headers';
import { DEFAULT_ORG_ID } from '@/lib/constants';
import { EMPTY_PERMISSIONS, FULL_PERMISSIONS, type Permissions } from '@/lib/permissions';

export type AuthContext = {
  userId: string | null;
  email: string | null;
  orgId: string;
  role: 'editor' | 'viewer';
  permissions: Permissions;
};

/** Editor = full data-entry control (no cross-module admin). */
const EDITOR_PERMISSIONS: Permissions = FULL_PERMISSIONS;

/** Viewer = read + analytics only; cannot edit prompts/fields or trigger runs. */
const VIEWER_PERMISSIONS: Permissions = {
  ...EMPTY_PERMISSIONS,
  modules: {
    ...EMPTY_PERMISSIONS.modules,
    data_entry: {
      access: true,
      max_batch_size: 0,
      can_edit_fields: false,
      can_edit_prompts: false,
      can_view_analytics: true,
      can_run_batches: false,
    },
  },
};

function editorEmails(): Set<string> {
  return new Set(
    (process.env.REVOPS_EDITOR_EMAILS ?? '')
      .split(',')
      .map((s) => s.trim().toLowerCase())
      .filter(Boolean),
  );
}

function defaultRole(): 'editor' | 'viewer' {
  return process.env.REVOPS_DEFAULT_ROLE === 'viewer' ? 'viewer' : 'editor';
}

async function resolveEmail(): Promise<string | null> {
  try {
    const h = await headers();
    const custom = process.env.REVOPS_USER_HEADER;
    const candidates = [
      custom,
      'x-deploybay-user',
      'x-forwarded-email',
      'x-auth-request-email',
      'x-user-email',
    ].filter(Boolean) as string[];
    for (const name of candidates) {
      const v = h.get(name);
      if (v && v.includes('@')) return v.trim().toLowerCase();
    }
  } catch {
    // headers() unavailable outside a request scope — fall through to anon.
  }
  return null;
}

export async function getAuthContext(): Promise<AuthContext> {
  const email = await resolveEmail();
  const editors = editorEmails();
  let role: 'editor' | 'viewer';
  if (email && editors.size > 0) {
    role = editors.has(email) ? 'editor' : 'viewer';
  } else {
    role = defaultRole();
  }
  return {
    userId: email,
    email,
    orgId: DEFAULT_ORG_ID,
    role,
    permissions: role === 'editor' ? EDITOR_PERMISSIONS : VIEWER_PERMISSIONS,
  };
}

export async function requireAuth(): Promise<AuthContext> {
  return getAuthContext();
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
