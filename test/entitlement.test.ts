import { describe, expect, it } from 'vitest';
import { hasAccess } from '../worker/lib/entitlement';

describe('hasAccess', () => {
  it.each([
    [{ plan: 'monthly', status: 'active' }, true],
    [{ plan: 'yearly', status: 'trialing' }, true],
    [{ plan: 'monthly', status: 'past_due' }, true],
    [{ plan: 'monthly', status: 'canceled' }, false],
    [{ plan: 'monthly', status: 'unpaid' }, false],
    [{ plan: 'yearly', status: 'incomplete' }, false],
    [{ plan: 'lifetime', status: 'active' }, true],
    [{ plan: 'lifetime', status: 'refunded' }, false],
    [{ plan: 'lifetime', status: 'disputed' }, false],
  ] as const)('%o → %s', (row, expected) => {
    expect(hasAccess(row)).toBe(expected);
  });
  it('denies when there is no row', () => expect(hasAccess(null)).toBe(false));
});
