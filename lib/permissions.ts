/**
 * Shared permission schema used by server code and client hooks.
 *
 * Permissions are stored as a JSONB blob in public.user_permissions.permissions.
 * Missing keys are treated as "denied" by `resolvePermissions`, so a brand-new
 * user with an empty blob has no access to anything.
 */

export type DataEntryPerms = {
  access: boolean;
  max_batch_size: number | null; // null = unlimited
  can_edit_fields: boolean;
  can_edit_prompts: boolean;
  can_view_analytics: boolean;
  can_run_batches: boolean;
};

export type GtmPerms = {
  access: boolean;
  can_view_analytics: boolean;
};

export type BrainPerms = {
  access: boolean;
};

export type AutomationsPerms = {
  access: boolean;
  is_admin: boolean;       // can see ALL automations, manage all, view audit log
  can_create: boolean;     // can create/sync automations from Brain
  can_dispatch: boolean;   // can dispatch runs on own automations
};

export type Permissions = {
  is_admin: boolean;
  modules: {
    data_entry: DataEntryPerms;
    gtm: GtmPerms;
    brain: BrainPerms;
    automations: AutomationsPerms;
  };
};

export const EMPTY_PERMISSIONS: Permissions = {
  is_admin: false,
  modules: {
    data_entry: {
      access: false,
      max_batch_size: null,
      can_edit_fields: false,
      can_edit_prompts: false,
      can_view_analytics: false,
      can_run_batches: false,
    },
    gtm: {
      access: false,
      can_view_analytics: false,
    },
    brain: {
      access: false,
    },
    automations: {
      access: false,
      is_admin: false,
      can_create: false,
      can_dispatch: false,
    },
  },
};

/**
 * Full-access permissions. This is a single-user deployment with no login,
 * so every capability is granted. If you later reintroduce authentication,
 * swap this back to a per-user lookup via `resolvePermissions`.
 */
export const FULL_PERMISSIONS: Permissions = {
  is_admin: true,
  modules: {
    data_entry: {
      access: true,
      max_batch_size: null, // unlimited
      can_edit_fields: true,
      can_edit_prompts: true,
      can_view_analytics: true,
      can_run_batches: true,
    },
    gtm: { access: true, can_view_analytics: true },
    brain: { access: true },
    automations: { access: true, is_admin: true, can_create: true, can_dispatch: true },
  },
};

/** Normalize a raw JSONB blob into a fully-populated Permissions object. */
export function resolvePermissions(raw: unknown): Permissions {
  if (!raw || typeof raw !== 'object') return EMPTY_PERMISSIONS;
  const blob = raw as Record<string, unknown>;
  const modules = (blob.modules ?? {}) as Record<string, unknown>;
  const de = (modules.data_entry ?? {}) as Record<string, unknown>;
  const gtm = (modules.gtm ?? {}) as Record<string, unknown>;
  const brain = (modules.brain ?? {}) as Record<string, unknown>;
  const automations = (modules.automations ?? {}) as Record<string, unknown>;

  const bool = (v: unknown) => v === true;
  const num = (v: unknown) =>
    typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : null;

  return {
    is_admin: bool(blob.is_admin),
    modules: {
      data_entry: {
        access: bool(de.access),
        max_batch_size: num(de.max_batch_size),
        can_edit_fields: bool(de.can_edit_fields),
        can_edit_prompts: bool(de.can_edit_prompts),
        can_view_analytics: bool(de.can_view_analytics),
        can_run_batches: bool(de.can_run_batches),
      },
      gtm: {
        access: bool(gtm.access),
        can_view_analytics: bool(gtm.can_view_analytics),
      },
      brain: {
        access: bool(brain.access),
      },
      automations: {
        access: bool(automations.access),
        is_admin: bool(automations.is_admin),
        can_create: bool(automations.can_create),
        can_dispatch: bool(automations.can_dispatch),
      },
    },
  };
}
