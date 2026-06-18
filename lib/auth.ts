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

import { timingSafeEqual } from 'node:crypto';
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

// Safe default is READ-ONLY. Editor-for-everyone is an explicit single-tenant
// opt-in (small leadership team behind the shared-password / ingress gate).
function defaultRole(): 'editor' | 'viewer' {
  return process.env.REVOPS_DEFAULT_ROLE === 'editor' ? 'editor' : 'viewer';
}

function constantTimeEq(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ab.length !== bb.length) return false;
  return timingSafeEqual(ab, bb);
}

/**
 * Is the inbound identity header trustworthy? A bare forwarded header is
 * client-forgeable, so we only trust it when provenance is established:
 *   - REVOPS_INGRESS_SECRET set → require a matching x-ingress-secret header
 *     (the ingress adds it; clients can't), OR
 *   - REVOPS_IDENTITY_TRUSTED=true → explicit operator assertion that the
 *     ingress strips client-supplied identity headers and sets its own.
 * Otherwise identity is NOT trusted for role decisions.
 */
function identityTrusted(h: Headers): boolean {
  const secret = process.env.REVOPS_INGRESS_SECRET;
  if (secret) {
    const headerName = process.env.REVOPS_INGRESS_SECRET_HEADER ?? 'x-ingress-secret';
    const got = h.get(headerName) ?? '';
    return got.length > 0 && constantTimeEq(got, secret);
  }
  return process.env.REVOPS_IDENTITY_TRUSTED === 'true';
}

async function resolveEmail(): Promise<{ email: string | null; trusted: boolean }> {
  try {
    const h = await headers();
    const custom = process.env.REVOPS_USER_HEADER;
    const candidates = [custom, 'x-deploybay-user', 'x-forwarded-email', 'x-auth-request-email', 'x-user-email']
      .filter(Boolean) as string[];
    let email: string | null = null;
    for (const name of candidates) {
      const v = h.get(name);
      if (v && v.includes('@')) { email = v.trim().toLowerCase(); break; }
    }
    return { email, trusted: identityTrusted(h) };
  } catch {
    // headers() unavailable outside a request scope.
    return { email: null, trusted: false };
  }
}

export async function getAuthContext(): Promise<AuthContext> {
  const { email, trusted } = await resolveEmail();
  // A forged (untrusted) identity header is used for NOTHING privilege-bearing —
  // it neither attributes nor grants. Only a trusted identity participates in
  // role resolution; everyone else falls to the (read-only-by-default) role.
  const trustedEmail = trusted ? email : null;
  const editors = editorEmails();
  let role: 'editor' | 'viewer';
  if (trustedEmail && editors.size > 0) {
    role = editors.has(trustedEmail) ? 'editor' : 'viewer';
  } else {
    role = defaultRole();
  }
  return {
    userId: trustedEmail,
    email: trustedEmail,
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
