# Arquitetura — Leccor Finance Flow

## 1. Objetivos arquiteturais

A arquitetura prioriza segurança, baixo acoplamento, simplicidade operacional, isolamento entre usuários e uma experiência conversacional. A primeira versão será um monólito modular, sem filas, microserviços ou sistema de logs da aplicação.

Decisões centrais:

1. NestJS concentra autenticação, regras, integrações e APIs em um único backend modular.
2. PostgreSQL é a fonte de verdade operacional.
3. Google Sheets é uma projeção financeira bidirecional validada, nunca um canal direto para executar instruções.
4. Toda ação de IA passa por ferramentas cadastradas, tipadas, autorizadas e validadas.
5. Operações externas são síncronas e retornam estado explícito de sucesso, falha ou sincronização pendente.
6. `ActionHistory` registra alterações funcionais necessárias a undo e auditoria do usuário; não é log técnico.

## 2. Topologia

```text
Browser React
  | HTTPS / REST / cookie seguro
  v
NestJS modular
  |-- Auth / RBAC / Ownership
  |-- Assistant / Intent / Tools / Context
  |-- Finance / Reports / Dashboard
  |-- Google OAuth / Sheets Sync
  |-- AI Provider Factory / fallback
  |-- STT Provider / TTS Provider
  v
PostgreSQL (Prisma)

Serviços externos chamados diretamente pelo backend:
  Google OAuth + Drive + Sheets
  OpenAI | Gemini | Claude
  STT | TTS
```

Não haverá RabbitMQ, Kafka, Redis Queue, Bull/BullMQ, worker assíncrono ou armazenamento de logs técnicos.

## 3. Organização prevista do repositório

```text
leccor-finance-flow/
  apps/
    frontend/
      src/
        app/
        components/
        features/
        pages/
        services/
        hooks/
        i18n/
        styles/
    backend/
      src/
        common/
        config/
        modules/
          auth/
          users/
          profile/
          google/
          spreadsheets/
          transactions/
          accounts/
          categories/
          investments/
          recurring-transactions/
          installments/
          assistant/
          ai-providers/
          voice/
          reports/
          dashboard/
          insights/
          admin/
          action-history/
      prisma/
        schema.prisma
        migrations/
  packages/
    contracts/
  docker-compose.yml
  .env.example
```

`packages/contracts` conterá somente contratos compartilháveis e sem dependência de ambiente, evitando duplicação de enums e DTOs públicos. Regras de negócio permanecem no backend.

## 4. Módulos do backend

| Módulo             | Responsabilidade                                                           |
| ------------------ | -------------------------------------------------------------------------- |
| Auth               | Google login, sessão da aplicação, renovação, revogação e CSRF/OAuth state |
| Users/Profile      | identidade, preferências, idioma, moeda, fuso e voz                        |
| Google             | consentimento incremental, tokens criptografados e desconexão              |
| Spreadsheets       | criação, seleção, formatação e sincronização bidirecional                  |
| Transactions       | receitas, despesas, transferências, vencimentos e status                   |
| Accounts           | contas, carteiras, cartões e propriedade                                   |
| Categories         | categorias padrão e personalizadas                                         |
| Investments        | movimentações e posições de investimento registradas pelo usuário          |
| Recurrences        | definição e materialização determinística de recorrências                  |
| Installments       | compra original, parcelas e vencimentos                                    |
| Assistant          | conversa, contexto, intenção, ferramentas e respostas                      |
| AI Providers       | configuração criptografada, prioridade e fallback                          |
| Voice              | abstrações STT/TTS e preferência de voz                                    |
| Dashboard/Insights | agregações financeiras reais, sem valores inventados                       |
| Reports            | geração de PDF e XLSX com autorização                                      |
| Admin              | RBAC, usuários, provedores, modelos e configurações globais                |
| Action History     | alteração reversível, snapshot mínimo e undo                               |

## 5. Modelo de dados conceitual

### Identidade e acesso

- `User`: identidade, e-mail normalizado, status e timestamps.
- `Role`: `ADMIN` ou `USER`; relação N:N preparada para extensões.
- `UserProfile`: nome, foto, telefone, idioma, moeda, fuso e voz.
- `GoogleConnection`: usuário, Google subject, escopos, tokens criptografados, expiração e estado.
- `SystemSetting`: configurações globais não secretas ou referências a segredos criptografados.

### Finanças

- `Spreadsheet`: proprietário, Google spreadsheet ID, nome, estado, seleção ativa e checkpoint de sync.
- `FinancialAccount`: tipo, nome, instituição, moeda, saldo inicial e dados de cartão quando aplicáveis.
- `Category`: proprietário opcional para categorias do sistema, tipo, nome, pai e status.
- `Transaction`: planilha, conta, categoria, tipo, descrição, valor decimal, moeda, datas, status e metadados financeiros.
- `Investment`: ativo, classe, símbolo opcional, quantidade decimal, custo e conta.
- `RecurringTransaction`: frequência, regra, próxima ocorrência e modelo da transação.
- `Installment`: grupo da compra, número, total, valor, vencimento e transação resultante.

### Conversa, IA e relatórios

- `Conversation`: usuário, planilha em contexto, idioma e resumo contextual.
- `ConversationMessage`: papel, conteúdo, tool call/result estruturado e vínculo opcional com ação.
- `AIProvider`: tipo, status e capacidades suportadas.
- `AIConfiguration`: modelo, prioridade, finalidade e credencial criptografada.
- `VoicePreference`: gênero/predefinição, provedor, idioma e velocidade permitida.
- `Report`: tipo, período, estado, localização temporária/segura e expiração.
- `ActionHistory`: ator, agregado, ação, estado anterior/posterior mínimo, reversibilidade e data de reversão.

### Regras de persistência

- IDs internos serão UUIDs; o mesmo ID seguirá para a linha correspondente no Sheets.
- Dinheiro usará `Decimal(19,4)` no banco e `Prisma.Decimal` no domínio. Valores de moeda exibidos serão arredondados segundo a moeda, nunca com `number` para cálculo crítico.
- Quantidades de investimentos poderão usar precisão maior, definida na modelagem física.
- Todas as entidades pertencentes ao usuário terão chave de proprietário direta ou alcançável por relação obrigatória e índices compostos para consultas isoladas.
- Exclusão será física quando exigida pelo titular e segura para dependências; estados reversíveis comuns poderão usar arquivamento explícito.
- Índices iniciais cobrirão proprietário + período, planilha + período, status + vencimento, categoria + período e identificadores externos únicos.

## 6. Autenticação e autorização

### Login

1. Frontend solicita login ao backend.
2. Backend gera `state`, nonce e PKCE, armazenados com expiração curta.
3. Usuário autentica no Google.
4. Callback é validado integralmente no backend.
5. Backend cria/atualiza o usuário e emite sessão própria.
6. Tokens da aplicação ficam em cookies `HttpOnly`, `Secure` e `SameSite=Lax/Strict` conforme o fluxo.

O consentimento para Drive/Sheets será incremental e separado do login quando possível. Serão pedidos apenas os escopos necessários para criar e manipular os arquivos usados pelo aplicativo.

### Proteções

- Guards de autenticação e RBAC no backend.
- Checagem de ownership em todo acesso por ID; IDs nunca implicam autorização.
- DTOs com whitelist, rejeição de campos desconhecidos e validação determinística.
- Rate limiting em autenticação, assistente, voz e geração de relatórios.
- CORS restrito, headers de segurança, limite de payload e proteção CSRF para operações autenticadas por cookie.
- Tokens Google, chaves de IA e segredos criptografados com AES-256-GCM, chave versionada fornecida por ambiente e nunca retornados ao frontend.
- Comparações e mensagens de erro que não revelem a existência de recursos de outro usuário.

## 7. Arquitetura do assistente

```text
AssistantController
  -> AssistantService
  -> IntentService / AIProviderFactory
  -> ToolRegistry (allowlist)
  -> ToolExecutor
       1. valida schema
       2. autentica ator
       3. autoriza papel
       4. valida ownership
       5. aplica regra financeira
       6. persiste no PostgreSQL
       7. sincroniza Sheets
       8. grava ActionHistory funcional
       9. devolve resultado estruturado
  -> resposta natural baseada somente no resultado
```

Cada ferramenta terá nome, versão, schema de entrada, permissões, classe de risco, política de confirmação e schema de saída. O modelo recebe somente as ferramentas permitidas ao usuário e ao contexto atual.

Ferramentas iniciais:

- `createTransaction`, `updateTransaction`, `deleteTransaction`, `searchTransactions`.
- `createAccount`, `updateAccount`, `deleteAccount`.
- `createCategory`.
- `createInvestment`, `updateInvestment`, `deleteInvestment`.
- `getFinancialSummary`, `getExpensesByPeriod`, `getIncomeByPeriod`.
- `getUpcomingBills`, `getOverdueBills`.
- `createSpreadsheet`, `switchSpreadsheet`, `syncSpreadsheet`.
- `generateReport`, `changeVoicePreference`, `undoLastAction`.

Ambiguidade destrutiva nunca será resolvida por suposição. A ferramenta retorna candidatos seguros e o assistente solicita seleção/confirmacão. Confirmações terão token de uso único, escopo da ação e expiração curta.

### Proteção contra prompt injection

- Conteúdo de célula, nomes, descrições, anexos e resultados são delimitados como dados não confiáveis.
- Dados financeiros nunca são concatenados às instruções do sistema como texto executável.
- O modelo não define usuário, permissões, planilha ou IDs autorizados; o backend injeta e valida esses valores.
- Tool calls fora da allowlist ou com argumentos extras são rejeitados.
- Respostas analíticas são fundamentadas em agregados retornados pelo backend.

## 8. Provedores de IA e fallback

Interfaces previstas:

- `AIProvider`: chat e tool calling normalizados.
- `AIProviderFactory`: resolve configurações ativas por finalidade e prioridade.
- `IntentService`: produz uma intenção estruturada.
- `FinancialAnalysisService`: monta análises apenas com dados consultados.

Ordem configurável inicial: OpenAI, Gemini e Claude. O fallback ocorre somente em indisponibilidade, timeout, limite transitório ou erro classificado como recuperável. Requisição inválida, violação de schema, falta de autorização ou erro de regra de negócio não aciona outro provedor. A resposta registra internamente apenas o provedor efetivamente utilizado no dado funcional da conversa, sem criar log técnico.

## 9. Google Sheets e sincronização

### Estrutura criada

A planilha terá abas Dashboard, Movimentações, Receitas, Despesas, Contas, Investimentos, Categorias, Orçamento, Metas e Resumo Mensal. Cabeçalhos, filtros, congelamento, validações, formatos, cores e gráficos serão aplicados via API oficial.

Colunas técnicas protegidas/ocultas incluirão `record_id`, `record_version` e `updated_at`. Nunca conterão tokens ou segredos.

### Fonte de verdade e conflitos

- PostgreSQL é a fonte de verdade operacional e sempre prevalece em conflito concorrente.
- Uma edição feita somente no Sheets é importada após validação, vira uma alteração normal no banco e recebe nova versão.
- Uma alteração feita somente no sistema é exportada ao Sheets.
- Se banco e planilha alterarem o mesmo registro desde o último checkpoint, o valor do banco é preservado, o conflito é apresentado ao usuário para reconciliação e nenhuma exclusão é inferida.
- Linhas sem ID são tratadas como novos candidatos e importadas somente após validação completa e deduplicação.
- Remover uma linha da planilha não exclui automaticamente o registro; exclusão exige comando confirmado no aplicativo.

### Consistência sem filas

A operação grava a mudança no banco, tenta sincronizá-la imediatamente e devolve um estado estruturado:

- `SYNCED`: banco e planilha confirmados.
- `PENDING_SYNC`: banco confirmado, Sheets falhou ou está indisponível.
- `CONFLICT`: alteração externa concorrente exige reconciliação.

O assistente só afirma sincronização quando recebe `SYNCED`. Itens pendentes serão tentados novamente por ação explícita, ao abrir a planilha ou ao executar sincronização; não haverá job queue. A entidade financeira guarda apenas seu estado atual de sincronização e último erro sanitizado, não um histórico técnico de logs.

## 10. Voz

O frontend captura áudio com permissão explícita e exibe os estados `PRONTO`, `OUVINDO`, `INTERPRETANDO`, `EXECUTANDO`, `RESPONDENDO` e `ERRO`. O backend expõe interfaces substituíveis:

- `SpeechToTextProvider.transcribe(audio, locale)`.
- `TextToSpeechProvider.synthesize(text, voice, locale)`.

Áudio terá limite de tamanho/duração, tipo MIME validado e descarte após processamento, salvo consentimento explícito futuro. A transcrição poderá ser revisada antes de uma operação de alto risco. Voz feminina/masculina é preferência semântica mapeada para vozes disponíveis por provedor.

## 11. Relatórios e arquivos

PDF e XLSX serão gerados diretamente durante a requisição dentro de limites de período e volume. Arquivos temporários terão acesso autenticado e expiração. Grandes solicitações incompatíveis com processamento síncrono serão divididas por período ou recusadas com instrução clara; não será introduzida fila.

## 12. Frontend

Rotas previstas:

- Públicas: login, callback/erro e políticas.
- Usuário: dashboard, assistente, insights, relatórios, perfil, Google e configurações.
- Admin: visão geral, usuários, administradores, integrações, provedores/modelos, voz e configurações.

O chat é a interface principal. Dashboard e listas são de leitura/consulta; criar ou editar finanças abre o assistente com contexto, não formulários tradicionais. Em mobile, o microfone ganha destaque e a navegação permanece acessível por teclado e leitor de tela.

## 13. API e contrato de erros

Base prevista: `/api/v1`. Respostas de erro terão `code`, `message`, `details` seguros, `requestId` (também no header `X-Request-Id`) e timestamp. Desde o PASSO 21, só erros inesperados (5xx) geram uma linha de log em stdout com o `requestId` e a mensagem mascarada; nada é armazenado em banco.

Grupos: `/auth` (inclui `/auth/me`), `/profile`, `/google`, `/spreadsheets`, `/transactions`, `/accounts`, `/categories`, `/investments`, `/assistant`, `/voice`, `/reports`, `/dashboard`, `/privacy`, `/admin/overview`, `/admin/users`, `/admin/ai-providers`, `/admin/settings` e `/admin/audit`. Não existe `/users`: a identidade fica em `/auth/me` e `/profile`, e a gestão em `/admin/users`.

Swagger/OpenAPI não foi implementado: o contrato está documentado em `DOCUMENTACAO.md` e coberto pelos testes de integração. A variável `SWAGGER_ENABLED` do `.env.example` está reservada.

## 14. Privacidade e LGPD

- Minimização de dados e escopos.
- Consentimento claro para Google, voz e integrações.
- Exportação e exclusão pelo titular.
- Desconexão revoga acesso quando suportado e elimina tokens locais.
- Exclusão de conta remove dados pessoais, financeiros, conversas, relatórios e vínculos externos segundo uma ordem transacional documentada.
- Retenção automática (PASSO 21) e backups com expiração de até 35 dias (`RUNBOOK.md`).
- Segredos nunca entram em planilhas, frontend, mensagens de erro ou documentação versionada.

## 15. Testes arquiteturais obrigatórios

- Unitários: regras financeiras, datas, moeda, parcelas, recorrências, confirmação e fallback.
- Integração: Prisma/PostgreSQL, Google adapters simulados, providers simulados e relatórios.
- API: autenticação, RBAC, IDOR, validação, rate limit e exclusões.
- E2E (PASSO 22, `e2e/`): navegador real contra a stack de produção, com sessões semeadas no banco. Cobre jornada, administração, responsividade, acessibilidade e desempenho. Chat com IA e voz ficam nos testes de integração e de componente.
- Contratos: schemas de ferramentas e providers.
- Segurança: prompt injection, mass assignment, tokens ausentes/revogados, arquivos e dados cruzados.

Testes que dependem de Google/IA reais serão opt-in e nunca necessários para a suíte padrão.

## 16. Implantação (PASSO 22)

Produção usa `docker-compose.prod.yml`: nginx (`web`, SPA + proxy `/api`, CSP) → backend compilado (`node dist/main.js`, não publicado) → PostgreSQL. Um serviço `migrate` de execução única aplica migrations e seed antes de o backend subir. Uma única origem dispensa CORS. TLS termina antes do nginx. Operação, backup e rotação de segredos em `RUNBOOK.md`.
