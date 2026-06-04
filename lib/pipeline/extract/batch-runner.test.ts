import { describe, expect, it } from 'vitest';
import { selectApplicableFields } from './batch-runner';
import type { FieldConfig } from '../types/field-config';

// Minimal field configs — selectApplicableFields only reads sfObject/batchId/fieldName.
function field(sfObject: 'Lead' | 'Opportunity', batchId: string, fieldName: string): FieldConfig {
  return { sfObject, batchId, fieldName } as unknown as FieldConfig;
}

const CONFIGS: FieldConfig[] = [
  field('Lead', 'firmographic', 'Units__c'),
  field('Lead', 'firmographic', 'Persona__c'),
  field('Lead', 'timeline', 'GoLive__c'),
  field('Opportunity', 'firmographic', 'Units__c'),
  field('Opportunity', 'scoring', 'Fit_Score__c'),
];

const names = (fields: FieldConfig[]) => fields.map((f) => f.fieldName).sort();

describe('selectApplicableFields', () => {
  it('filters by object type with no other filters', () => {
    expect(names(selectApplicableFields(CONFIGS, 'Lead'))).toEqual(['GoLive__c', 'Persona__c', 'Units__c']);
    expect(names(selectApplicableFields(CONFIGS, 'Opportunity'))).toEqual(['Fit_Score__c', 'Units__c']);
  });

  it('restricts to specific field names', () => {
    expect(names(selectApplicableFields(CONFIGS, 'Lead', undefined, ['Persona__c']))).toEqual(['Persona__c']);
  });

  it('only matches field names within the chosen object', () => {
    // Units__c exists on both objects; scoping to Opportunity must not return the Lead one.
    const result = selectApplicableFields(CONFIGS, 'Opportunity', undefined, ['Units__c']);
    expect(result).toHaveLength(1);
    expect(result[0].sfObject).toBe('Opportunity');
  });

  it('restricts by batch group', () => {
    expect(names(selectApplicableFields(CONFIGS, 'Lead', ['firmographic']))).toEqual(['Persona__c', 'Units__c']);
  });

  it('intersects batch and field filters', () => {
    // timeline batch ∩ field allowlist that only names a firmographic field → empty
    expect(selectApplicableFields(CONFIGS, 'Lead', ['timeline'], ['Persona__c'])).toEqual([]);
    // firmographic ∩ Persona__c → just Persona__c
    expect(names(selectApplicableFields(CONFIGS, 'Lead', ['firmographic'], ['Persona__c']))).toEqual(['Persona__c']);
  });

  it('treats empty filter arrays as no restriction', () => {
    expect(names(selectApplicableFields(CONFIGS, 'Lead', [], []))).toEqual(['GoLive__c', 'Persona__c', 'Units__c']);
  });

  it('returns nothing for unknown field names', () => {
    expect(selectApplicableFields(CONFIGS, 'Lead', undefined, ['Nope__c'])).toEqual([]);
  });
});
