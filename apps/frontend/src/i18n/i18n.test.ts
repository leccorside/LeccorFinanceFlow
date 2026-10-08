import { CATALOGS, matchLocale, SUPPORTED_LOCALES, translate } from './catalog';
import { formatCalendarDate, formatDateTime, formatMoney } from './format';

/** Normalizes the various Unicode spaces Intl uses (NBSP, narrow NBSP). */
const plain = (value: string) => value.replace(/[\u00a0\u202f]/g, ' ');

describe('catalogs', () => {
  const reference = Object.keys(CATALOGS['pt-BR']).sort();

  it.each(SUPPORTED_LOCALES)(
    '%s has exactly the reference keys, all non-empty',
    (locale) => {
      const catalog = CATALOGS[locale];
      expect(Object.keys(catalog).sort()).toEqual(reference);
      for (const value of Object.values(catalog)) {
        expect(value.trim()).not.toBe('');
      }
    },
  );

  it.each(SUPPORTED_LOCALES)('%s keeps the same placeholders as pt-BR', (locale) => {
    const placeholders = (text: string) => (text.match(/\{\w+\}/g) ?? []).sort();
    for (const key of reference) {
      const typed = key as keyof (typeof CATALOGS)['pt-BR'];
      expect(placeholders(CATALOGS[locale][typed])).toEqual(
        placeholders(CATALOGS['pt-BR'][typed]),
      );
    }
  });

  it('really translates (catalogs are not copies of each other)', () => {
    expect(translate('pt-BR', 'profile.save')).toBe('Salvar alterações');
    expect(translate('en-US', 'profile.save')).toBe('Save changes');
    expect(translate('es-ES', 'profile.save')).toBe('Guardar cambios');
  });

  it.each([
    ['pt-BR', 'pt-BR'],
    ['pt-PT', 'pt-BR'],
    ['en', 'en-US'],
    ['en-GB', 'en-US'],
    ['es-MX', 'es-ES'],
    ['fr-FR', 'pt-BR'],
    [undefined, 'pt-BR'],
  ])('matchLocale(%j) = %s', (tag, expected) => {
    expect(matchLocale(tag)).toBe(expected);
  });
});

describe('formatting', () => {
  it.each([
    ['pt-BR', 'BRL', 'R$ 1.234,56'],
    ['en-US', 'USD', '$1,234.56'],
    ['es-ES', 'EUR', '1234,56 €'],
    ['en-US', 'EUR', '€1,234.56'],
  ] as const)('formats money in %s/%s', (locale, currency, expected) => {
    expect(plain(formatMoney('1234.56', currency, locale))).toBe(expected);
  });

  it('formats decimal strings without float rounding', () => {
    expect(plain(formatMoney('0.1', 'BRL', 'pt-BR'))).toBe('R$ 0,10');
    expect(plain(formatMoney('123456789012345.67', 'USD', 'en-US'))).toBe(
      '$123,456,789,012,345.67',
    );
  });

  it('shows the same instant in the profile time zone', () => {
    const instant = '2026-10-08T15:30:00Z';
    expect(plain(formatDateTime(instant, 'en-US', 'America/Sao_Paulo'))).toMatch(/12:30/);
    expect(plain(formatDateTime(instant, 'en-US', 'Asia/Tokyo'))).toMatch(
      /Oct 9, 2026.*12:30/,
    );
    expect(plain(formatDateTime(instant, 'pt-BR', 'UTC'))).toMatch(/15:30/);
  });

  it('never shifts calendar dates with the time zone', () => {
    expect(plain(formatCalendarDate('2026-01-01', 'en-US'))).toBe('Jan 1, 2026');
    expect(plain(formatCalendarDate('2026-01-01', 'pt-BR'))).toMatch(
      /^1 de jan\.? de 2026$/,
    );
    expect(plain(formatCalendarDate('2026-01-01', 'es-ES'))).toMatch(/^1 ene 2026$/);
  });
});
