import type { Profile } from '../../services/profile';
import { diffProfile, fieldErrorsFrom, toFormState } from './profile-form';

const profile: Profile = {
  email: 'ana@example.com',
  firstName: 'Ana',
  lastName: null,
  photoUrl: null,
  phone: '+5511999998888',
  locale: 'pt-BR',
  currency: 'BRL',
  timeZone: 'America/Sao_Paulo',
  preferences: { theme: 'system', weekStartsOn: 'monday', confirmSimpleDeletes: true },
  voice: { gender: 'FEMALE', autoSpeak: true, speakingRate: 1 },
  updatedAt: null,
};

describe('diffProfile', () => {
  const original = toFormState(profile);

  it('is empty when nothing changed (including whitespace-only edits)', () => {
    expect(diffProfile(original, { ...original, firstName: '  Ana ' })).toEqual({});
  });

  it('sends only changed fields, grouping preferences and voice', () => {
    expect(
      diffProfile(original, {
        ...original,
        lastName: ' Silva ',
        phone: '',
        locale: 'en-US',
        theme: 'dark',
        gender: 'MALE',
      }),
    ).toEqual({
      lastName: 'Silva',
      phone: null,
      locale: 'en-US',
      preferences: { theme: 'dark' },
      voice: { gender: 'MALE' },
    });
  });

  it('never includes the read-only e-mail', () => {
    const update = diffProfile(original, { ...original, currency: 'EUR' });
    expect(update).not.toHaveProperty('email');
  });
});

describe('fieldErrorsFrom', () => {
  it('maps API issue paths to form fields and ignores the rest', () => {
    const fields = fieldErrorsFrom({
      issues: [{ path: 'timeZone' }, { path: 'voice.speakingRate' }, { path: 'unknown' }],
    });
    expect([...fields].sort()).toEqual(['speakingRate', 'timeZone']);
    expect(fieldErrorsFrom(null).size).toBe(0);
  });
});
