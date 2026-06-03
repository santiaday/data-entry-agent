import { describe, it, expect } from 'vitest';
import { decideWrite } from './write-mode';

describe('decideWrite', () => {
  // ── Null value ────────────────────────────────────────
  it('should skip when no value extracted', () => {
    const result = decideWrite({
      extractedValue: null,
      currentSfValue: null,
      writeMode: 'overwrite',
      dryRun: false,
    });
    expect(result.shouldWrite).toBe(false);
    expect(result.skipReason).toBe('no_value_extracted');
  });

  // ── Dry run ───────────────────────────────────────────
  it('should not write in dry run mode', () => {
    const result = decideWrite({
      extractedValue: 'new value',
      currentSfValue: null,
      writeMode: 'overwrite',
      dryRun: true,
    });
    expect(result.shouldWrite).toBe(false);
    expect(result.skipReason).toBe('dry_run');
    expect(result.finalValue).toBe('new value');
  });

  // ── Overwrite ─────────────────────────────────────────
  it('should always write in overwrite mode', () => {
    const result = decideWrite({
      extractedValue: 'new',
      currentSfValue: 'old',
      writeMode: 'overwrite',
      dryRun: false,
    });
    expect(result.shouldWrite).toBe(true);
    expect(result.finalValue).toBe('new');
  });

  it('should overwrite even when current is null', () => {
    const result = decideWrite({
      extractedValue: 'new',
      currentSfValue: null,
      writeMode: 'overwrite',
      dryRun: false,
    });
    expect(result.shouldWrite).toBe(true);
  });

  // ── Fill blank ────────────────────────────────────────
  it('should write in fill_blank mode when current is null', () => {
    const result = decideWrite({
      extractedValue: 'new',
      currentSfValue: null,
      writeMode: 'fill_blank',
      dryRun: false,
    });
    expect(result.shouldWrite).toBe(true);
    expect(result.finalValue).toBe('new');
  });

  it('should write in fill_blank mode when current is empty string', () => {
    const result = decideWrite({
      extractedValue: 'new',
      currentSfValue: '',
      writeMode: 'fill_blank',
      dryRun: false,
    });
    expect(result.shouldWrite).toBe(true);
  });

  it('should write in fill_blank mode when current is whitespace', () => {
    const result = decideWrite({
      extractedValue: 'new',
      currentSfValue: '   ',
      writeMode: 'fill_blank',
      dryRun: false,
    });
    expect(result.shouldWrite).toBe(true);
  });

  it('should skip in fill_blank mode when current has a value', () => {
    const result = decideWrite({
      extractedValue: 'new',
      currentSfValue: 'existing value',
      writeMode: 'fill_blank',
      dryRun: false,
    });
    expect(result.shouldWrite).toBe(false);
    expect(result.skipReason).toBe('field_not_blank');
  });

  // ── Append ────────────────────────────────────────────
  it('should append to existing value', () => {
    const result = decideWrite({
      extractedValue: 'new data',
      currentSfValue: 'old data',
      writeMode: 'append',
      dryRun: false,
    });
    expect(result.shouldWrite).toBe(true);
    expect(result.finalValue).toContain('old data');
    expect(result.finalValue).toContain('new data');
    expect(result.finalValue).toContain('AI Update');
  });

  it('should just set value when appending to empty', () => {
    const result = decideWrite({
      extractedValue: 'new data',
      currentSfValue: null,
      writeMode: 'append',
      dryRun: false,
    });
    expect(result.shouldWrite).toBe(true);
    expect(result.finalValue).toBe('new data');
  });

  // ── Dry run with fill_blank ───────────────────────────
  it('should show current value in dry run fill_blank when field is populated', () => {
    const result = decideWrite({
      extractedValue: 'new',
      currentSfValue: 'existing',
      writeMode: 'fill_blank',
      dryRun: true,
    });
    expect(result.shouldWrite).toBe(false);
    expect(result.skipReason).toBe('dry_run');
    expect(result.finalValue).toBe('existing');
  });
});
