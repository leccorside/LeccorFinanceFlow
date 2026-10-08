/**
 * Message catalogs. pt-BR is the reference: the other locales are typed as `Messages`,
 * so a missing or extra key is a compile error. Placeholders use {name}.
 */
const ptBR = {
  'app.name': 'Leccor Finance Flow',
  'app.loading': 'Carregando…',
  'nav.profile': 'Perfil',
  'nav.logout': 'Sair',
  'nav.login': 'Entrar',
  'nav.main': 'Navegação principal',

  'home.title': 'A fundação do seu assistente financeiro está pronta.',
  'home.body':
    'Frontend React e API NestJS compartilham uma base TypeScript estrita, testável e preparada para evoluir por etapas.',
  'home.apiOnline': 'API disponível',
  'home.apiWaiting': 'API aguardando conexão',

  'login.title': 'Entre para continuar',
  'login.body': 'Use sua conta Google. Nenhuma senha é guardada pelo Leccor.',
  'login.google': 'Entrar com Google',
  'login.error.access_denied': 'O login foi cancelado no Google.',
  'login.error.invalid_state':
    'O login expirou ou foi aberto em outra aba. Tente novamente.',
  'login.error.expired_state': 'O login demorou demais. Tente novamente.',
  'login.error.provider_error':
    'Não foi possível concluir o login com o Google. Tente novamente.',
  'login.error.email_not_verified': 'Seu e-mail do Google ainda não foi verificado.',
  'login.error.account_blocked': 'Sua conta está bloqueada. Fale com o administrador.',
  'login.error.account_conflict': 'Este e-mail já está ligado a outra conta Google.',
  'login.error.oauth_not_configured':
    'O login com Google ainda não foi configurado neste ambiente.',
  'login.error.unknown': 'Não foi possível entrar. Tente novamente.',

  'profile.title': 'Seu perfil',
  'profile.subtitle': 'Dados pessoais, idioma, moeda, fuso horário e voz do assistente.',
  'profile.section.personal': 'Dados pessoais',
  'profile.section.regional': 'Idioma e região',
  'profile.section.voice': 'Voz do assistente',
  'profile.section.preferences': 'Preferências',
  'profile.section.preview': 'Prévia',
  'profile.email': 'E-mail',
  'profile.emailHint':
    'Vem da sua conta Google verificada e só muda quando você o altera no Google e entra novamente.',
  'profile.firstName': 'Nome',
  'profile.lastName': 'Sobrenome',
  'profile.photoUrl': 'Foto (URL https)',
  'profile.phone': 'Telefone',
  'profile.phoneHint': 'Formato internacional, por exemplo +5511999998888.',
  'profile.locale': 'Idioma',
  'profile.currency': 'Moeda',
  'profile.timeZone': 'Fuso horário',
  'profile.voice.gender': 'Voz',
  'profile.voice.female': 'Feminina',
  'profile.voice.male': 'Masculina',
  'profile.voice.autoSpeak': 'Ler as respostas em voz alta',
  'profile.voice.rate': 'Velocidade da fala',
  'profile.theme': 'Tema',
  'profile.theme.system': 'Seguir o sistema',
  'profile.theme.light': 'Claro',
  'profile.theme.dark': 'Escuro',
  'profile.weekStartsOn': 'A semana começa',
  'profile.week.monday': 'na segunda-feira',
  'profile.week.sunday': 'no domingo',
  'profile.preview.money': 'Valor de exemplo',
  'profile.preview.now': 'Agora no seu fuso',
  'profile.preview.date': 'Data de vencimento',
  'profile.save': 'Salvar alterações',
  'profile.saving': 'Salvando…',
  'profile.saved': 'Perfil atualizado.',
  'profile.noChanges': 'Nada para salvar.',
  'profile.error.save': 'Não foi possível salvar. Revise os campos destacados.',
  'profile.error.load': 'Não foi possível carregar seu perfil.',
  'profile.error.field': 'Valor inválido.',

  'locale.pt-BR': 'Português (Brasil)',
  'locale.en-US': 'English (United States)',
  'locale.es-ES': 'Español (España)',
} as const;

export type MessageKey = keyof typeof ptBR;
export type Messages = Record<MessageKey, string>;

const enUS: Messages = {
  'app.name': 'Leccor Finance Flow',
  'app.loading': 'Loading…',
  'nav.profile': 'Profile',
  'nav.logout': 'Sign out',
  'nav.login': 'Sign in',
  'nav.main': 'Main navigation',

  'home.title': 'The foundation of your financial assistant is ready.',
  'home.body':
    'The React frontend and the NestJS API share a strict, testable TypeScript base, ready to grow step by step.',
  'home.apiOnline': 'API available',
  'home.apiWaiting': 'API waiting for connection',

  'login.title': 'Sign in to continue',
  'login.body': 'Use your Google account. Leccor never stores a password.',
  'login.google': 'Sign in with Google',
  'login.error.access_denied': 'Sign-in was cancelled on Google.',
  'login.error.invalid_state':
    'The sign-in expired or was opened in another tab. Please try again.',
  'login.error.expired_state': 'The sign-in took too long. Please try again.',
  'login.error.provider_error':
    'Could not complete the Google sign-in. Please try again.',
  'login.error.email_not_verified': 'Your Google e-mail is not verified yet.',
  'login.error.account_blocked':
    'Your account is blocked. Please contact the administrator.',
  'login.error.account_conflict':
    'This e-mail is already linked to another Google account.',
  'login.error.oauth_not_configured':
    'Google sign-in is not configured in this environment yet.',
  'login.error.unknown': 'Could not sign you in. Please try again.',

  'profile.title': 'Your profile',
  'profile.subtitle': 'Personal data, language, currency, time zone and assistant voice.',
  'profile.section.personal': 'Personal data',
  'profile.section.regional': 'Language and region',
  'profile.section.voice': 'Assistant voice',
  'profile.section.preferences': 'Preferences',
  'profile.section.preview': 'Preview',
  'profile.email': 'E-mail',
  'profile.emailHint':
    'Comes from your verified Google account and only changes when you change it on Google and sign in again.',
  'profile.firstName': 'First name',
  'profile.lastName': 'Last name',
  'profile.photoUrl': 'Photo (https URL)',
  'profile.phone': 'Phone',
  'profile.phoneHint': 'International format, for example +14155550123.',
  'profile.locale': 'Language',
  'profile.currency': 'Currency',
  'profile.timeZone': 'Time zone',
  'profile.voice.gender': 'Voice',
  'profile.voice.female': 'Female',
  'profile.voice.male': 'Male',
  'profile.voice.autoSpeak': 'Read answers out loud',
  'profile.voice.rate': 'Speaking rate',
  'profile.theme': 'Theme',
  'profile.theme.system': 'Follow the system',
  'profile.theme.light': 'Light',
  'profile.theme.dark': 'Dark',
  'profile.weekStartsOn': 'The week starts',
  'profile.week.monday': 'on Monday',
  'profile.week.sunday': 'on Sunday',
  'profile.preview.money': 'Sample amount',
  'profile.preview.now': 'Now in your time zone',
  'profile.preview.date': 'Due date',
  'profile.save': 'Save changes',
  'profile.saving': 'Saving…',
  'profile.saved': 'Profile updated.',
  'profile.noChanges': 'Nothing to save.',
  'profile.error.save': 'Could not save. Please review the highlighted fields.',
  'profile.error.load': 'Could not load your profile.',
  'profile.error.field': 'Invalid value.',

  'locale.pt-BR': 'Português (Brasil)',
  'locale.en-US': 'English (United States)',
  'locale.es-ES': 'Español (España)',
};

const esES: Messages = {
  'app.name': 'Leccor Finance Flow',
  'app.loading': 'Cargando…',
  'nav.profile': 'Perfil',
  'nav.logout': 'Cerrar sesión',
  'nav.login': 'Entrar',
  'nav.main': 'Navegación principal',

  'home.title': 'La base de tu asistente financiero está lista.',
  'home.body':
    'El frontend React y la API NestJS comparten una base TypeScript estricta, testeable y preparada para crecer por etapas.',
  'home.apiOnline': 'API disponible',
  'home.apiWaiting': 'API esperando conexión',

  'login.title': 'Inicia sesión para continuar',
  'login.body': 'Usa tu cuenta de Google. Leccor nunca guarda contraseñas.',
  'login.google': 'Entrar con Google',
  'login.error.access_denied': 'El inicio de sesión se canceló en Google.',
  'login.error.invalid_state':
    'El inicio de sesión caducó o se abrió en otra pestaña. Inténtalo de nuevo.',
  'login.error.expired_state': 'El inicio de sesión tardó demasiado. Inténtalo de nuevo.',
  'login.error.provider_error':
    'No fue posible completar el inicio de sesión con Google. Inténtalo de nuevo.',
  'login.error.email_not_verified': 'Tu correo de Google aún no está verificado.',
  'login.error.account_blocked':
    'Tu cuenta está bloqueada. Contacta con el administrador.',
  'login.error.account_conflict':
    'Este correo ya está vinculado a otra cuenta de Google.',
  'login.error.oauth_not_configured':
    'El inicio de sesión con Google aún no está configurado en este entorno.',
  'login.error.unknown': 'No fue posible iniciar sesión. Inténtalo de nuevo.',

  'profile.title': 'Tu perfil',
  'profile.subtitle':
    'Datos personales, idioma, moneda, zona horaria y voz del asistente.',
  'profile.section.personal': 'Datos personales',
  'profile.section.regional': 'Idioma y región',
  'profile.section.voice': 'Voz del asistente',
  'profile.section.preferences': 'Preferencias',
  'profile.section.preview': 'Vista previa',
  'profile.email': 'Correo electrónico',
  'profile.emailHint':
    'Viene de tu cuenta de Google verificada y solo cambia cuando lo cambias en Google y vuelves a entrar.',
  'profile.firstName': 'Nombre',
  'profile.lastName': 'Apellidos',
  'profile.photoUrl': 'Foto (URL https)',
  'profile.phone': 'Teléfono',
  'profile.phoneHint': 'Formato internacional, por ejemplo +34600123456.',
  'profile.locale': 'Idioma',
  'profile.currency': 'Moneda',
  'profile.timeZone': 'Zona horaria',
  'profile.voice.gender': 'Voz',
  'profile.voice.female': 'Femenina',
  'profile.voice.male': 'Masculina',
  'profile.voice.autoSpeak': 'Leer las respuestas en voz alta',
  'profile.voice.rate': 'Velocidad del habla',
  'profile.theme': 'Tema',
  'profile.theme.system': 'Seguir el sistema',
  'profile.theme.light': 'Claro',
  'profile.theme.dark': 'Oscuro',
  'profile.weekStartsOn': 'La semana empieza',
  'profile.week.monday': 'el lunes',
  'profile.week.sunday': 'el domingo',
  'profile.preview.money': 'Importe de ejemplo',
  'profile.preview.now': 'Ahora en tu zona horaria',
  'profile.preview.date': 'Fecha de vencimiento',
  'profile.save': 'Guardar cambios',
  'profile.saving': 'Guardando…',
  'profile.saved': 'Perfil actualizado.',
  'profile.noChanges': 'No hay nada que guardar.',
  'profile.error.save': 'No se pudo guardar. Revisa los campos resaltados.',
  'profile.error.load': 'No se pudo cargar tu perfil.',
  'profile.error.field': 'Valor no válido.',

  'locale.pt-BR': 'Português (Brasil)',
  'locale.en-US': 'English (United States)',
  'locale.es-ES': 'Español (España)',
};

export const SUPPORTED_LOCALES = ['pt-BR', 'en-US', 'es-ES'] as const;
export type Locale = (typeof SUPPORTED_LOCALES)[number];
export const DEFAULT_LOCALE: Locale = 'pt-BR';

export const CATALOGS: Record<Locale, Messages> = {
  'pt-BR': ptBR,
  'en-US': enUS,
  'es-ES': esES,
};

/** Picks the best supported locale for a BCP 47 tag ("es-MX" → "es-ES", "en" → "en-US"). */
export function matchLocale(tag: string | undefined | null): Locale {
  if (!tag) return DEFAULT_LOCALE;
  const exact = SUPPORTED_LOCALES.find(
    (locale) => locale.toLowerCase() === tag.toLowerCase(),
  );
  if (exact) return exact;
  const language = tag.split('-')[0]?.toLowerCase();
  return (
    SUPPORTED_LOCALES.find((locale) => locale.startsWith(`${language}-`)) ??
    DEFAULT_LOCALE
  );
}

/** Replaces {placeholders}; unknown placeholders are left visible to make gaps obvious. */
export function translate(
  locale: Locale,
  key: MessageKey,
  params: Record<string, string | number> = {},
): string {
  const template = CATALOGS[locale][key] ?? CATALOGS[DEFAULT_LOCALE][key];
  return template.replace(/\{(\w+)\}/g, (match, name: string) =>
    name in params ? String(params[name]) : match,
  );
}
