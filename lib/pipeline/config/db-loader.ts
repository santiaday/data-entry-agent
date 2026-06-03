/**
 * Load field configs from the database, seeding from the code constants
 * on first run per-org. This lets users edit field configs from the UI
 * without losing the ability to recover the default set.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import type { FieldConfig, SfObject, ValueType, WriteMode } from '../types/field-config';
import { FIELD_CONFIGS as CODE_FIELD_CONFIGS } from './field-configs';

type DbRow = {
  id: string;
  config_id: string;
  sf_object: string;
  field_name: string;
  value_type: string;
  batch_id: string;
  instruction: string;
  write_mode: string;
  options: string[] | null;
  validation: {
    maxLength?: number;
    min?: number;
    max?: number;
    dateFormat?: 'YYYY-MM-DD' | 'YYYY-MM-DDTHH:MM:SSZ';
  } | null;
  is_active: boolean;
};

/**
 * Load all ACTIVE field configs for an org.
 * If the org has zero rows, seed from the code defaults first.
 */
export async function loadFieldConfigs(
  supabase: SupabaseClient,
  orgId: string,
): Promise<readonly FieldConfig[]> {
  // Check if the org already has configs
  const { data: existing, error } = await supabase
    .from('de_field_configs')
    .select('id, config_id, sf_object, field_name, value_type, batch_id, instruction, write_mode, options, validation, is_active')
    .eq('org_id', orgId);

  if (error) {
    throw new Error(`Failed to load field configs: ${error.message}`);
  }

  if (!existing || existing.length === 0) {
    console.log(`[data-entry] Seeding ${CODE_FIELD_CONFIGS.length} field configs for org ${orgId}`);
    await seedFromCode(supabase, orgId);
    return loadFieldConfigs(supabase, orgId);
  }

  return (existing as DbRow[])
    .filter((row) => row.is_active)
    .map(rowToFieldConfig);
}

/**
 * Insert all code-default FIELD_CONFIGS as seed data for this org.
 * Idempotent via UNIQUE(org_id, config_id) — safe to call multiple times.
 */
export async function seedFromCode(
  supabase: SupabaseClient,
  orgId: string,
): Promise<void> {
  const rows = CODE_FIELD_CONFIGS.map((config) => ({
    org_id: orgId,
    config_id: config.id,
    sf_object: config.sfObject,
    field_name: config.fieldName,
    value_type: config.valueType,
    batch_id: config.batchId,
    instruction: config.instruction,
    write_mode: config.writeMode,
    options: config.options ? [...config.options] : null,
    validation: config.validation ?? null,
    is_active: true,
  }));

  // Upsert on (org_id, config_id) to handle re-seeding gracefully
  const { error } = await supabase
    .from('de_field_configs')
    .upsert(rows, { onConflict: 'org_id,config_id', ignoreDuplicates: true });

  if (error) {
    throw new Error(`Failed to seed field configs: ${error.message}`);
  }
}

function rowToFieldConfig(row: DbRow): FieldConfig {
  return {
    id: row.config_id,
    sfObject: row.sf_object as SfObject,
    fieldName: row.field_name,
    valueType: row.value_type as ValueType,
    batchId: row.batch_id,
    instruction: row.instruction,
    writeMode: row.write_mode as WriteMode,
    options: row.options ?? undefined,
    validation: row.validation ?? undefined,
  };
}
