import { describe, expect, it } from 'vitest';
import { validateQuote } from '../worker/routes/quote';

describe('validateQuote', () => {
  it('normalises a good request', () => {
    expect(validateQuote({ agency: ' Fulton PD ', ori: 'mo0140100', seats: '5', email: 'Records@City.gov ', contacts: '' })).toEqual({
      agency: 'Fulton PD', ori: 'MO0140100', seats: 5, email: 'records@city.gov', contacts: null,
    });
  });
  it('allows ORI and seats to be blank', () => {
    expect(validateQuote({ agency: 'Fulton PD', email: 'a@b.gov' })).toMatchObject({ ori: null, seats: null });
  });
  it.each([
    [{ agency: '', email: 'a@b.gov' }, 'invalid_agency'],
    [{ agency: 'PD', email: 'nope' }, 'invalid_email'],
    [{ agency: 'PD', email: 'a@b.gov', ori: 'MO-01' }, 'invalid_ori'],
    [{ agency: 'PD', email: 'a@b.gov', seats: '2.5' }, 'invalid_seats'],
    [{ agency: 'PD', email: 'a@b.gov', seats: 0 }, 'invalid_seats'],
  ])('rejects %o', (body, code) => {
    expect(() => validateQuote(body)).toThrowError(expect.objectContaining({ code }));
  });
});
