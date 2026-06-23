/**
 * Shared field-config constants.
 *
 * The create (POST /api/data-entry/fields) and update (PUT /api/data-entry/fields/[id])
 * schemas MUST accept the identical value_type set, otherwise a field can be edited
 * to a type it could never be created as (and vice-versa). Define the allowed set
 * once here and import it into both routes so they cannot drift.
 *
 * These must match the config.field_definitions.value_type check constraint.
 */

export const VALUE_TYPES = [
  'picklist',
  'multipicklist',
  'text',
  'textarea',
  'number',
  'currency',
  'date',
  'datetime',
  'boolean',
] as const;

export type ValueType = (typeof VALUE_TYPES)[number];

export const WRITE_MODES = ['overwrite', 'fill_blank', 'append'] as const;

export type WriteMode = (typeof WRITE_MODES)[number];
