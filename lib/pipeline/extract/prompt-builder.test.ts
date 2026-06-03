import { describe, it, expect } from 'vitest';
import { buildBatchPrompt, buildUnifiedPrompt, EXTRACTION_SYSTEM_PROMPT } from './prompt-builder';
import type { FieldConfig } from '../types/field-config';
import type { CompiledContext, CompiledSection } from '../types/pipeline';

const mockFields: readonly FieldConfig[] = [
  {
    id: 'test_1',
    sfObject: 'Lead',
    fieldName: 'AI_Buyer_Persona__c',
    valueType: 'picklist',
    batchId: 'firmographic',
    instruction: 'Determine buyer persona',
    writeMode: 'overwrite',
    options: ['Property Owner', 'Property Manager', 'Other'],
  },
  {
    id: 'test_2',
    sfObject: 'Lead',
    fieldName: 'AI_Expected_Units__c',
    valueType: 'number',
    batchId: 'firmographic',
    instruction: 'How many units?',
    writeMode: 'overwrite',
    validation: { min: 0, max: 10000 },
  },
];

function makeContext(sections: Record<string, string>): CompiledContext {
  const map = new Map<string, CompiledSection>();
  for (const [key, content] of Object.entries(sections)) {
    map.set(key, { key, content, tokenCount: Math.ceil(content.length / 4) });
  }
  return {
    sections: map,
    totalTokens: [...map.values()].reduce((sum, s) => sum + s.tokenCount, 0),
  };
}

describe('EXTRACTION_SYSTEM_PROMPT', () => {
  it('should include JSON output instructions', () => {
    expect(EXTRACTION_SYSTEM_PROMPT).toContain('JSON');
    expect(EXTRACTION_SYSTEM_PROMPT).toContain('extractions');
    expect(EXTRACTION_SYSTEM_PROMPT).toContain('fieldName');
    expect(EXTRACTION_SYSTEM_PROMPT).toContain('confidence');
  });

  it('should include all three confidence levels', () => {
    expect(EXTRACTION_SYSTEM_PROMPT).toContain('"high"');
    expect(EXTRACTION_SYSTEM_PROMPT).toContain('"medium"');
    expect(EXTRACTION_SYSTEM_PROMPT).toContain('"low"');
  });
});

describe('buildBatchPrompt', () => {
  it('should include context data', () => {
    const context = makeContext({
      sfObjects: '## Account\n- Name: Acme Corp',
      recentTranscript: '## Transcript\nSpeaker: Hello world',
    });

    const prompt = buildBatchPrompt('firmographic', mockFields, context);

    expect(prompt).toContain('Acme Corp');
    expect(prompt).toContain('Transcript');
  });

  it('should include field extraction instructions', () => {
    const context = makeContext({ sfObjects: 'test data' });
    const prompt = buildBatchPrompt('firmographic', mockFields, context);

    expect(prompt).toContain('AI_Buyer_Persona__c');
    expect(prompt).toContain('AI_Expected_Units__c');
    expect(prompt).toContain('Determine buyer persona');
    expect(prompt).toContain('How many units?');
  });

  it('should include picklist options', () => {
    const context = makeContext({ sfObjects: 'test data' });
    const prompt = buildBatchPrompt('firmographic', mockFields, context);

    expect(prompt).toContain('Property Owner');
    expect(prompt).toContain('Property Manager');
    expect(prompt).toContain('Valid options:');
  });

  it('should include validation rules', () => {
    const context = makeContext({ sfObjects: 'test data' });
    const prompt = buildBatchPrompt('firmographic', mockFields, context);

    expect(prompt).toContain('min: 0');
    expect(prompt).toContain('max: 10000');
  });

  it('should include the field count', () => {
    const context = makeContext({ sfObjects: 'test data' });
    const prompt = buildBatchPrompt('firmographic', mockFields, context);

    expect(prompt).toContain('2 fields');
  });

  it('should select only relevant context sections for the batch', () => {
    const context = makeContext({
      sfObjects: 'SF data here',
      recentTranscript: 'Transcript data here',
      summaries: 'Summary data here',
      emails: 'Email data here',
      outreachMailings: 'Outreach data here',
    });

    // 'firmographic' batch config uses: sfObjects, recentTranscript, summaries
    const prompt = buildBatchPrompt('firmographic', mockFields, context);

    expect(prompt).toContain('SF data here');
    expect(prompt).toContain('Transcript data here');
    expect(prompt).toContain('Summary data here');
    // These sections are NOT in firmographic batch config
    expect(prompt).not.toContain('Email data here');
    expect(prompt).not.toContain('Outreach data here');
  });
});

describe('buildUnifiedPrompt', () => {
  it('should include ALL context sections (not filtered by batch)', () => {
    const context = makeContext({
      sfObjects: 'SF data here',
      recentTranscript: 'Transcript data here',
      summaries: 'Summary data here',
      emails: 'Email data here',
      outreachMailings: 'Outreach data here',
      sms: 'SMS data here',
      activities: 'Activities data here',
    });

    const prompt = buildUnifiedPrompt(mockFields, context);

    expect(prompt).toContain('SF data here');
    expect(prompt).toContain('Transcript data here');
    expect(prompt).toContain('Summary data here');
    expect(prompt).toContain('Email data here');
    expect(prompt).toContain('Outreach data here');
    expect(prompt).toContain('SMS data here');
    expect(prompt).toContain('Activities data here');
  });

  it('should include all fields with their instructions', () => {
    const context = makeContext({ sfObjects: 'test' });
    const prompt = buildUnifiedPrompt(mockFields, context);

    expect(prompt).toContain('AI_Buyer_Persona__c');
    expect(prompt).toContain('AI_Expected_Units__c');
    expect(prompt).toContain('Determine buyer persona');
    expect(prompt).toContain('How many units?');
  });

  it('should group fields under their batch label', () => {
    const context = makeContext({ sfObjects: 'test' });
    const prompt = buildUnifiedPrompt(mockFields, context);

    // Both mock fields have batchId 'firmographic'
    expect(prompt).toContain('Firmographic');
  });

  it('should include picklist options and validation rules', () => {
    const context = makeContext({ sfObjects: 'test' });
    const prompt = buildUnifiedPrompt(mockFields, context);

    expect(prompt).toContain('Property Owner');
    expect(prompt).toContain('Valid options:');
    expect(prompt).toContain('min: 0');
    expect(prompt).toContain('max: 10000');
  });

  it('should report the total field count', () => {
    const context = makeContext({ sfObjects: 'test' });
    const prompt = buildUnifiedPrompt(mockFields, context);

    expect(prompt).toContain('2 fields');
  });

  it('should include headings for each section', () => {
    const context = makeContext({
      sfObjects: 'some sf data',
      recentTranscript: 'some transcript',
    });

    const prompt = buildUnifiedPrompt(mockFields, context);

    expect(prompt).toContain('Salesforce Record Data');
    expect(prompt).toContain('Most Recent Call Transcript');
  });

  it('should skip empty context sections', () => {
    const context = makeContext({
      sfObjects: 'has data',
      emails: '',
    });

    const prompt = buildUnifiedPrompt(mockFields, context);

    expect(prompt).toContain('Salesforce Record Data');
    expect(prompt).not.toContain('Email Messages');
  });
});
