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

  'google.title': 'Conta Google conectada',
  'google.description':
    'Permite criar e atualizar a sua planilha financeira. Pedimos só acesso aos arquivos que o Leccor criar ou que você abrir com ele.',
  'google.status.NOT_CONNECTED': 'Não conectada',
  'google.status.ACTIVE': 'Conectada',
  'google.status.NEEDS_REAUTH':
    'Reconexão necessária: a autorização expirou ou foi removida no Google.',
  'google.status.REVOKED': 'Desconectada',
  'google.account': 'Conta',
  'google.connectedAt': 'Conectada desde',
  'google.connect': 'Conectar conta Google',
  'google.reconnect': 'Reconectar conta Google',
  'google.disconnect': 'Desconectar',
  'google.disconnectConfirm':
    'Desconectar remove o acesso do Leccor à sua conta Google. Suas planilhas continuam no seu Google Drive e nada é apagado.',
  'google.disconnectConfirmButton': 'Sim, desconectar',
  'google.cancel': 'Cancelar',
  'google.disconnected': 'Conta Google desconectada. Suas planilhas foram mantidas.',
  'google.disconnectedLocalOnly':
    'Removemos o acesso aqui, mas o Google não confirmou a revogação. Você pode removê-la em myaccount.google.com/permissions.',
  'google.connectedNow': 'Conta Google conectada com sucesso.',
  'google.error.google_connection_unavailable':
    'A conexão com o Google ainda não está configurada neste ambiente.',
  'google.error.unauthenticated':
    'Sua sessão expirou. Entre novamente e conecte de novo.',
  'google.error.access_denied': 'A autorização foi cancelada no Google.',
  'google.error.invalid_state':
    'A conexão expirou ou foi aberta em outra aba. Tente novamente.',
  'google.error.expired_state': 'A conexão demorou demais. Tente novamente.',
  'google.error.provider_error':
    'Não foi possível concluir a conexão com o Google. Tente novamente.',
  'google.error.insufficient_scopes':
    'Para funcionar, marque a permissão de acesso aos arquivos do Google Drive.',
  'google.error.missing_refresh_token':
    'O Google não enviou uma autorização permanente. Remova o acesso do Leccor em myaccount.google.com/permissions e conecte de novo.',
  'google.error.unknown': 'Não foi possível conectar sua conta Google.',
  'google.error.load': 'Não foi possível carregar o estado da conexão Google.',
  'google.error.disconnect': 'Não foi possível desconectar agora. Tente novamente.',

  'sheets.title': 'Planilha financeira',
  'sheets.description':
    'Criamos no seu Google Drive uma planilha organizada, com abas, fórmulas, filtros e gráfico. Ela é sua: fica na sua conta.',
  'sheets.empty': 'Você ainda não tem uma planilha.',
  'sheets.create': 'Criar minha planilha financeira',
  'sheets.creating': 'Criando a planilha…',
  'sheets.created': 'Planilha pronta no seu Google Drive.',
  'sheets.open': 'Abrir no Google Sheets',
  'sheets.active': 'em uso',
  'sheets.needsGoogle': 'Conecte sua conta Google acima para criar a planilha.',
  'sheets.status.PENDING_CREATION': 'Sendo preparada',
  'sheets.status.ACTIVE': 'Pronta',
  'sheets.status.ERROR': 'Não foi concluída',
  'sheets.status.ARCHIVED': 'Arquivada',
  'sheets.error.google_not_connected': 'Conecte sua conta Google para criar a planilha.',
  'sheets.error.google_connection_unavailable':
    'A conexão com o Google ainda não está configurada neste ambiente.',
  'sheets.error.google_reauth_required': 'Reconecte sua conta Google e tente de novo.',
  'sheets.error.google_unavailable':
    'O Google não respondeu. Tente novamente em instantes.',
  'sheets.error.google_permission_denied':
    'O Google recusou o acesso. Reconecte a conta e confirme a permissão do Google Drive.',
  'sheets.error.spreadsheet_setup_in_progress':
    'A planilha já está sendo preparada. Aguarde alguns instantes.',
  'sheets.error.spreadsheet_setup_failed':
    'Não foi possível preparar a planilha. Tente novamente.',
  'sheets.error.spreadsheet_not_found':
    'A planilha não foi encontrada no seu Google Drive.',
  'sheets.error.unknown': 'Não foi possível criar a planilha.',
  'sheets.error.load': 'Não foi possível carregar suas planilhas.',

  'nav.admin': 'Administração',
  'admin.ai.title': 'Provedores de IA',
  'admin.ai.subtitle':
    'Modelos, prioridade e chaves de API. As chaves ficam cifradas no servidor e nunca são exibidas.',
  'admin.ai.forbidden': 'Esta área é só para administradores.',
  'admin.ai.error.load': 'Não foi possível carregar os provedores de IA.',
  'admin.ai.active': 'Ativo',
  'admin.ai.inactive': 'Inativo',
  'admin.ai.activate': 'Ativar',
  'admin.ai.deactivate': 'Desativar',
  'admin.ai.envKey':
    'O servidor tem uma chave deste provedor no ambiente; ela é usada quando a configuração não tem chave própria.',
  'admin.ai.noConfigurations': 'Nenhuma configuração ainda.',
  'admin.ai.purpose.CHAT': 'Conversa',
  'admin.ai.purpose.FINANCIAL_INTERPRETATION': 'Interpretação financeira',
  'admin.ai.purpose.ANALYSIS': 'Análise',
  'admin.ai.column.purpose': 'Finalidade',
  'admin.ai.column.model': 'Modelo',
  'admin.ai.column.priority': 'Prioridade',
  'admin.ai.column.key': 'Chave',
  'admin.ai.column.status': 'Situação',
  'admin.ai.column.actions': 'Ações',
  'admin.ai.key.stored': 'Guardada (cifrada)',
  'admin.ai.key.environment': 'Do servidor',
  'admin.ai.key.missing': 'Sem chave',
  'admin.ai.replaceKey': 'Nova chave',
  'admin.ai.saveKey': 'Salvar chave',
  'admin.ai.removeKey': 'Remover chave',
  'admin.ai.test': 'Testar',
  'admin.ai.testing': 'Testando…',
  'admin.ai.test.ok': 'Respondeu em {ms} ms.',
  'admin.ai.test.failed': 'Falhou: {reason}.',
  'admin.ai.reason.timeout': 'demorou demais para responder',
  'admin.ai.reason.unavailable': 'o provedor está indisponível',
  'admin.ai.reason.rate_limited': 'limite de uso atingido',
  'admin.ai.reason.credential_rejected': 'a chave foi recusada',
  'admin.ai.reason.model_not_found': 'o modelo não existe para esta chave',
  'admin.ai.reason.invalid_response': 'resposta inválida do provedor',
  'admin.ai.reason.invalid_request': 'a solicitação foi recusada',
  'admin.ai.reason.content_blocked': 'o conteúdo foi bloqueado',
  'admin.ai.reason.not_configured': 'não há chave configurada',
  'admin.ai.reason.credential_unreadable': 'a chave guardada não pôde ser lida',
  'admin.ai.reason.unknown': 'erro desconhecido',
  'admin.ai.delete': 'Excluir',
  'admin.ai.add.title': 'Nova configuração',
  'admin.ai.add.apiKey': 'Chave de API (opcional)',
  'admin.ai.add.apiKeyHint':
    'Fica cifrada no servidor. Depois de salva, não aparece mais em lugar nenhum.',
  'admin.ai.add.submit': 'Adicionar',
  'admin.ai.add.allUsed': 'Este provedor já tem configuração para todas as finalidades.',
  'admin.ai.order.title': 'Ordem de uso por finalidade',
  'admin.ai.order.hint':
    'O primeiro da lista é usado. Os seguintes só entram se ele estiver indisponível; erros da própria solicitação não trocam de provedor.',
  'admin.ai.order.up': 'Subir {name}',
  'admin.ai.order.down': 'Descer {name}',
  'admin.ai.order.empty': 'Sem configurações.',
  'admin.ai.error.ai_priority_taken': 'Já existe uma configuração com essa prioridade.',
  'admin.ai.error.ai_configuration_exists':
    'Esse provedor já tem uma configuração para essa finalidade.',
  'admin.ai.error.ai_configuration_conflict':
    'A configuração mudou ao mesmo tempo. Recarregue a página.',
  'admin.ai.error.encryption_unavailable':
    'A criptografia de credenciais não está configurada no servidor.',
  'admin.ai.error.ai_purpose_not_supported':
    'Esse provedor não atende a essa finalidade.',
  'admin.ai.error.ai_reorder_mismatch': 'A ordem mudou. Recarregue a página.',
  'admin.ai.error.validation_failed': 'Confira o modelo e a chave informados.',
  'admin.ai.error.unknown': 'Não foi possível salvar. Tente novamente.',

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

  'google.title': 'Connected Google account',
  'google.description':
    'Lets Leccor create and update your financial spreadsheet. We only ask for access to files Leccor creates or that you open with it.',
  'google.status.NOT_CONNECTED': 'Not connected',
  'google.status.ACTIVE': 'Connected',
  'google.status.NEEDS_REAUTH':
    'Reconnection needed: the authorization expired or was removed on Google.',
  'google.status.REVOKED': 'Disconnected',
  'google.account': 'Account',
  'google.connectedAt': 'Connected since',
  'google.connect': 'Connect Google account',
  'google.reconnect': 'Reconnect Google account',
  'google.disconnect': 'Disconnect',
  'google.disconnectConfirm':
    'Disconnecting removes Leccor’s access to your Google account. Your spreadsheets stay in your Google Drive and nothing is deleted.',
  'google.disconnectConfirmButton': 'Yes, disconnect',
  'google.cancel': 'Cancel',
  'google.disconnected': 'Google account disconnected. Your spreadsheets were kept.',
  'google.disconnectedLocalOnly':
    'We removed the access here, but Google did not confirm the revocation. You can remove it at myaccount.google.com/permissions.',
  'google.connectedNow': 'Google account connected successfully.',
  'google.error.google_connection_unavailable':
    'The Google connection is not configured in this environment yet.',
  'google.error.unauthenticated': 'Your session expired. Sign in and connect again.',
  'google.error.access_denied': 'The authorization was cancelled on Google.',
  'google.error.invalid_state':
    'The connection expired or was opened in another tab. Please try again.',
  'google.error.expired_state': 'The connection took too long. Please try again.',
  'google.error.provider_error':
    'Could not complete the Google connection. Please try again.',
  'google.error.insufficient_scopes':
    'To work, please allow access to the Google Drive files.',
  'google.error.missing_refresh_token':
    'Google did not send a lasting authorization. Remove Leccor’s access at myaccount.google.com/permissions and connect again.',
  'google.error.unknown': 'Could not connect your Google account.',
  'google.error.load': 'Could not load the Google connection status.',
  'google.error.disconnect': 'Could not disconnect now. Please try again.',

  'sheets.title': 'Financial spreadsheet',
  'sheets.description':
    'We create an organized spreadsheet in your Google Drive, with tabs, formulas, filters and a chart. It is yours: it lives in your account.',
  'sheets.empty': 'You do not have a spreadsheet yet.',
  'sheets.create': 'Create my financial spreadsheet',
  'sheets.creating': 'Creating the spreadsheet…',
  'sheets.created': 'Spreadsheet ready in your Google Drive.',
  'sheets.open': 'Open in Google Sheets',
  'sheets.active': 'in use',
  'sheets.needsGoogle': 'Connect your Google account above to create the spreadsheet.',
  'sheets.status.PENDING_CREATION': 'Being prepared',
  'sheets.status.ACTIVE': 'Ready',
  'sheets.status.ERROR': 'Not completed',
  'sheets.status.ARCHIVED': 'Archived',
  'sheets.error.google_not_connected':
    'Connect your Google account to create the spreadsheet.',
  'sheets.error.google_connection_unavailable':
    'The Google connection is not configured in this environment yet.',
  'sheets.error.google_reauth_required': 'Reconnect your Google account and try again.',
  'sheets.error.google_unavailable': 'Google did not respond. Please try again shortly.',
  'sheets.error.google_permission_denied':
    'Google refused access. Reconnect the account and allow the Google Drive permission.',
  'sheets.error.spreadsheet_setup_in_progress':
    'The spreadsheet is already being prepared. Please wait a moment.',
  'sheets.error.spreadsheet_setup_failed':
    'Could not prepare the spreadsheet. Please try again.',
  'sheets.error.spreadsheet_not_found':
    'The spreadsheet was not found in your Google Drive.',
  'sheets.error.unknown': 'Could not create the spreadsheet.',
  'sheets.error.load': 'Could not load your spreadsheets.',

  'nav.admin': 'Administration',
  'admin.ai.title': 'AI providers',
  'admin.ai.subtitle':
    'Models, priority and API keys. Keys are encrypted on the server and never displayed.',
  'admin.ai.forbidden': 'This area is for administrators only.',
  'admin.ai.error.load': 'Could not load the AI providers.',
  'admin.ai.active': 'Active',
  'admin.ai.inactive': 'Inactive',
  'admin.ai.activate': 'Activate',
  'admin.ai.deactivate': 'Deactivate',
  'admin.ai.envKey':
    'The server has a key for this provider in its environment; it is used when a configuration has no key of its own.',
  'admin.ai.noConfigurations': 'No configurations yet.',
  'admin.ai.purpose.CHAT': 'Chat',
  'admin.ai.purpose.FINANCIAL_INTERPRETATION': 'Financial interpretation',
  'admin.ai.purpose.ANALYSIS': 'Analysis',
  'admin.ai.column.purpose': 'Purpose',
  'admin.ai.column.model': 'Model',
  'admin.ai.column.priority': 'Priority',
  'admin.ai.column.key': 'Key',
  'admin.ai.column.status': 'Status',
  'admin.ai.column.actions': 'Actions',
  'admin.ai.key.stored': 'Stored (encrypted)',
  'admin.ai.key.environment': 'From the server',
  'admin.ai.key.missing': 'No key',
  'admin.ai.replaceKey': 'New key',
  'admin.ai.saveKey': 'Save key',
  'admin.ai.removeKey': 'Remove key',
  'admin.ai.test': 'Test',
  'admin.ai.testing': 'Testing…',
  'admin.ai.test.ok': 'Answered in {ms} ms.',
  'admin.ai.test.failed': 'Failed: {reason}.',
  'admin.ai.reason.timeout': 'it took too long to answer',
  'admin.ai.reason.unavailable': 'the provider is unavailable',
  'admin.ai.reason.rate_limited': 'usage limit reached',
  'admin.ai.reason.credential_rejected': 'the key was rejected',
  'admin.ai.reason.model_not_found': 'the model does not exist for this key',
  'admin.ai.reason.invalid_response': 'invalid answer from the provider',
  'admin.ai.reason.invalid_request': 'the request was refused',
  'admin.ai.reason.content_blocked': 'the content was blocked',
  'admin.ai.reason.not_configured': 'no key is configured',
  'admin.ai.reason.credential_unreadable': 'the stored key could not be read',
  'admin.ai.reason.unknown': 'unknown error',
  'admin.ai.delete': 'Delete',
  'admin.ai.add.title': 'New configuration',
  'admin.ai.add.apiKey': 'API key (optional)',
  'admin.ai.add.apiKeyHint':
    'Encrypted on the server. Once saved, it is never shown anywhere again.',
  'admin.ai.add.submit': 'Add',
  'admin.ai.add.allUsed': 'This provider already has a configuration for every purpose.',
  'admin.ai.order.title': 'Order of use per purpose',
  'admin.ai.order.hint':
    'The first one is used. The next ones only step in when it is unavailable; errors in the request itself never switch providers.',
  'admin.ai.order.up': 'Move {name} up',
  'admin.ai.order.down': 'Move {name} down',
  'admin.ai.order.empty': 'No configurations.',
  'admin.ai.error.ai_priority_taken':
    'There is already a configuration with that priority.',
  'admin.ai.error.ai_configuration_exists':
    'This provider already has a configuration for that purpose.',
  'admin.ai.error.ai_configuration_conflict':
    'The configuration changed at the same time. Reload the page.',
  'admin.ai.error.encryption_unavailable':
    'Credential encryption is not configured on the server.',
  'admin.ai.error.ai_purpose_not_supported': 'This provider does not serve that purpose.',
  'admin.ai.error.ai_reorder_mismatch': 'The order changed. Reload the page.',
  'admin.ai.error.validation_failed': 'Check the model and the key.',
  'admin.ai.error.unknown': 'Could not save. Try again.',

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

  'google.title': 'Cuenta de Google conectada',
  'google.description':
    'Permite crear y actualizar tu hoja de cálculo financiera. Solo pedimos acceso a los archivos que Leccor cree o que abras con él.',
  'google.status.NOT_CONNECTED': 'No conectada',
  'google.status.ACTIVE': 'Conectada',
  'google.status.NEEDS_REAUTH':
    'Hay que volver a conectar: la autorización caducó o se eliminó en Google.',
  'google.status.REVOKED': 'Desconectada',
  'google.account': 'Cuenta',
  'google.connectedAt': 'Conectada desde',
  'google.connect': 'Conectar cuenta de Google',
  'google.reconnect': 'Volver a conectar la cuenta de Google',
  'google.disconnect': 'Desconectar',
  'google.disconnectConfirm':
    'Desconectar elimina el acceso de Leccor a tu cuenta de Google. Tus hojas de cálculo siguen en tu Google Drive y no se borra nada.',
  'google.disconnectConfirmButton': 'Sí, desconectar',
  'google.cancel': 'Cancelar',
  'google.disconnected':
    'Cuenta de Google desconectada. Tus hojas de cálculo se mantienen.',
  'google.disconnectedLocalOnly':
    'Quitamos el acceso aquí, pero Google no confirmó la revocación. Puedes quitarlo en myaccount.google.com/permissions.',
  'google.connectedNow': 'Cuenta de Google conectada correctamente.',
  'google.error.google_connection_unavailable':
    'La conexión con Google aún no está configurada en este entorno.',
  'google.error.unauthenticated': 'Tu sesión caducó. Inicia sesión y vuelve a conectar.',
  'google.error.access_denied': 'La autorización se canceló en Google.',
  'google.error.invalid_state':
    'La conexión caducó o se abrió en otra pestaña. Inténtalo de nuevo.',
  'google.error.expired_state': 'La conexión tardó demasiado. Inténtalo de nuevo.',
  'google.error.provider_error':
    'No fue posible completar la conexión con Google. Inténtalo de nuevo.',
  'google.error.insufficient_scopes':
    'Para funcionar, marca el permiso de acceso a los archivos de Google Drive.',
  'google.error.missing_refresh_token':
    'Google no envió una autorización permanente. Quita el acceso de Leccor en myaccount.google.com/permissions y vuelve a conectar.',
  'google.error.unknown': 'No fue posible conectar tu cuenta de Google.',
  'google.error.load': 'No se pudo cargar el estado de la conexión con Google.',
  'google.error.disconnect': 'No se pudo desconectar ahora. Inténtalo de nuevo.',

  'sheets.title': 'Hoja de cálculo financiera',
  'sheets.description':
    'Creamos en tu Google Drive una hoja organizada, con pestañas, fórmulas, filtros y gráfico. Es tuya: queda en tu cuenta.',
  'sheets.empty': 'Todavía no tienes una hoja de cálculo.',
  'sheets.create': 'Crear mi hoja de cálculo financiera',
  'sheets.creating': 'Creando la hoja de cálculo…',
  'sheets.created': 'Hoja de cálculo lista en tu Google Drive.',
  'sheets.open': 'Abrir en Google Sheets',
  'sheets.active': 'en uso',
  'sheets.needsGoogle':
    'Conecta tu cuenta de Google arriba para crear la hoja de cálculo.',
  'sheets.status.PENDING_CREATION': 'En preparación',
  'sheets.status.ACTIVE': 'Lista',
  'sheets.status.ERROR': 'No se completó',
  'sheets.status.ARCHIVED': 'Archivada',
  'sheets.error.google_not_connected':
    'Conecta tu cuenta de Google para crear la hoja de cálculo.',
  'sheets.error.google_connection_unavailable':
    'La conexión con Google aún no está configurada en este entorno.',
  'sheets.error.google_reauth_required':
    'Vuelve a conectar tu cuenta de Google e inténtalo de nuevo.',
  'sheets.error.google_unavailable':
    'Google no respondió. Inténtalo de nuevo en unos instantes.',
  'sheets.error.google_permission_denied':
    'Google rechazó el acceso. Vuelve a conectar la cuenta y permite el acceso a Google Drive.',
  'sheets.error.spreadsheet_setup_in_progress':
    'La hoja de cálculo ya se está preparando. Espera unos instantes.',
  'sheets.error.spreadsheet_setup_failed':
    'No se pudo preparar la hoja de cálculo. Inténtalo de nuevo.',
  'sheets.error.spreadsheet_not_found':
    'No se encontró la hoja de cálculo en tu Google Drive.',
  'sheets.error.unknown': 'No se pudo crear la hoja de cálculo.',
  'sheets.error.load': 'No se pudieron cargar tus hojas de cálculo.',

  'nav.admin': 'Administración',
  'admin.ai.title': 'Proveedores de IA',
  'admin.ai.subtitle':
    'Modelos, prioridad y claves de API. Las claves se guardan cifradas en el servidor y nunca se muestran.',
  'admin.ai.forbidden': 'Esta área es solo para administradores.',
  'admin.ai.error.load': 'No se pudieron cargar los proveedores de IA.',
  'admin.ai.active': 'Activo',
  'admin.ai.inactive': 'Inactivo',
  'admin.ai.activate': 'Activar',
  'admin.ai.deactivate': 'Desactivar',
  'admin.ai.envKey':
    'El servidor tiene una clave de este proveedor en su entorno; se usa cuando la configuración no tiene clave propia.',
  'admin.ai.noConfigurations': 'Todavía no hay configuraciones.',
  'admin.ai.purpose.CHAT': 'Conversación',
  'admin.ai.purpose.FINANCIAL_INTERPRETATION': 'Interpretación financiera',
  'admin.ai.purpose.ANALYSIS': 'Análisis',
  'admin.ai.column.purpose': 'Finalidad',
  'admin.ai.column.model': 'Modelo',
  'admin.ai.column.priority': 'Prioridad',
  'admin.ai.column.key': 'Clave',
  'admin.ai.column.status': 'Estado',
  'admin.ai.column.actions': 'Acciones',
  'admin.ai.key.stored': 'Guardada (cifrada)',
  'admin.ai.key.environment': 'Del servidor',
  'admin.ai.key.missing': 'Sin clave',
  'admin.ai.replaceKey': 'Nueva clave',
  'admin.ai.saveKey': 'Guardar clave',
  'admin.ai.removeKey': 'Quitar clave',
  'admin.ai.test': 'Probar',
  'admin.ai.testing': 'Probando…',
  'admin.ai.test.ok': 'Respondió en {ms} ms.',
  'admin.ai.test.failed': 'Falló: {reason}.',
  'admin.ai.reason.timeout': 'tardó demasiado en responder',
  'admin.ai.reason.unavailable': 'el proveedor no está disponible',
  'admin.ai.reason.rate_limited': 'se alcanzó el límite de uso',
  'admin.ai.reason.credential_rejected': 'la clave fue rechazada',
  'admin.ai.reason.model_not_found': 'el modelo no existe para esta clave',
  'admin.ai.reason.invalid_response': 'respuesta no válida del proveedor',
  'admin.ai.reason.invalid_request': 'la solicitud fue rechazada',
  'admin.ai.reason.content_blocked': 'el contenido fue bloqueado',
  'admin.ai.reason.not_configured': 'no hay clave configurada',
  'admin.ai.reason.credential_unreadable': 'no se pudo leer la clave guardada',
  'admin.ai.reason.unknown': 'error desconocido',
  'admin.ai.delete': 'Eliminar',
  'admin.ai.add.title': 'Nueva configuración',
  'admin.ai.add.apiKey': 'Clave de API (opcional)',
  'admin.ai.add.apiKeyHint':
    'Se guarda cifrada en el servidor. Una vez guardada, no vuelve a mostrarse.',
  'admin.ai.add.submit': 'Añadir',
  'admin.ai.add.allUsed':
    'Este proveedor ya tiene configuración para todas las finalidades.',
  'admin.ai.order.title': 'Orden de uso por finalidad',
  'admin.ai.order.hint':
    'Se usa el primero. Los siguientes solo entran si no está disponible; los errores de la propia solicitud no cambian de proveedor.',
  'admin.ai.order.up': 'Subir {name}',
  'admin.ai.order.down': 'Bajar {name}',
  'admin.ai.order.empty': 'Sin configuraciones.',
  'admin.ai.error.ai_priority_taken': 'Ya existe una configuración con esa prioridad.',
  'admin.ai.error.ai_configuration_exists':
    'Este proveedor ya tiene una configuración para esa finalidad.',
  'admin.ai.error.ai_configuration_conflict':
    'La configuración cambió al mismo tiempo. Recarga la página.',
  'admin.ai.error.encryption_unavailable':
    'El cifrado de credenciales no está configurado en el servidor.',
  'admin.ai.error.ai_purpose_not_supported': 'Este proveedor no atiende esa finalidad.',
  'admin.ai.error.ai_reorder_mismatch': 'El orden cambió. Recarga la página.',
  'admin.ai.error.validation_failed': 'Revisa el modelo y la clave.',
  'admin.ai.error.unknown': 'No se pudo guardar. Inténtalo de nuevo.',

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
