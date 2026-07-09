import { describe, expect, it } from 'vitest';
import { salesforceRecordUrl } from './constants';

describe('salesforceRecordUrl', () => {
  it('builds a Lightning record URL for the given object + id', () => {
    expect(salesforceRecordUrl('Opportunity', '006QU00001BwHCzYAN')).toBe(
      'https://doorloop.lightning.force.com/lightning/r/Opportunity/006QU00001BwHCzYAN/view',
    );
    expect(salesforceRecordUrl('Lead', '00QQU00001TOQ3O2AX')).toBe(
      'https://doorloop.lightning.force.com/lightning/r/Lead/00QQU00001TOQ3O2AX/view',
    );
  });
});
