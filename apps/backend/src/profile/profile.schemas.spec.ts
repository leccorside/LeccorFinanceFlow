import { LOCALE_TAGS, toLocaleTag, updateProfileSchema } from './profile.schemas.js';

const parse = (body: unknown) => updateProfileSchema.safeParse(body);
/** Distinct failing paths (Zod 4 runs every check, so one field may report several issues). */
const issuesOf = (body: unknown) => {
  const result = parse(body);
  return result.success
    ? []
    : [
        ...new Set(
          result.error.issues.map((issue) => issue.path.join('.') || issue.code),
        ),
      ];
};

describe('updateProfileSchema', () => {
  it('accepts the three supported locales and maps them back from the database enum', () => {
    expect(LOCALE_TAGS).toEqual(['pt-BR', 'en-US', 'es-ES']);
    for (const locale of LOCALE_TAGS) {
      expect(parse({ locale }).success).toBe(true);
    }
    expect(toLocaleTag('es_ES')).toBe('es-ES');
    expect(issuesOf({ locale: 'fr-FR' })).toEqual(['locale']);
    expect(issuesOf({ locale: 'pt_BR' })).toEqual(['locale']);
  });

  it.each([
    'America/Sao_Paulo',
    'Europe/Madrid',
    'America/New_York',
    'Asia/Tokyo',
    'UTC',
  ])('accepts the time zone %s', (timeZone) => {
    expect(parse({ timeZone }).success).toBe(true);
  });

  it.each(['Mars/Olympus_Mons', '+03:00', 'GMT-3', 'america/sao paulo', ''])(
    'rejects the time zone %j',
    (timeZone) => {
      expect(issuesOf({ timeZone })).toEqual(['timeZone']);
    },
  );

  it('accepts ISO 4217 currencies known to Intl only', () => {
    expect(parse({ currency: 'EUR' }).success).toBe(true);
    expect(issuesOf({ currency: 'eur' })).toEqual(['currency']);
    expect(issuesOf({ currency: 'XYZ' })).toEqual(['currency']);
  });

  it('validates phone (E.164) and photo (https only), allowing null to clear', () => {
    expect(
      parse({ phone: '+5511999998888', photoUrl: 'https://cdn.example/a.png' }).success,
    ).toBe(true);
    expect(parse({ phone: null, photoUrl: null }).success).toBe(true);
    expect(issuesOf({ phone: '11 99999-8888' })).toEqual(['phone']);
    expect(issuesOf({ photoUrl: 'http://cdn.example/a.png' })).toEqual(['photoUrl']);
    expect(issuesOf({ photoUrl: 'javascript:alert(1)' })).toEqual(['photoUrl']);
  });

  it('trims names, turns blanks into null and refuses control characters', () => {
    const result = parse({ firstName: '  Ana  ', lastName: '   ' });
    expect(result.success && result.data).toEqual({ firstName: 'Ana', lastName: null });
    expect(issuesOf({ firstName: 'Ana\u0000' })).toEqual(['firstName']);
    expect(issuesOf({ firstName: 'a'.repeat(101) })).toEqual(['firstName']);
  });

  it('validates voice and preferences', () => {
    expect(
      parse({ voice: { gender: 'MALE', speakingRate: 1.25, autoSpeak: false } }).success,
    ).toBe(true);
    expect(issuesOf({ voice: { speakingRate: 1.33 } })).toEqual(['voice.speakingRate']);
    expect(issuesOf({ voice: { speakingRate: 3 } })).toEqual(['voice.speakingRate']);
    expect(issuesOf({ voice: { gender: 'ROBOT' } })).toEqual(['voice.gender']);
    expect(issuesOf({ preferences: { theme: 'neon' } })).toEqual(['preferences.theme']);
  });

  it.each([
    ['email', { email: 'new@example.com' }],
    ['userId', { userId: '0190a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a5b' }],
    ['roles', { roles: ['ADMIN'] }],
    ['nested unknown key', { voice: { provider: 'x' } }],
  ])('rejects %s (mass assignment)', (_label, body) => {
    expect(parse(body).success).toBe(false);
  });

  it('requires at least one field', () => {
    expect(parse({}).success).toBe(false);
  });
});
