import { describe, it, expect } from 'vitest';
import { FIELD_CONFIGS, getFieldsByBatch, getFieldsByObject } from './field-configs';
import { BATCH_CONFIGS } from './batches';

describe('field-configs', () => {
  it('should have no duplicate IDs', () => {
    const ids = FIELD_CONFIGS.map((f) => f.id);
    const uniqueIds = new Set(ids);
    expect(uniqueIds.size).toBe(ids.length);
  });

  it('should have no duplicate fieldName+sfObject combinations', () => {
    const keys = FIELD_CONFIGS.map((f) => `${f.sfObject}.${f.fieldName}`);
    const uniqueKeys = new Set(keys);
    expect(uniqueKeys.size).toBe(keys.length);
  });

  it('should have valid batchIds referencing defined batches', () => {
    const validBatchIds = new Set<string>(BATCH_CONFIGS.map((b) => b.batchId));
    for (const field of FIELD_CONFIGS) {
      expect(validBatchIds.has(field.batchId)).toBe(true);
    }
  });

  it('should have only valid sfObject values', () => {
    for (const field of FIELD_CONFIGS) {
      expect(['Lead', 'Opportunity']).toContain(field.sfObject);
    }
  });

  it('should have only valid valueType values', () => {
    const validTypes = ['picklist', 'multipicklist', 'text', 'textarea', 'number', 'date', 'datetime', 'boolean'];
    for (const field of FIELD_CONFIGS) {
      expect(validTypes).toContain(field.valueType);
    }
  });

  it('should have options defined for picklist and multipicklist fields', () => {
    for (const field of FIELD_CONFIGS) {
      if (field.valueType === 'picklist' || field.valueType === 'multipicklist') {
        expect(field.options).toBeDefined();
        expect(field.options!.length).toBeGreaterThan(0);
      }
    }
  });

  it('should have non-empty instructions for all fields', () => {
    for (const field of FIELD_CONFIGS) {
      expect(field.instruction.trim().length).toBeGreaterThan(10);
    }
  });

  it('should have only valid writeMode values', () => {
    for (const field of FIELD_CONFIGS) {
      expect(['overwrite', 'fill_blank', 'append']).toContain(field.writeMode);
    }
  });

  it('should have dateFormat validation for date and datetime fields', () => {
    for (const field of FIELD_CONFIGS) {
      if (field.valueType === 'date' || field.valueType === 'datetime') {
        expect(field.validation?.dateFormat).toBeDefined();
      }
    }
  });

  it('should have min/max validation for number fields with bounded ranges', () => {
    const boundedFields = FIELD_CONFIGS.filter(
      (f) => f.valueType === 'number' && f.validation?.max !== undefined,
    );
    for (const field of boundedFields) {
      expect(field.validation!.min).toBeDefined();
      expect(field.validation!.max).toBeDefined();
      expect(field.validation!.max!).toBeGreaterThan(field.validation!.min!);
    }
  });

  it('should have 35 Lead fields', () => {
    const leadFields = getFieldsByObject('Lead');
    expect(leadFields.length).toBe(35);
  });

  it('should have 79 Opportunity fields', () => {
    // 77 shared/core + AI_Add_On_Notes__c + AI_Subscription_Loss_Reason__c
    const oppFields = getFieldsByObject('Opportunity');
    expect(oppFields.length).toBe(79);
  });

  it('should have 114 total field configs', () => {
    expect(FIELD_CONFIGS.length).toBe(114);
  });

  it('should have fields in all 13 active batches', () => {
    // deal_strength batch has no fields yet
    const activeBatches = BATCH_CONFIGS.filter((b) => b.batchId !== 'deal_strength');
    for (const batch of activeBatches) {
      const fields = getFieldsByBatch(batch.batchId);
      expect(fields.length).toBeGreaterThan(0);
    }
  });

  it('should have all SF field names ending with __c (custom fields)', () => {
    for (const field of FIELD_CONFIGS) {
      expect(field.fieldName).toMatch(/__c$/);
    }
  });

  it('should have all SF field names starting with AI_ prefix', () => {
    for (const field of FIELD_CONFIGS) {
      expect(field.fieldName).toMatch(/^AI_/);
    }
  });
});

describe('batch-configs', () => {
  it('should have 14 batch definitions', () => {
    expect(BATCH_CONFIGS.length).toBe(14);
  });

  it('should have unique batchIds', () => {
    const ids = BATCH_CONFIGS.map((b) => b.batchId);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('should have non-empty labels', () => {
    for (const batch of BATCH_CONFIGS) {
      expect(batch.label.trim().length).toBeGreaterThan(0);
    }
  });

  it('should have at least one context section per batch', () => {
    for (const batch of BATCH_CONFIGS) {
      expect(batch.contextSections.length).toBeGreaterThan(0);
    }
  });

  it('should have positive maxTokens', () => {
    for (const batch of BATCH_CONFIGS) {
      expect(batch.maxTokens).toBeGreaterThan(0);
    }
  });
});
