import { describe, it, expect } from 'vitest';
import { parseExtractionResponse } from './response-parser';
import type { FieldConfig } from '../types/field-config';

const mockFields: readonly FieldConfig[] = [
  {
    id: 'test_field_1',
    sfObject: 'Lead',
    fieldName: 'AI_Buyer_Persona__c',
    valueType: 'picklist',
    batchId: 'firmographic',
    instruction: 'Determine buyer persona',
    writeMode: 'overwrite',
    options: ['Property Owner', 'Property Manager'],
  },
  {
    id: 'test_field_2',
    sfObject: 'Lead',
    fieldName: 'AI_Expected_Units__c',
    valueType: 'number',
    batchId: 'firmographic',
    instruction: 'How many units',
    writeMode: 'overwrite',
    validation: { min: 0 },
  },
  {
    id: 'test_field_3',
    sfObject: 'Lead',
    fieldName: 'AI_Main_Challenges__c',
    valueType: 'textarea',
    batchId: 'discovery',
    instruction: 'Main challenges',
    writeMode: 'overwrite',
  },
];

describe('parseExtractionResponse', () => {
  it('should parse valid JSON with all fields', () => {
    const response = JSON.stringify({
      extractions: [
        {
          fieldName: 'AI_Buyer_Persona__c',
          value: 'Property Owner',
          confidence: 'high',
          evidence: 'They said "I own the building"',
        },
        {
          fieldName: 'AI_Expected_Units__c',
          value: 42,
          confidence: 'medium',
          evidence: 'Mentioned 42 units in the call',
        },
        {
          fieldName: 'AI_Main_Challenges__c',
          value: 'Manual rent collection',
          confidence: 'high',
          evidence: 'Discussed pain points',
        },
      ],
    });

    const results = parseExtractionResponse(response, mockFields);

    expect(results).toHaveLength(3);
    expect(results[0]).toEqual({
      fieldName: 'AI_Buyer_Persona__c',
      value: 'Property Owner',
      confidence: 'high',
      evidence: 'They said "I own the building"',
    });
    expect(results[1].value).toBe('42'); // Number coerced to string
    expect(results[1].confidence).toBe('medium');
  });

  it('should handle null values', () => {
    const response = JSON.stringify({
      extractions: [
        {
          fieldName: 'AI_Buyer_Persona__c',
          value: null,
          confidence: 'low',
          evidence: 'Not mentioned in conversations',
        },
      ],
    });

    const results = parseExtractionResponse(response, mockFields);
    expect(results).toHaveLength(1);
    expect(results[0].value).toBeNull();
  });

  it('should treat "N/A" and "null" strings as null', () => {
    const response = JSON.stringify({
      extractions: [
        { fieldName: 'AI_Buyer_Persona__c', value: 'N/A', confidence: 'low', evidence: '' },
        { fieldName: 'AI_Expected_Units__c', value: 'null', confidence: 'low', evidence: '' },
        { fieldName: 'AI_Main_Challenges__c', value: '', confidence: 'low', evidence: '' },
      ],
    });

    const results = parseExtractionResponse(response, mockFields);
    expect(results[0].value).toBeNull();
    expect(results[1].value).toBeNull();
    expect(results[2].value).toBeNull();
  });

  it('should handle boolean values', () => {
    const boolField: FieldConfig = {
      id: 'test_bool',
      sfObject: 'Opportunity',
      fieldName: 'AI_Was_AI_Demoed__c',
      valueType: 'boolean',
      batchId: 'planning',
      instruction: 'Was AI demoed?',
      writeMode: 'overwrite',
    };

    const response = JSON.stringify({
      extractions: [
        { fieldName: 'AI_Was_AI_Demoed__c', value: true, confidence: 'high', evidence: 'Demo notes' },
      ],
    });

    const results = parseExtractionResponse(response, [boolField]);
    expect(results[0].value).toBe('true');
  });

  it('should return empty array for malformed JSON', () => {
    const results = parseExtractionResponse('not json at all', mockFields);
    expect(results).toEqual([]);
  });

  it('should return empty array for missing extractions key', () => {
    const results = parseExtractionResponse('{"data": []}', mockFields);
    expect(results).toEqual([]);
  });

  it('should skip fields not in the expected list', () => {
    const response = JSON.stringify({
      extractions: [
        { fieldName: 'AI_Buyer_Persona__c', value: 'Property Owner', confidence: 'high', evidence: '' },
        { fieldName: 'AI_Unknown_Field__c', value: 'something', confidence: 'high', evidence: '' },
      ],
    });

    const results = parseExtractionResponse(response, mockFields);
    expect(results).toHaveLength(1);
    expect(results[0].fieldName).toBe('AI_Buyer_Persona__c');
  });

  it('should default to low confidence for invalid values', () => {
    const response = JSON.stringify({
      extractions: [
        { fieldName: 'AI_Buyer_Persona__c', value: 'Property Owner', confidence: 'very_high', evidence: '' },
        { fieldName: 'AI_Expected_Units__c', value: 10, confidence: null, evidence: '' },
      ],
    });

    const results = parseExtractionResponse(response, mockFields);
    expect(results[0].confidence).toBe('low');
    expect(results[1].confidence).toBe('low');
  });

  it('should skip entries with missing fieldName', () => {
    const response = JSON.stringify({
      extractions: [
        { value: 'Property Owner', confidence: 'high', evidence: '' },
        { fieldName: '', value: 'test', confidence: 'high', evidence: '' },
      ],
    });

    const results = parseExtractionResponse(response, mockFields);
    expect(results).toHaveLength(0);
  });

  it('should trim whitespace from string values', () => {
    const response = JSON.stringify({
      extractions: [
        { fieldName: 'AI_Main_Challenges__c', value: '  Manual rent collection  ', confidence: 'high', evidence: '' },
      ],
    });

    const results = parseExtractionResponse(response, mockFields);
    expect(results[0].value).toBe('Manual rent collection');
  });
});
