import { describe, expect, it } from 'vitest';
import { extendOneYear, generateLicenseKey, isLicenseActive, parseLookupKey, seatsFor } from '../worker/lib/licenses';

describe('parseLookupKey', () => {
  it('reads plan and kind', () => {
    expect(parseLookupKey('pro_annual')).toEqual({ plan: 'pro', kind: 'annual' });
    expect(parseLookupKey('bundle_perpetual')).toEqual({ plan: 'bundle', kind: 'perpetual' });
    expect(parseLookupKey('standard_maintenance')).toEqual({ plan: 'standard', kind: 'maintenance' });
  });
  it('ignores anything else', () => {
    for (const k of [null, undefined, '', 'pro', 'gold_annual', 'pro_monthly', 'PRO_ANNUAL']) expect(parseLookupKey(k)).toBeNull();
  });
});

describe('seatsFor', () => {
  it('counts the bundle as 10 seats per unit', () => {
    expect(seatsFor('bundle', 1)).toBe(10);
    expect(seatsFor('bundle', 2)).toBe(20);
    expect(seatsFor('standard', 7)).toBe(7);
    expect(seatsFor('pro', null)).toBe(1);
  });
});

describe('isLicenseActive', () => {
  const now = new Date('2027-01-01T00:00:00Z');
  const future = '2027-06-01T00:00:00Z';
  const past = '2026-06-01T00:00:00Z';
  it.each([
    [{ kind: 'subscription', status: 'active', expires_at: null }, true],
    [{ kind: 'subscription', status: 'past_due', expires_at: null }, true],
    [{ kind: 'subscription', status: 'canceled', expires_at: null }, false],
    [{ kind: 'subscription', status: 'unpaid', expires_at: null }, false],
    [{ kind: 'perpetual', status: 'active', expires_at: null }, true],
    [{ kind: 'perpetual', status: 'revoked', expires_at: null }, false],
    [{ kind: 'term', status: 'active', expires_at: future }, true],
    [{ kind: 'term', status: 'active', expires_at: past }, false],
    [{ kind: 'pilot', status: 'active', expires_at: future }, true],
    [{ kind: 'pilot', status: 'active', expires_at: past }, false],
    [{ kind: 'pilot', status: 'revoked', expires_at: future }, false],
  ] as const)('%o → %s', (row, expected) => expect(isLicenseActive(row, now)).toBe(expected));
});

describe('extendOneYear', () => {
  it('extends from the later of the current date and the payment date', () => {
    const paid = new Date('2027-03-01T00:00:00Z');
    expect(extendOneYear(null, paid)).toBe('2028-03-01T00:00:00.000Z');
    expect(extendOneYear('2027-09-01T00:00:00Z', paid)).toBe('2028-09-01T00:00:00.000Z'); // paid early: no lost time
    expect(extendOneYear('2026-09-01T00:00:00Z', paid)).toBe('2028-03-01T00:00:00.000Z'); // lapsed: starts at payment
  });
});

describe('generateLicenseKey', () => {
  it('produces unambiguous, unique keys', () => {
    const keys = new Set(Array.from({ length: 500 }, generateLicenseKey));
    expect(keys.size).toBe(500);
    for (const k of keys) expect(k).toMatch(/^BL-[A-HJ-NP-Z2-9]{4}(-[A-HJ-NP-Z2-9]{4}){3}$/);
  });
});
