import { describe, it, expect } from 'vitest';
import { validateFieldValue } from './type-validators';
import type { FieldConfig } from '../types/field-config';

function makeConfig(overrides: Partial<FieldConfig>): FieldConfig {
  return {
    id: 'test',
    sfObject: 'Lead',
    fieldName: 'AI_Test__c',
    valueType: 'text',
    batchId: 'firmographic',
    instruction: 'test',
    writeMode: 'overwrite',
    ...overrides,
  };
}

describe('validateFieldValue', () => {
  it('should accept null values for all types', () => {
    for (const valueType of ['picklist', 'number', 'date'] as const) {
      const result = validateFieldValue(null, makeConfig({ valueType }));
      expect(result.cleanedValue).toBeNull();
      expect(result.errors).toEqual([]);
    }
  });

  // ── Picklist ──────────────────────────────────────────
  describe('picklist', () => {
    const config = makeConfig({ valueType: 'picklist', options: ['A', 'B', 'C'] });

    it('accepts valid option', () => {
      const r = validateFieldValue('A', config);
      expect(r.cleanedValue).toBe('A');
      expect(r.errors).toEqual([]);
      expect(r.safeToWrite).toBe(true);
    });

    it('rejects invalid option with null cleaned value', () => {
      const r = validateFieldValue('D', config);
      expect(r.cleanedValue).toBeNull();
      expect(r.errors).toHaveLength(1);
      expect(r.safeToWrite).toBe(false);
    });
  });

  // ── Multipicklist (strips invalid) ────────────────────
  describe('multipicklist', () => {
    const config = makeConfig({ valueType: 'multipicklist', options: ['X', 'Y', 'Z'] });

    it('accepts all-valid values', () => {
      const r = validateFieldValue('X;Y', config);
      expect(r.cleanedValue).toBe('X;Y');
      expect(r.errors).toEqual([]);
      expect(r.safeToWrite).toBe(true);
    });

    it('strips invalid values, keeps valid ones, warns', () => {
      const r = validateFieldValue('X;BOGUS;Y', config);
      expect(r.cleanedValue).toBe('X;Y');
      expect(r.errors).toHaveLength(1);
      expect(r.errors[0]).toContain('Stripped');
      expect(r.errors[0]).toContain('BOGUS');
      expect(r.safeToWrite).toBe(true);
    });

    it('rejects when all values are invalid', () => {
      const r = validateFieldValue('BOGUS;ALSOBAD', config);
      expect(r.cleanedValue).toBeNull();
      expect(r.errors).toHaveLength(1);
      expect(r.safeToWrite).toBe(false);
    });

    it('rejects empty string', () => {
      const r = validateFieldValue('', config);
      expect(r.cleanedValue).toBeNull();
      expect(r.errors).toHaveLength(1);
      expect(r.safeToWrite).toBe(false);
    });
  });

  // ── Text (truncates instead of rejecting) ─────────────
  describe('text', () => {
    it('accepts under max length', () => {
      const config = makeConfig({ valueType: 'text', validation: { maxLength: 10 } });
      const r = validateFieldValue('short', config);
      expect(r.cleanedValue).toBe('short');
      expect(r.errors).toEqual([]);
    });

    it('truncates when exceeding max length', () => {
      const config = makeConfig({ valueType: 'text', validation: { maxLength: 5 } });
      const r = validateFieldValue('too long text', config);
      expect(r.cleanedValue).toBe('too l');
      expect(r.errors[0]).toContain('truncated');
      expect(r.safeToWrite).toBe(true);
    });

    it('accepts any text without maxLength constraint', () => {
      const r = validateFieldValue('anything goes', makeConfig({ valueType: 'text' }));
      expect(r.cleanedValue).toBe('anything goes');
      expect(r.errors).toEqual([]);
    });
  });

  // ── Number ────────────────────────────────────────────
  describe('number', () => {
    it('accepts valid numbers', () => {
      const config = makeConfig({ valueType: 'number', validation: { min: 0, max: 100 } });
      expect(validateFieldValue('42', config).cleanedValue).toBe('42');
      expect(validateFieldValue('0', config).cleanedValue).toBe('0');
      expect(validateFieldValue('100', config).cleanedValue).toBe('100');
    });

    it('rejects non-numeric strings', () => {
      const r = validateFieldValue('abc', makeConfig({ valueType: 'number' }));
      expect(r.cleanedValue).toBeNull();
      expect(r.errors[0]).toContain('not a valid number');
    });

    it('rejects below minimum', () => {
      const config = makeConfig({ valueType: 'number', validation: { min: 0, max: 10 } });
      const r = validateFieldValue('-1', config);
      expect(r.cleanedValue).toBeNull();
      expect(r.errors[0]).toContain('below minimum');
    });

    it('rejects above maximum', () => {
      const config = makeConfig({ valueType: 'number', validation: { min: 0, max: 10 } });
      const r = validateFieldValue('11', config);
      expect(r.cleanedValue).toBeNull();
      expect(r.errors[0]).toContain('exceeds maximum');
    });

    it('accepts decimals', () => {
      const config = makeConfig({ valueType: 'number', validation: { min: 0, max: 100 } });
      expect(validateFieldValue('42.5', config).cleanedValue).toBe('42.5');
    });
  });

  // ── Date ──────────────────────────────────────────────
  describe('date', () => {
    const config = makeConfig({ valueType: 'date', validation: { dateFormat: 'YYYY-MM-DD' } });

    it('accepts valid YYYY-MM-DD', () => {
      expect(validateFieldValue('2026-04-14', config).cleanedValue).toBe('2026-04-14');
    });

    it('rejects invalid format', () => {
      expect(validateFieldValue('04/14/2026', config).cleanedValue).toBeNull();
    });

    it('rejects partial date', () => {
      expect(validateFieldValue('2026-04', config).cleanedValue).toBeNull();
    });
  });

  // ── Datetime ──────────────────────────────────────────
  describe('datetime', () => {
    const config = makeConfig({ valueType: 'datetime', validation: { dateFormat: 'YYYY-MM-DDTHH:MM:SSZ' } });

    it('accepts valid YYYY-MM-DDTHH:MM:SSZ', () => {
      expect(validateFieldValue('2026-04-14T10:30:00Z', config).cleanedValue).toBe('2026-04-14T10:30:00Z');
    });

    it('accepts numeric offset and normalizes to UTC Z', () => {
      // 2026-01-02T10:57:48-05:00 == 2026-01-02T15:57:48Z
      expect(validateFieldValue('2026-01-02T10:57:48-05:00', config).cleanedValue)
        .toBe('2026-01-02T15:57:48Z');
    });

    it('accepts +HHMM offset (no colon)', () => {
      expect(validateFieldValue('2026-04-14T16:00:00+0530', config).cleanedValue)
        .toBe('2026-04-14T10:30:00Z');
    });

    it('strips fractional seconds when normalizing', () => {
      expect(validateFieldValue('2026-04-14T10:30:00.123Z', config).cleanedValue)
        .toBe('2026-04-14T10:30:00Z');
    });

    it('rejects without timezone suffix', () => {
      expect(validateFieldValue('2026-04-14T10:30:00', config).cleanedValue).toBeNull();
    });

    it('rejects date-only format', () => {
      expect(validateFieldValue('2026-04-14', config).cleanedValue).toBeNull();
    });
  });

  // ── Boolean ───────────────────────────────────────────
  describe('boolean', () => {
    const config = makeConfig({ valueType: 'boolean' });

    it('accepts "true" and "false"', () => {
      expect(validateFieldValue('true', config).cleanedValue).toBe('true');
      expect(validateFieldValue('false', config).cleanedValue).toBe('false');
    });

    it('accepts case-insensitive (normalizes to lowercase)', () => {
      expect(validateFieldValue('True', config).cleanedValue).toBe('true');
      expect(validateFieldValue('FALSE', config).cleanedValue).toBe('false');
    });

    it('rejects non-boolean strings', () => {
      expect(validateFieldValue('yes', config).cleanedValue).toBeNull();
    });
  });
});
