# Contexto do projeto

## Estado em 09/10/2026

O repositório continha somente `PROMPT.md` e não estava inicializado como repositório Git. A fase de planejamento foi concluída e os PASSOS 01 a 13 foram implementados e validados.

Arquivos criados nesta fase:

- `README.md`
- `ARQUITETURA.md`
- `DOCUMENTACAO.md`
- `PASSOS.md`
- `CONTEXTO.md`
- `.env.example`

Fundação implementada no PASSO 01:

- monorepo pnpm com `apps/frontend`, `apps/backend` e `packages/contracts`;
- frontend React 19 + Vite 8 com base das bibliotecas obrigatórias;
- backend NestJS 12 em ESM, com `GET /api/v1/health`;
- TypeScript 6 estrito, ESLint 10, Prettier 3 e Vitest 5;
- scripts raiz `dev`, `format`, `lint`, `typecheck`, `test`, `build` e `quality`;
- lockfile pnpm e allowlist restrita de build scripts nativos.

Ambiente Docker implementado no PASSO 02:

- `docker-compose.yml` com `postgres` (17-alpine, volume `postgres-data`), `backend` e `frontend` (alvos `development` dos Dockerfiles em `apps/*/Dockerfile`, contexto na raiz);
- healthchecks encadeados: `pg_isready` → `GET /api/v1/health/ready` → `GET /` do Vite;
- hot reload por `docker compose up --watch` (`develop.watch` com `sync` de `src` e `rebuild` em manifestos/lockfile);
- portas publicadas só em `127.0.0.1`, configuráveis por `POSTGRES_PORT`, `BACKEND_PORT`, `FRONTEND_PORT`;
- `.dockerignore` exclui `node_modules`, `dist`, `.env*` e `.git`; imagens rodam como `node`;
- backend: `ConfigModule` global com `loadEnv` (Zod) validando `NODE_ENV`, `BACKEND_PORT`, `DATABASE_URL`; `DatabaseModule` com pool `pg` mínimo; `GET /api/v1/health/ready` (200/503);
- frontend: proxy `/api` lê `API_PROXY_TARGET` (Compose usa `http://backend:3000`).

Modelo de dados implementado no PASSO 03:

- Prisma 7.10 fixado (`prisma`, `@prisma/client`, `@prisma/adapter-pg`); gerador `prisma-client` ESM com saída em `apps/backend/src/generated/prisma` (gitignored, gerado no `postinstall`); `apps/backend/prisma.config.ts` com schema, migrations e seed;
- `schema.prisma` com 20 tabelas e 23 enums cobrindo identidade, finanças, conversa/IA, relatórios e `ActionHistory`;
- migration `20261008185149_init` = SQL gerado + seção manual (CHECKs, índice único parcial de planilha ativa, triggers de ownership e `owner_id` imutável) + `down.sql`;
- `PrismaService` (estende `PrismaClient` com adapter pg) substituiu o `DatabaseService`; readiness faz `SELECT 1` via Prisma;
- seed idempotente em `src/database/seed.ts` (+ dados em `seed-data.ts`): papéis `ADMIN`/`USER` e 14 categorias de sistema com `system_key`;
- testes de integração (`test/integration`, `pnpm test:integration`) em bancos descartáveis criados via `TEST_DATABASE_URL`;
- Dockerfile do backend: `openssl`, schema copiado antes do install, client gerado na imagem; Compose: `TEST_DATABASE_URL` no backend e rebuild ao mudar `apps/backend/prisma`.

Autenticação implementada no PASSO 04:

- `src/auth`: `AuthController` (`/auth/google/login`, `/google/callback`, `/refresh`, `/logout`, `/me`), `AuthService` (fluxo OAuth e ciclo de sessão), `SessionAuthGuard` + `@CurrentUser()`, adapter `OpenIdGoogleIdentityProvider` (openid-client 6) atrás da interface `GoogleIdentityProvider` (token `GOOGLE_IDENTITY_PROVIDER`, `null` quando não configurado), utilitários `tokens.ts` e `http.ts` (cookies, parser, `sanitizeRedirectPath`);
- `src/users/UsersService.resolveGoogleUser`: busca por `sub`, vínculo por e-mail, criação com papel `USER` e perfil;
- migration `20261008192955_auth_sessions`: tabelas `user_sessions` e `auth_login_attempts` + CHECKs + `down.sql`;
- env: `FRONTEND_URL`, `ACCESS_TOKEN_TTL`, `REFRESH_TOKEN_TTL`, `COOKIE_SECURE`, `GOOGLE_CLIENT_ID/SECRET/REDIRECT_URI` (saída tipada `GOOGLE_OAUTH | null`); `JWT_*` e `SESSION_SECRET` removidos do `.env.example`;
- testes: `http.spec`, `google-identity.provider.spec` (openid-client real + Google simulado com `jose`), `env.spec` (inclui o `.env.example` real) e `test/integration/auth.int-spec.ts` (fluxo HTTP completo com Postgres).

Proteção da API implementada no PASSO 05:

- `src/common/errors`: `ApiException`, `ResourceNotFoundException`, `ApiExceptionFilter` (contrato `{code, message, details, requestId, timestamp}`);
- `src/common/validation`: `validate(schema)`, `dto({...})` (Zod strict) e `uuidParam`;
- `src/common/security`: decorators `@Public`, `@Roles`, `@RateLimit`; guards `RateLimitGuard`, `CsrfGuard`, `RolesGuard` (+ `SessionAuthGuard` global); `RateLimiter` em memória; `ownedBy(user)`; middlewares de request id e headers; `configureApp` (prefixo, trust proxy, limite de corpo, CORS) usado por `main.ts` e pelos testes; `SecurityModule` registra guards e filtro;
- `GET /auth/csrf`; coluna `user_sessions.csrf_token` (migration `20261008200737_session_csrf_token`, que encerra sessões antigas);
- `ADMIN_EMAILS` concede `ADMIN` no login (`UsersService.grantConfiguredAdmin`);
- readiness define 503 via `@Res({ passthrough: true })`, mantendo o corpo próprio do healthcheck;
- testes: `security.spec.ts`, `env.spec.ts` ampliado, `test/integration/support.ts` (fake do Google, `createTestApp`, `loginAs`), `policy-probe.module.ts` (rotas só de teste) e `policy.int-spec.ts`.

Ferramentas do assistente implementadas no PASSO 13 (`src/assistant`):

- `tools/tool.types.ts`: `ToolSpec` (name, version, description, input Zod estrito, roles, risk, syncAfter, prepare, run), `defineTool`, `ToolOutcome`, `fingerprintOf` (SHA-256 de JSON canônico), `toModelContent` + `TOOL_RESULT_NOTICE`.
- `tools/resolvers.ts`: `accountId`, `categoryId` (`"Pai > Filha"`) e `investmentId` por nome, só entre os registros do usuário; `onlyOne` (id ou nome).
- `tools/finance.tools.ts` (26) e `tools/workspace.tools.ts` (planilha e voz, 4). Cada ferramenta revalida com o DTO do domínio (`createTransactionSchema.parse` etc.) e chama o serviço com `{ conversationId }`.
- `tools/tool-registry.ts`: `definitionsFor(user)` (para o `AiService`), `infoFor` e `get`; valida o contrato na construção.
- `tools/tool-executor.ts`: `execute(ctx, { name, arguments })`, `confirm(ctx, id)`, `cancel`, `pending`; `CONFIRMATION_TTL_MS` = 5 min; sincronização depois de escritas.
- `assistant.controller.ts` (`/assistant/tools`, `/assistant/confirmations…`) e `AssistantModule` (exporta registry e executor).
- Migration `assistant_confirmations`; código padrão `410 gone` no contrato de erros.
- Testes: `tool-registry.spec.ts` (6) e `test/integration/tools.int-spec.ts` (16).

## Decisões do PASSO 13

- **Confirmação só pelo usuário, por HTTP**: nenhuma ferramenta tem argumento de confirmação, e o schema estrito recusa `confirmed`/`confirmationId`. Assim, nem o modelo nem um texto de planilha conseguem confirmar.
- **Confirmação ligada ao estado do alvo** (hash de id + versão; na compra parcelada, ids e versões das parcelas) e à versão da ferramenta. Qualquer mudança invalida, e a confirmação é marcada como usada antes de executar (uso único mesmo se falhar).
- **Ambiguidade nunca executa**: filtro com mais de um resultado devolve até 5 candidatos com campos seguros; o usuário escolhe e o modelo chama de novo com o id.
- **Toda exclusão pede confirmação**. A opção configurável para exclusões simples (PROMPT §35) fica para o PASSO 15, com o undo.
- **Nomes resolvidos no backend**: o modelo diz "Nubank" ou "Transporte > Combustível"; o backend procura só nos registros do usuário e, se não achar ou achar vários, devolve as opções em vez de adivinhar.
- **Dupla validação**: schema da ferramenta (estrito, para o modelo) e DTO do domínio (as mesmas regras da API REST). Ownership e regras ficam nos serviços.
- **Erros viram resultado, não exceção**: o modelo sempre recebe `ToolOutcome`; erros inesperados viram `internal_error` sem detalhes. A rota de confirmação usa HTTP (404/409/410) para problemas da própria confirmação.
- **Sincronização depois de cada escrita** (exceto planilha e voz). Falha do Google vira `PENDING_SYNC`, sem desfazer a escrita, para que a resposta reflita o estado real.
- **Sem ferramenta de relatório** até o PASSO 19.

Camada de IA implementada no PASSO 12 (`src/ai`, `src/admin`, frontend `features/admin`):

- `ai.types.ts`: `ChatRequest`/`ChatResult`/`ToolCall`/`ToolDefinition`, `AiProviderClient` (`chat(apiKey, request, signal)`), `AI_PROVIDER_CLIENTS` (token, sobrescrito nos testes), `AiErrorKind` + `isRecoverable` + `kindOfStatus`.
- `providers/`: adaptadores `OpenAiClient`, `GeminiClient` e `AnthropicClient` (fetch injetável) e `http.ts` (`postJson`, `argumentsObject`, `resultObject`).
- `AiService.chat(purpose, request)`: devolve `{ result, provider, model, configurationId, attempts }`. Também `probe(configurationId)` e `apiKeyContext(id)`.
- `AiProvidersService` e `AiProvidersController` (`/admin/...`, `@Roles('ADMIN')` na classe). A visão de configuração é uma lista explícita de campos, que nunca inclui `apiKeyEncrypted`.
- Seed: `DEFAULT_AI_PROVIDERS` (cria se faltar, sem mexer em ativação e nome). `env.AI`: `timeoutMs`, `environmentKeys` e `defaultModels`.
- Frontend: `services/aiProviders.ts` e `features/admin/AiProvidersPage.tsx`. `RequireAdmin` no `App.tsx` é só um portão de UI; quem barra de fato é o backend.
- Testes: `providers.spec.ts` (44), `env.spec.ts` (+1), `test/integration/ai.int-spec.ts` (20) com `fake-ai.ts` (`FakeAiClients`, comportamento `ok`/`hang`/`<kind>`) e `AiProvidersPage.test.tsx` (8) + `App.test.tsx` (+1).

## Decisões do PASSO 12

- **HTTP direto, sem SDKs** (como o Google no PASSO 08): três endpoints, tipados e testáveis com fetch falso, sem dependências novas.
- **Recuperável = "este provedor não pode atender agora"**: indisponível, timeout, limite, chave ou modelo recusados por ele e resposta malformada.
  - **Não recuperável = "a requisição não é aceitável"**: `invalid_request` e `content_blocked`, que outro provedor não tornaria válida.
  - `credential_rejected` faz fallback porque é configuração do provedor, não autorização do usuário.
- **Chave só de escrita**: nunca devolvida, nem mascarada; a API mostra só `keySource` e `keyVersion`.
  - Cifrada com AAD ligada ao id da configuração; por isso a criação grava primeiro a linha e depois a chave, na mesma transação.
  - Chave ilegível é pulada como `credential_unreadable` (nunca apagada).
- **Chaves do `.env` só como reserva** de configuração sem chave guardada (bootstrap e ambientes sem banco configurado). Modelos padrão do `.env` só preenchem o formulário.
- **Uma configuração por provedor e finalidade, prioridade única por finalidade** (unique do schema do PASSO 03). A reordenação é feita em duas fases (1000+i, depois i+1) para não violar a unique no meio.
- **Provedores semeados inativos**: nada chama uma API paga sem ação explícita do admin.
- **Sem log técnico**: o que fica é o `attempts` da resposta. O provedor efetivamente usado será guardado na conversa (PASSO 14).
- **Teste de conexão** é uma chamada real e paga: só daquela configuração, 16 tokens, limite de 10 por minuto.
- **Sem migration**: `ai_providers`/`ai_configurations` e as CHECKs já existiam.

Sincronização bidirecional implementada no PASSO 11 (`src/spreadsheets/sync`):

- `cells.ts`: o codec das células:
  - datas seriais e conversão de data e hora no fuso;
  - `amountOf` (texto exato do número), `enumOf` (rótulo traduzido por posição, sem diferenciar acento ou maiúsculas, aceita o código do enum) e `fold`;
  - `rowHash` (SHA-256 dos valores canônicos);
  - `cellData` (sempre `stringValue`/`numberValue`, nunca fórmula);
  - `RowError(code, column)`.
- `adapters.ts`: `TabAdapter` com `editable`, `load`, `render`, `create` e `update`:
  - adaptadores de Movimentações, Contas e Investimentos; Categorias só exportada (`categoryRows`);
  - `create` e `update` validam pelos DTOs do domínio (`createTransactionSchema` etc.) e chamam os serviços (`TransactionsService`, `AccountsService`, `InvestmentsService`), então todas as regras e o `ActionHistory` valem também para a planilha;
  - `rowErrorOf` converte `ApiException` em código de linha.
- `sheet-sync.service.ts`, com `sync`, `status` e `resolve`. O `run` faz:
  1. snapshot e `layoutOf` (abas e colunas por metadata);
  2. `values:batchGet` das 4 abas;
  3. `pullTab` em cada aba (contas primeiro);
  4. registro dos conflitos;
  5. novos registros e linhas apagadas vão para o fim da aba;
  6. um único `batchUpdate` (`cellRequests` agrupa linhas e colunas; `appendDimension`; `deleteDimension` de baixo para cima);
  7. depois da confirmação, upsert dos estados e `setStatus` (SQL direto) para `SYNCED` só na versão escrita.
- Tabela `spreadsheet_row_states`: `exportedVersion`, `rowHash` (das colunas editáveis), `awaitingLink` (linha importada cujo ID ainda não foi escrito) e `conflictReason`/`conflictValues` (valores crus da planilha).
- Cliente Google: `getValues`; o snapshot traz `rowCount` e `columns` (`lff.column` com `dimensionRange.startIndex`). `SpreadsheetsService.withGoogleToken` virou público.
- Fake do Google com grade de células e ações de pessoa (`edit`, `append`, `deleteRow`, `insertColumn`, `rows`).
- Testes: `sync/cells.spec.ts` (12), `google-workspace.client.spec.ts` (+1) e `test/integration/sync.int-spec.ts` (18).

## Decisões do PASSO 11

- **Estado por linha numa tabela** (não um JSON no `sync_checkpoint`): escala, tem CHECKs e é apagada junto com a planilha.
  - `sync_checkpoint` guarda só o último relatório.
- **Hash das células editáveis, não cópia dos dados**: decide quem mudou.
  - sheet ≠ baseline e versão igual → importar;
  - versão diferente e sheet = baseline → exportar;
  - os dois mudaram → conflito.
  - Colunas informativas e derivadas (banco, cartão, parcela, recorrente, frequência, criado/atualizado, custo total do investimento) ficam fora do hash e são simplesmente regravadas.
- **Ordem**: puxar antes de empurrar, contas antes das movimentações (uma conta digitada na planilha já pode ser usada na mesma sincronização).
- **Importação sempre pelos serviços de domínio** com `version`: nenhuma regra é duplicada e o histórico funcional registra as edições vindas da planilha.
- **Conflito preserva os dois lados**: o banco não muda, a linha não é tocada e os valores crus da planilha ficam no estado.
  - Edição inválida de linha existente também é conflito (`invalid_row:<código>`), porque banco e planilha divergem e só a pessoa decide.
  - Se a linha voltar a ficar igual ao app, o conflito se resolve sozinho.
- **Linha nova**: importada e marcada `awaitingLink` com o hash da linha. O retry vincula pelo hash (pareando um a um, então duas linhas iguais legítimas não se fundem).
- **Exclusões**:
  - linha apagada na planilha → registro exportado de novo;
  - registro apagado no app → linha intacta removida, linha editada mantida como órfã;
  - ID desconhecido nunca é importado; ID repetido vale só na primeira linha.
- **Transferências não são editáveis pela planilha** (não existe coluna de destino); continuam exportadas como "Origem → Destino".
- **Categorias só exportadas**: não têm `version`/`sync_status` no schema; criar categoria continua sendo pelo app.
- **Status de sync por SQL direto**, para não alterar `updated_at` (sem isso cada sincronização reescrevia tudo).
- **Sem sincronização automática nas rotas REST**: a resposta mostra `PENDING_SYNC` real. O assistente (PASSO 13) chamará `SheetSyncService.sync` após cada ferramenta de escrita, e a UI (PASSO 16/18) chamará ao abrir.

Parcelas, recorrências e investimentos implementados no PASSO 10 (`src/finance`):

- `schedule.ts` (regras puras, sem I/O):
  - `splitAmount`: divisão em unidades mínimas da moeda, resíduo nas primeiras parcelas;
  - `parcelDueDate`/`addMonthsAnchored`: vencimentos ancorados no dia, limitados ao fim do mês;
  - `cardFirstDueDate`: fatura pelo dia de fechamento e de vencimento;
  - `occurrencesBetween`/`nextOccurrence`: cada data calculada a partir da âncora, com salto direto para janelas tardias.
- `TransactionsService.prepare()` expõe as regras de `resolve()` para os novos serviços. `activeSpreadsheetId()` é compartilhado. `TRANSACTION_INCLUDE` é usado também pelas consultas. A resposta traz `installment`, `recurrence` e `investment`. Parcela não muda valor, tipo, conta ou moeda sozinha nem é excluída sozinha (`installment_parcel_locked`). Aporte continua `INVESTMENT` e na moeda da posição.
- `InstallmentsService`:
  - compra mais todas as parcelas `PENDING` numa transação (`createManyAndReturn`);
  - um registro de histórico com `parcels`;
  - andamento por `groupBy`;
  - a exclusão remove tudo.
- `RecurrenceMaterializer.materialize(user, upTo, today)`:
  - chamado pela busca de movimentações, pelo resumo, pelas séries e pelas contas a vencer/vencidas;
  - limite de hoje + 366 dias e 500 ocorrências por recorrência a cada chamada;
  - `lockRecurrence` (`FOR UPDATE`) mais releitura, datas existentes puladas e `skipDuplicates`;
  - `untouchedOccurrences(row, from)` define "ocorrência não editada": pendente, de `from` em diante, com exatamente os valores da recorrência.
- `RecurringTransactionsService`: CRUD. O `PATCH` propaga para as não editadas de hoje em diante, remove as que saíram (pausa, data final) e retoma sem recriar o período pausado. O `DELETE` remove as futuras não editadas.
- `InvestmentsService`:
  - posições: `totalCost` = custo de abertura;
  - aportes: `POST /investments/:id/contributions`, uma movimentação `INVESTMENT` vinculada; a `quantity` é somada na mesma transação;
  - `invested` = abertura + aportes concluídos, sempre derivado;
  - `summary` por moeda e classe.
- `CategoriesService.delete` também conta compras parceladas.
- Testes: `schedule.spec.ts` (15) e `test/integration/plans.int-spec.ts` (17).

## Decisões do PASSO 10

- **Sem migration**: tabelas, CHECKs e índices únicos (`installment_id + installment_number`, `recurring_transaction_id + recurrence_occurrence_on`) já existiam desde o PASSO 03.
- **Uma só fonte de regras**: parcelamento, recorrência e aporte passam por `TransactionsService.prepare()`. Posse, arquivadas, tipo de categoria, moeda e casas decimais nunca divergem.
- **Parcelas**:
  - de 2 a 420; parcelamento é sempre despesa (o model não tem tipo);
  - centavos que sobram vão um a um para as primeiras parcelas;
  - a parcela ocorre no mês do vencimento (`occurredOn = dueOn`, visão de orçamento);
  - todas nascem `PENDING`; o usuário paga uma a uma;
  - a descrição não leva "(1/12)": número e total vêm em `installment`, e a planilha tem colunas próprias;
  - sem `PATCH` da compra: para mudar valor ou quantidade, excluir e recriar. Editar categoria, descrição ou status de cada parcela continua possível.
- **Fatura do cartão**:
  - compra antes do dia de fechamento entra na fatura do mês; no dia ou depois, na seguinte ("melhor dia de compra" = dia do fechamento);
  - vence no primeiro `dueDay` após o fechamento;
  - sem cartão configurado, a primeira parcela vence um mês após a compra.
- **Recorrências**:
  - quinzenal = a cada 14 dias (não "dia 15 e 30");
  - `TRANSFER` não é aceito (não há conta de destino no model);
  - o calendário é imutável;
  - ocorrências nascem `PENDING` com vencimento na data, inclusive as passadas quando `startOn` está no passado;
  - a materialização não grava `ActionHistory` (dado derivado; o histórico fica com a criação e a edição da recorrência).
- **Materialização dentro de GET**: é escrita derivada e idempotente, por isso não exige CSRF. Escolhida em vez de fila ou cron (proibidos pelo plano).
- **"Não editada" por igualdade de valores**, não por `version`: assim a propagação continua funcionando em edições sucessivas da recorrência.
- **Investimentos**:
  - só custo, sem cotação, rentabilidade ou promessa de retorno;
  - quantidade declarada pelo usuário: excluir um aporte não desfaz a quantidade;
  - resgates e vendas ficaram fora (não há tipo de movimentação para isso no schema);
  - categoria padrão do aporte: "Investimentos" (`systemKey: investments`).

Domínio financeiro implementado no PASSO 09 (`src/finance`):

- `money.ts` (`parseMoney`, `moneyString`, `currencyDigits`), `dates.ts` (`parseCalendarDate`, `todayIn`, limites 1900–2100), `user-settings.ts` (moeda/fuso/idioma do perfil com padrões);
- `finance.schemas.ts`: DTOs strict, enums e `ruleViolation()` → `422` com código específico (código `422 unprocessable` acrescentado aos padrões de erro);
- `AccountsService` (CRUD, saldos via `groupBy`, arquivamento, exclusão bloqueada em uso, `findOwned`), `CategoriesService` (padrão + próprias, nomes traduzidos `SYSTEM_CATEGORY_NAMES`, `KINDS_FOR_TYPE`, `findUsable`), `TransactionsService` (`resolve()` único para criar/editar, busca, `toResponse`), `FinanceQueriesService` (resumo, séries, contas a vencer/vencidas), `ActionHistoryService` (`record(tx, …)`, `snapshotOf`, `diffSnapshots`, `list`);
- controllers `/accounts`, `/categories`, `/transactions`, `/finance/*` e `/action-history`; `FinanceModule` exporta os serviços para o assistente;
- testes: `finance-units.spec.ts` e `test/integration/finance.int-spec.ts` (semeia as categorias padrão no banco descartável).

## Decisões do PASSO 09

- **Sem migration**: o schema do PASSO 03 já tinha tudo; as regras ficam no serviço (mensagens claras) e as CHECKs do banco são a segunda linha.
- **Valores como texto decimal** na entrada e na saída; números JSON só são aceitos quando o texto canônico já é exato. Casas decimais limitadas pela moeda.
- **Sem conversão de moeda**: a moeda da movimentação é a da conta; resumos e totais são sempre separados por moeda.
- **Status padrão**: com vencimento → pendente; sem vencimento → concluído e pago na data da ocorrência. Pagamento só em concluídas; voltar a pendente limpa a data.
- **Categoria única por movimentação** (folha): a raiz é a "Categoria" e a folha a "Subcategoria". Subcategorias têm um nível só e o mesmo tipo da raiz; `GENERAL` ("Outros") serve para qualquer tipo.
- **Nomes das categorias padrão traduzidos no backend** pelo `systemKey` (pt-BR fica no banco; en-US e es-ES em código), porque o assistente e a planilha também precisam deles.
- **Canceladas fora de todos os totais; transferências não são receita nem despesa.** O saldo do período é realizado (concluídas) e o projetado inclui pendentes.
- **Contas a pagar = despesas pendentes**; "a receber" (receitas pendentes) ficam fora das listas de contas.
- **Concorrência otimista** com `version` (opcional no `PATCH`) + `update where version` para corrida entre requisições.
- **`ActionHistory` na mesma transação**: criação com estado completo, edição com diff mínimo, exclusão com snapshot completo (base do undo).
- **Escritas REST existem** (protegidas por CSRF), mas não há formulários financeiros no frontend; o assistente usará os serviços.
- **Período máximo de consulta fixo em 3.700 dias** (`MAX_PERIOD_DAYS`); `MAX_REPORT_RANGE_MONTHS` do `.env` continua reservado para relatórios (PASSO 19).

Planilha financeira implementada no PASSO 08:

- `src/spreadsheets/google-workspace.client.ts`: `GoogleWorkspaceClient` (token `GOOGLE_WORKSPACE_CLIENT`) e `HttpGoogleWorkspaceClient` (Drive `files.list`/`files.create` e Sheets `get`/`batchUpdate` via `fetch`, erros em `GoogleApiError` por tipo); snapshot mínimo da planilha;
- `spreadsheet-template.ts`: 10 abas com chaves estáveis, colunas, formatos, listas e textos pt-BR/en-US/es-ES (`TEXTS`); listas na mesma ordem dos enums do domínio (posição = valor);
- `spreadsheet-setup.ts`: `buildSetupPlan(snapshot, options)` puro e idempotente; ids de aba determinísticos (`1000 + posição`), gráfico `9001`, metadados `lff.*`;
- `spreadsheets.service.ts`/`controller`/`module`: `GET /spreadsheets`, `GET /spreadsheets/:id`, `POST /spreadsheets` (ensure), trava `setup_started_at`, `appProperties.lffSpreadsheetId`, recriação se o arquivo sumir, retentativa em 401 (`GoogleConnectionService.invalidateAccessToken`), primeira planilha vira ativa;
- migration `20261008220911_spreadsheet_setup` (`locale`, `setup_started_at`, `last_error_code` + CHECKs) e política de rate limit `spreadsheets` (`SPREADSHEET_RATE_LIMIT_MAX_REQUESTS`);
- testes: `spreadsheet-setup.spec`, `google-workspace.client.spec`, `test/integration/fake-workspace.ts` (Drive/Sheets em memória), `spreadsheets.int-spec`, smoke real opcional `test/google-real` (`pnpm test:google`);
- frontend: `services/spreadsheets.ts`, `SpreadsheetsCard` + `spreadsheet-errors.ts` no perfil, 23 chaves i18n por idioma.

## Decisões do PASSO 08

- **Sem o pacote `googleapis`**: 4 endpoints REST com `fetch` tipado (o disco é lento e o pacote é enorme); o fake em memória cobre a semântica relevante.
- **Arquivo criado via Drive com `appProperties`** + id salvo imediatamente: base da idempotência e da recuperação pós-queda (`drive.file` permite listar só os arquivos do app).
- **Setup por diferença (snapshot → requests)**: itens aditivos só se faltarem; o resto é regravado. Regras condicionais são apagadas e recriadas. Títulos de abas existentes nunca são alterados (respeita renomeação). A aba padrão só é removida na primeira montagem.
- **Idioma da planilha fixo na criação** (`spreadsheets.locale`): nomes de abas, cabeçalhos e valores de listas ficam nesse idioma; a sincronização vai usá-lo para traduzir valores. Mudar o idioma do perfil depois não reescreve a planilha.
- **Developer metadata por aba e coluna**: a sincronização não depende de nomes nem de posições.
- **Orçamento e Metas são abas de planejamento só da planilha** (não há entidades no banco); Receitas/Despesas/Dashboard/Resumo são fórmulas sobre Movimentações.
- **Resumo mensal determinístico** (12 linhas, colunas fixas) em vez de QUERY com pivot, para o gráfico ser confiável.
- **Proteções "warning only"**: o dono sempre pode editar (não dá para bloquear o dono), mas recebe aviso nas colunas técnicas, cabeçalhos e áreas geradas.
- **Fórmulas em notação canônica** (inglês e vírgula); confirmação no Google real só pelo smoke opcional (risco documentado).
- **Reparo com falha mantém `ACTIVE`**, exceto quando o arquivo sumiu (aí a linha volta a `PENDING_CREATION`; uma CHECK exige arquivo em planilhas `ACTIVE`).
- **Botão no perfil** em vez de comando por chat: o assistente (PASSO 13/14) vai chamar o mesmo `SpreadsheetsService.ensure`.

Conexão Google e cofre implementados no PASSO 07:

- `src/common/crypto`: `CredentialVault` (AES-256-GCM, `v<n>.<iv>.<tag>.<dados>`, AAD de contexto, `isCurrent`/`reencrypt`) e `CryptoModule` global (`CREDENTIAL_VAULT`, `null` sem chave);
- `src/config/env.ts`: `ENCRYPTION` a partir de `DATA_ENCRYPTION_KEY_V<n>` + `DATA_ENCRYPTION_KEY_ACTIVE_VERSION`; `GOOGLE_OAUTH.connectionRedirectUri`;
- `src/google`: `OpenIdGoogleOAuthClient` atrás de `GoogleOAuthClient` (token `GOOGLE_OAUTH_CLIENT`), `GoogleConnectionService` (`status`, `startConnect`, `completeConnect`, `getAccessToken` interno, `disconnect`, `rotateGoogleCredentials`) e `GoogleController` (`/google/connection` GET/DELETE, `/google/connect`, `/google/callback`);
- `src/scripts/rotate-credentials.ts` (`pnpm credentials:rotate`);
- migration `20261008213903_google_connection_attempts`: `purpose` + `user_id` em `auth_login_attempts` e CHECKs em `google_connections` (só texto cifrado, `ACTIVE` exige refresh, inativas sem tokens, `revoked_at` ⇔ `REVOKED`);
- frontend: `services/google.ts`, `GoogleConnectionCard` + `google-return.ts` no perfil e 28 chaves de i18n por idioma.

## Decisões do PASSO 07

- **Escopo `drive.file` apenas** (+ `openid email`); `spreadsheets` não é pedido, porque daria acesso a todas as planilhas do usuário. Consequência: o app só enxerga planilhas criadas por ele ou abertas pelo usuário com ele (o "Google Picker" fica como opção futura para importar planilhas existentes).
- **A conta Google conectada pode diferir da do login**; ela é identificada por `sub`/`email` do ID token e exibida no perfil.
- **Consentimento separado, incremental e offline** com `prompt=consent` para garantir refresh token; o `access_token`/`refresh_token` do login continuam descartados.
- **Tentativa de conexão vinculada a usuário + navegador + finalidade**: um callback de outra sessão é recusado sem consumir a tentativa.
- **Cofre com AAD por usuário e campo**; CHECK no banco impede gravar token em texto puro por engano.
- **Renovação preguiçosa** (`getAccessToken`, margem de 60 s), sem job; `invalid_grant` → `NEEDS_REAUTH` com tokens apagados; falhas temporárias não alteram a conexão.
- **Rotação**: preguiçosa ao usar + script para tudo. Credenciais indecifráveis são puladas e nunca apagadas (chave antiga removida cedo demais é recuperável).
- **Desconectar nunca apaga planilhas**; a revogação remota é de melhor esforço, e a resposta diz se o Google confirmou.
- **Sem chave ou sem cliente Google**: o backend sobe; o estado funciona, e conectar volta com `google_connection_unavailable`.
- **`.env.example`**: `DATA_ENCRYPTION_KEY_V1` vazio (o placeholder antigo seria recusado pela validação) e `GOOGLE_SHEETS_SCOPES` removido (escopos fixos no código).

Perfil e i18n implementados no PASSO 06:

- backend `src/profile`: `GET`/`PATCH /profile` (`ProfileService`, schemas Zod em `profile.schemas.ts`, `LOCALES` BCP 47 ↔ enum); `UsersService.syncVerifiedEmail` no login; `/auth/me` com `locale` BCP 47; helper `common/validation/defined.ts`;
- frontend `src/i18n` (catálogos, `I18nProvider`, `useI18n`, `format.ts`), `src/services/api.ts` (CSRF + refresh), `services/auth.ts`, `services/profile.ts`, `features/auth/LoginPage`, `features/profile/ProfilePage` + `profile-form.ts`, `App` com cabeçalho, `RequireAuth` e aplicação do idioma/fuso/moeda do perfil; estilos do formulário;
- correção do script `typecheck` do frontend (agora `tsc -p tsconfig.app.json` e `tsconfig.node.json`).

## Decisões do PASSO 06

- **E-mail confiável**: a API de perfil nunca aceita `email`. O e-mail da conta acompanha o e-mail verificado do Google vinculado (sincronizado no login; se já estiver em uso por outra conta, mantém o atual). É a leitura de "editar e-mail" compatível com o critério de não sobrescrever arbitrariamente; não existe e-mail de contato separado.
- **Sem rota `/profile/:id`**: o usuário só endereça o próprio perfil.
- **Tags BCP 47 na API** (`pt-BR`), enum no banco (`pt_BR`).
- **Validação de fuso por nome IANA** + `Intl`; offsets recusados. Moedas: ISO 4217 conhecidas pelo `Intl` do Node.
- **Preferências com schema fixo** (`theme`, `weekStartsOn`), mescladas no JSON; o que estiver salvo e for desconhecido ou inválido é ignorado na leitura. A "preferência de planilha" do PASSO é a planilha ativa (`spreadsheets.is_active`), tratada no PASSO 08.
- **i18n próprio, sem dependência**: catálogos tipados (paridade garantida em compilação e teste) e `Intl` nativo. Valores monetários formatados a partir da string decimal.
- **Datas de calendário formatadas em UTC** para nunca mudarem de dia; instantes no fuso do perfil.
- **Cliente HTTP criado já neste passo** (era previsto para o PASSO 16) porque o perfil é a primeira tela que escreve na API.
- **Tema salvo mas não aplicado** (a UI atual só tem tema escuro); aplicação no PASSO 16.

## Decisões do PASSO 05

- **Default-deny global** com `@Public()` explícito; a lista de rotas públicas está documentada e deve continuar curta.
- **Ordem dos guards**: rate limit → autenticação → CSRF → papéis. O rate limit vem antes para cortar abusos antes de qualquer consulta ao banco.
- **ADMIN sem bypass**: nas rotas de usuário o ADMIN só vê os próprios recursos; funcionalidades administrativas terão rotas `/admin` com `@Roles('ADMIN')`.
- **Ownership no filtro da consulta** (`ownedBy`), com 404 idêntico para recurso alheio e inexistente. `ownerId` nunca vem do payload.
- **Validação por parâmetro (não pipe global)**: tsx/Vitest (esbuild) não emitem metadados de tipo, então um pipe global baseado em metatype não funcionaria. `dto()` usa objeto strict: campo extra gera 400 em vez de ser ignorado.
- **CSRF por synchronizer token** guardado na sessão, em texto puro (inútil sem o cookie) e estável por sessão (multiaba, sobrevive ao refresh), mais checagem de `Origin`/`Referer` em toda escrita, inclusive pública. Rotas públicas de escrita (`refresh`/`logout`) não exigem token: o refresh tem cookie `SameSite=Strict`, e sem cookies o logout não tem efeito.
- **Rate limit próprio em memória** (sem `@nestjs/throttler` nem Redis): janela fixa por IP; os buckets vencidos são varridos periodicamente. Limitação: vale por instância e zera ao reiniciar; com várias instâncias seria preciso um store compartilhado.
- **Headers de segurança próprios** (sem helmet), para uma API JSON. A CSP do frontend fica para o PASSO 21.
- **Erros 5xx nunca vazam a mensagem original**; Prisma P2025 → 404, P2002/P2003 → 409; erros de middleware com `status` + `type` (body-parser) → seu 4xx.
- **Módulo de sondagem só nos testes**: valida a infraestrutura sem criar rotas de domínio antes do PASSO 09.
- **`ADMIN_EMAILS` só concede**: remover da lista não rebaixa (ação explícita no PASSO 20).

## Decisões do PASSO 04

- **Sessão opaca no banco, não JWT**: hash SHA-256 de tokens aleatórios de 256 bits. Bloqueio e logout valem na hora, sem segredo de assinatura para gerenciar. Custo: uma consulta por requisição autenticada (aceitável no monólito); `last_used_at` só é gravado se passou mais de 1 min.
- **Dois cookies**: acesso (`lff_session`, 15 min, `Path=/api`, `Lax`) e refresh (`lff_refresh`, 30 dias, `Path=/api/v1/auth`, `Strict`). O refresh é deslizante (cada rotação renova 30 dias); não há expiração absoluta ainda.
- **Detecção de reuso**: só o último refresh trocado (`previous_refresh_token_hash`) é reconhecido; tokens mais antigos simplesmente falham com 401, sem revogar.
- **state/nonce/verifier no banco** (`auth_login_attempts`, 10 min, apagados ao consumir) + `state` em cookie para vincular ao navegador. O `code_verifier` fica em texto puro por no máximo 10 min (inútil sem o `code`); a criptografia de credenciais chega no PASSO 07.
- **Checagem do cookie antes de consumir a tentativa**: um callback forjado não "queima" o login legítimo em andamento.
- **Assinatura do ID token validada** com `enableNonRepudiationChecks`: por padrão o openid-client v6 não valida a assinatura de ID tokens vindos do token endpoint (permitido pelo OIDC via TLS). Habilitado como defesa em profundidade, e um teste garante isso.
- **Callback reconstruído a partir de `GOOGLE_REDIRECT_URI`** + allowlist de parâmetros, sem confiar em `Host`/proxy.
- **Redirect URI padrão pela origem do frontend** (`:5173/api/...`): todos os cookies ficam na mesma origem do app.
- **Login Google é opcional para subir**: sem ID/segredo, o backend sobe e `/auth/google/login` responde 503. O `.env.example` copiado para `.env` é aceito tal como está (há teste para isso).
- **Sem admin inicial e sem CSRF por token/rate limit**: ficam para o PASSO 05 (RBAC/proteção de API). Até lá, `refresh`/`logout` dependem de `SameSite`.
- **E-mail da conta não é atualizado no login** (decisão do perfil, PASSO 06); nome e foto do Google só preenchem o perfil na criação.
- **Tokens Google do login são descartados**: o login só prova identidade; acesso a Drive/Sheets é um consentimento separado (PASSO 07).

## Decisões do PASSO 03

- **Prisma 7.10.0 estável, não o `latest`**: o dist-tag `latest` do pacote `prisma` apontava para `8.0.0-rc.21`. Todas as peças Prisma ficam fixadas na mesma versão exata.
- **Regras no banco via SQL manual na migration**: o Prisma não modela CHECK, índice parcial nem trigger, e o teste de drift confirma que ele não tenta removê-los. Toda migration futura com SQL manual precisa de `down.sql` correspondente e de manter `match schema.prisma (no drift)` verde.
- **Ownership por trigger, não por FK composta**: o Prisma exige relação obrigatória quando a FK composta inclui um campo obrigatório (`owner_id`), o que inviabiliza referências opcionais. A função `app_assert_same_owner` faz a checagem; categorias do sistema (`owner_id` nulo) são referenciáveis por todos.
- **`NO ACTION` em vez de `RESTRICT` nas FKs internas ao usuário**: `RESTRICT` é verificado na hora e quebraria a cascata ao excluir o usuário (conta apagada antes da transação). `NO ACTION` só verifica no fim do comando. Apenas `user_roles → roles` mantém `RESTRICT`.
- **Categoria única por transação (folha)**: Categoria/Subcategoria saem da árvore, evitando inconsistência entre dois campos.
- **`Installment` = compra original; parcelas são `Transaction`** com número único por compra.
- **Status `OVERDUE` não é armazenado**: atraso é derivado de `due_on` + `status = PENDING` (evita dado que envelhece).
- **UUID v7 gerado pelo Prisma** (`uuid(7)`), não pelo banco: o PostgreSQL 17 não tem `uuidv7()`. Inserts SQL manuais precisam informar o ID.
- **Migrations explícitas**: o container não roda `migrate deploy` ao subir; usar `db:deploy`/`db:seed` (documentado).
- **`down.sql` remove o registro em `_prisma_migrations`**: `migrate resolve --rolled-back` só aceita migrations com falha no Prisma 7.
- **`pg` ficou como devDependency** só para o helper de testes (criar/remover bancos); em runtime, quem usa `pg` é o `@prisma/adapter-pg`.
- **Escopo**: não foi semeado `AIProvider` (pertence ao PASSO 12) nem criado nenhum módulo de domínio/API.

## Decisões do PASSO 02

- **`pg` em vez de Prisma para o readiness** (substituído no PASSO 03 pelo `PrismaService`).
- **Injeção explícita com `@Inject(Token)` em todo construtor Nest**: `tsx` (dev) e Vitest usam esbuild, que não emite `emitDecoratorMetadata`; injeção só por tipo quebra nesses ambientes. Manter esse padrão nos próximos módulos.
- **Liveness separado de readiness**: `/health` não toca dependências; `/health/ready` é o que o Compose usa como healthcheck.
- **Validação de ambiente incremental**: o schema só contém variáveis já usadas. Cada passo adiciona as suas (OAuth, criptografia, IA etc.) ao `env.ts` com testes.
- **Mensagens de erro de ambiente nunca incluem valores**, apenas variável + regra.
- **`DATABASE_URL` no Compose é montada a partir de `POSTGRES_*`** e sobrescreve a do `.env`; senha precisa ser segura para URL.
- **Somente alvo `development`** nos Dockerfiles; imagem de produção fica para a preparação de entrega (PASSO 21/22).

## Erros e correções conhecidas

- `pnpm` não está no PATH desta máquina Windows; usar `corepack pnpm <cmd>`. O script `pnpm quality` chama `pnpm` internamente e falha sem ele no PATH — solução usada: shim temporário `pnpm.cmd` contendo `@corepack pnpm %*` (ou rodar `corepack enable` com permissão).
- Portas 5432 (Postgres local) e 3000 (container `open-webui`) já estão ocupadas nesta máquina; usar `POSTGRES_PORT`/`BACKEND_PORT` alternativas no `.env`.
- `docker compose run backend` com env inválido não termina porque `tsx watch` mantém o watcher aberto; para testar fail-fast, executar `tsx src/main.ts` diretamente no container.
- Container com usuário `node`: código copiado com `--chown=node:node` e `node_modules` do app com dono `node`, senão o sync do `compose watch` e o cache do Vite falham por permissão.
- **Disco D: é USB e muito lento** (escrita de arquivos pequenos ~10× mais lenta que o SSD C:). Efeitos: `pnpm add prisma` ficou parado por longos períodos importando pacotes (parecia travado; com `--offline` e sem timeout concluiu); o primeiro import a frio do Prisma Client levou ~88 s (timeouts do Vitest do backend aumentados para 120 s); a suíte do frontend leva ~130 s a frio e estoura o tempo de inicialização do worker dentro de `pnpm quality`, embora passe isolada. Dentro do Docker (disco do WSL) tudo é rápido: instalar e gerar o client leva ~17 s. Se possível, mover o projeto para o SSD.
- Se `pnpm install` for interrompido, sobram diretórios `*_tmp_*` em `node_modules/.pnpm`; removê-los antes de tentar de novo.
- pnpm 11 bloqueia build scripts não aprovados (`ERR_PNPM_IGNORED_BUILDS`) e escreve placeholders `set this to true or false` em `allowBuilds`; `prisma` e `@prisma/engines` foram liberados explicitamente em `pnpm-workspace.yaml`.
- `prisma migrate diff` sem datasource configurado devolve saída vazia com código 0 (o schema engine exige `--datasource` e o erro é engolido). Para diffs offline, exportar um `DATABASE_URL` fictício.
- **Não usar `Get-Content`/`Set-Content` do PowerShell 5.1 para editar arquivos**: lê como ANSI e grava UTF-8 com BOM, corrompendo acentos e caracteres como `—` (aconteceu com `schema.prisma`, que deixou de validar). Arquivos corrigidos; editar só com ferramentas que preservam UTF-8 sem BOM.
- PASSO 04: o primeiro `.env.example` revisado trazia `GOOGLE_REDIRECT_URI` preenchido com ID/segredo vazios, o que violaria a regra "todas juntas" e impediria o backend de subir. Corrigido: só ID + segredo decidem; o redirect tem padrão. Um teste agora valida o `.env.example` real (o arquivo é copiado para a imagem para o teste rodar também no container).
- PASSO 04: no teste do adapter, passar `iss`/`exp` como claims não funciona, porque `setIssuer`/`setExpirationTime` do `jose` sobrescrevem; usar os overrides dedicados do helper.
- PASSO 13: sem bug de produção.
  - Substituição em lote por indentação duplicou linhas (padrão com menos espaços casa dentro do de mais espaços): corrigido reinserindo pela linha âncora.
  - No teste manual, `head -c` cortava o JSON e `/tmp` do Git Bash não existe para o Node no Windows: usar pipe por stdin.
- PASSO 12: sem bug de produção. Os ajustes foram:
  - testes que esperavam o `env` completo agora incluem `AI`;
  - dois testes de tela ajustados (texto repetido, dado assíncrono);
  - um teste de integração desativava um provedor e não reativava;
  - template com crases dentro de `node -e` no Git Bash vira substituição de comando: usar Edit ou script em arquivo.
- PASSO 11: **bug real** pego pelo teste de idempotência: marcar `SYNCED` com `updateMany` do Prisma atualiza `updated_at` (`@updatedAt`), a coluna "Atualizado em" mudava e toda sincronização reescrevia todas as linhas. Corrigido com `UPDATE` em SQL direto (`setStatus`).
- PASSO 11: comandos `node -e` longos com aspas quebram no Git Bash. Os patches grandes viraram scripts no scratchpad (`patch-fake.cjs`, `mutate.cjs`).
- PASSO 10: nenhum bug de domínio apareceu: unitários e integração passaram de primeira, e as duas mutações injetadas foram detectadas.
  - Problemas de ferramenta:
    - o Prettier quebrou `request(...)[method](...)` em duas linhas, o que o ESLint acusa como `no-unexpected-multiline`. Corrigido guardando `request(...)` numa variável;
    - o script de teste manual usou o banco `leccor` em vez de `leccor_finance_flow` (o nome está em `POSTGRES_DB`).
  - O teste manual fica em `scratchpad/smoke-plans.sh` da sessão; para refazer, recriar o script a partir da evidência.
- PASSO 09: **bug real** pego pela integração: criar um cartão validava, mas não gravava, dia de fechamento, dia de vencimento e últimos dígitos (o helper de validação devolvia um objeto vazio usado no spread). Corrigido: validação separada e campos gravados explicitamente.
- PASSO 09: no host, a suíte do frontend voltou a estourar o tempo de inicialização dos workers na primeira rodada da `quality` (disco USB a frio); a segunda rodada passou e a suíte passa no container.
- PASSO 08: limpar o id do arquivo apagado no Drive violava a CHECK "planilha `ACTIVE` exige arquivo" (pego pelo teste de integração). Corrigido: a linha volta a `PENDING_CREATION` até ser recriada.
- PASSO 08: o limite de taxa fixo (10/min) da criação de planilhas barrava os próprios testes; virou a política configurável `SPREADSHEET_RATE_LIMIT_MAX_REQUESTS`.
- PASSO 08: **bug real visto só no Docker**: sem chave de criptografia, `POST /spreadsheets` respondia 500, porque `getAccessToken` deixava escapar um erro interno do fluxo OAuth. Os testes sempre tinham chave. Corrigido para `503 google_connection_unavailable`, com teste sem chave.
- PASSO 08: num smoke manual, um `SELECT` com coluna ambígua abortou o `psql` antes do `DELETE`, deixando o usuário sintético no banco; removido depois. Em limpezas, usar comandos `-c` separados.
- PASSO 07: a primeira versão da rotação abortava inteira ao encontrar uma credencial indecifrável (pega pelo teste de integração, que reaproveita a credencial corrompida de outro teste). Corrigido: a credencial é pulada e contada, e o script sai com código 1. Em `getAccessToken`, falha de decifragem virou `409 google_reauth_required` em vez de 500.
- PASSO 07: o `%{redirect_url}` do curl veio vazio nos testes manuais; para conferir redirecionamentos, ler o header `Location` (`curl -D -`).
- PASSO 06: o script `typecheck` do frontend rodava `tsc --noEmit` sobre um `tsconfig.json` com `"files": []` e não verificava nada desde o PASSO 01 (só o `build` checava). Corrigido.
- PASSO 06: o Zod 4 executa todas as checagens de um campo mesmo após a primeira falha, então um valor inválido pode gerar várias issues no mesmo caminho. Os testes comparam caminhos distintos.
- PASSO 06: o TanStack Query v5 passa um segundo argumento (contexto) para `mutationFn`; envolver o serviço numa arrow function para não repassá-lo.
- PASSO 06: escapes `\u00a0`/`\u202f` escritos em testes acabaram gravados como caracteres reais (ESLint `no-irregular-whitespace`). Corrigido com um script que troca pelos escapes; ao lidar com a saída do `Intl`, conferir esses espaços especiais.
- PASSO 05: com o filtro global, uma exceção 503 lançada pelo readiness viraria o contrato de erro e quebraria o corpo do healthcheck; por isso o readiness define o status via `@Res({ passthrough: true })`.
- PASSO 05: testes que criam recursos com nome repetido batem na unicidade (`owner_id, type, name`) e recebem 409; usar nomes únicos por teste.
- Comandos `docker compose run ... -w /app/...` pelo Git Bash precisam de `MSYS_NO_PATHCONV=1`, senão o caminho vira `C:/Program Files/Git/app/...`. O PowerShell 5.1 corrompe aspas aninhadas em `sh -c`; para esses casos, usar Bash.

## Decisões aprovadas pelo planejamento

- Backend: NestJS em monólito modular.
- Banco: PostgreSQL via Prisma; UUID; `Decimal` para dinheiro.
- Frontend: React/Vite/TypeScript/Tailwind/Framer Motion/Router/Query/Axios/Recharts.
- Execução oficial: Docker Compose com frontend, backend e PostgreSQL.
- PostgreSQL é a fonte de verdade operacional.
- Sheets aceita edições manuais não conflitantes; em conflito simultâneo, banco prevalece e usuário reconcilia.
- Exclusão de linha no Sheets nunca apaga automaticamente um registro.
- Alterações persistem no banco e tentam sync síncrono; resposta distingue `SYNCED`, `PENDING_SYNC` e `CONFLICT`.
- IA só age por Tool Registry/Executor com schema, RBAC, ownership, regras e confirmação.
- Multi-IA tem fallback apenas para falhas recuperáveis.
- Tokens Google e API keys ficam criptografados no backend.
- Não haverá filas, sistema de logs, microserviços ou formulários financeiros tradicionais.

## Restrições que não podem ser esquecidas

1. Não inventar valores financeiros.
2. Não permitir IDOR, mesmo com IDs obtidos na conversa ou planilha.
3. Tratar células e descrições como dados não confiáveis, nunca instruções.
4. Não afirmar que o Sheets sincronizou quando a API falhar.
5. Não usar ponto flutuante comum em cálculo monetário crítico.
6. Não executar exclusão ambígua ou de alto impacto sem confirmação adequada.
7. `ActionHistory` é funcional para undo/auditoria do usuário, não log técnico.
8. Após cada passo, testar, atualizar documentação/contexto e sugerir commit sem executá-lo. A mensagem de commit é sempre em português do Brasil; só o tipo (`feat:`, `fix:`...) fica em inglês. As sugestões em inglês dos passos futuros em `PASSOS.md` devem ser traduzidas na hora de usar.

## Próxima ação

O PASSO 13 está concluído. Para continuar, aguardar o usuário autorizar:

`INICIE O PASSO 14`

Quando autorizado, executar apenas o PASSO 14 de `PASSOS.md`: assistente e contexto conversacional.

- Conversa e mensagens (`Conversation`/`ConversationMessage`, já no schema).
- Laço modelo ↔ ferramentas: `AiService.chat('CHAT', { system, messages, tools: registry.definitionsFor(user) })` → `ToolExecutor.execute({ user, conversationId }, call)` → `toModelContent(outcome)` como mensagem `tool`.
- Guardar `provider` na mensagem do assistente.
- Pendentes de confirmação aparecem para o usuário com `GET /assistant/confirmations`.
- Usar `ASSISTANT_RATE_LIMIT_MAX_REQUESTS`.

Pendências ligadas ao PASSO 13:

- PASSO 15: undo (`undo_last_action`) e confirmação configurável para exclusões simples; exclusão de planilha, histórico e conta com confirmações próprias.
- PASSO 19: ferramenta `generate_report`.
- `switch_spreadsheet` não existe: o serviço de planilhas ainda não troca a planilha ativa.
- Limpeza de confirmações expiradas: hoje elas só deixam de valer (índice em `expires_at` pronto para uma limpeza futura, sem fila).

Pendências ligadas ao PASSO 12:

- PASSO 14: guardar `provider`/`model` de `AiChatOutcome` na mensagem da conversa; mapear `ai_unavailable`, `ai_not_configured` e `ai_request_rejected` para respostas ao usuário; usar `ASSISTANT_RATE_LIMIT_MAX_REQUESTS`.
- PASSO 20: o restante da administração (usuários, admins, configurações globais) entra no mesmo `AdminModule`.
- Smoke real com chaves de teste (`RUN_AI_INTEGRATION_TESTS`) ainda não existe; os formatos das três APIs seguem a documentação e não foram exercitados contra os serviços reais.

Pendências ligadas ao PASSO 11:

- PASSO 13: depois de cada tool de escrita, chamar `SheetSyncService.sync(user, activeSpreadsheetId)`. Responder conforme `report.status` e citar `invalidRows`/`orphanedRows`/`duplicateRows`. Sem planilha ativa, dizer que ficou pendente.
- PASSO 16/18: botão "Sincronizar", lista de conflitos com `keep: app|sheet` (valores crus: datas como serial → formatar) e linhas com problema.
- Smoke real (`pnpm test:google`) ainda não cobre a sincronização: estender com `getValues`, edição e `sync` quando houver conta de teste.
- Limitações:
  - corrida entre a leitura e a escrita se a pessoa inserir ou apagar linhas durante a sincronização (a escrita é por índice de linha);
  - sem paginação: uma sincronização lê as abas inteiras e escreve num único `batchUpdate`;
  - precisão de ponto flutuante da planilha acima de cerca de 15 dígitos.

Pendências ligadas aos PASSOS 09 e 10:

- PASSO 15: undo a partir dos snapshots do `ActionHistory`:
  - criação → excluir; edição → aplicar `before`; exclusão → recriar com o mesmo id;
  - `INSTALLMENT` traz `parcels`;
  - `RECURRING_TRANSACTION` traz `occurrences`, `updatedOccurrences` e `deletedOccurrences`;
  - o aporte grava `TRANSACTION:CREATE` + `INVESTMENT:UPDATE` (agrupar por proximidade ou por `conversationId` ao desfazer).
- PASSO 13: as tools do assistente devem chamar os serviços passando `context.conversationId`:
  - `InstallmentsService.create`, `RecurringTransactionsService.create/update/delete`, `InvestmentsService.create/contribute`.
- PASSO 18: dashboard consumindo `/finance/*`, `/accounts`, `/installments` e `/investments/summary`.
- Futuro (fora do plano atual):
  - resgate/venda de investimento;
  - edição da compra parcelada (valor e quantidade);
  - antecipação ou quitação de parcelas;
  - recorrência de transferência (exige coluna de conta de destino).

Pendências ligadas ao PASSO 08:

- Rodar o smoke real (`pnpm test:google`) assim que houver uma conta de teste, para confirmar fórmulas, padrões de moeda e o gráfico no Google.
- Importar planilhas que o usuário já tem exigiria o Google Picker (o escopo `drive.file` não enxerga outros arquivos): fora do escopo atual.
- Gráficos adicionais (por categoria) e aplicação de `TEMPLATE_VERSION` mais nova a planilhas antigas (migração de template) ficam para depois.

Regras para todo módulo novo:

- rotas são autenticadas por padrão; só usar `@Public()` com justificativa;
- todo parâmetro de entrada passa por `validate(...)`/`uuidParam`, com DTOs criados por `dto({...})`;
- recursos do usuário são consultados com `ownedBy(user)` no `where` e respondem `ResourceNotFoundException` quando nada corresponde;
- `ownerId` sempre vem da sessão; escritas exigem `X-CSRF-Token` (já garantido pelo guard);
- erros esperados usam `ApiException(status, code, message?, details?)`;
- testes de integração usam `test/integration/support.ts` (`createTestApp`, `loginAs`);
- PATCH com `.partial()` do Zod + Prisma: usar `defined()` (`common/validation/defined.ts`) por causa do `exactOptionalPropertyTypes`;
- frontend: textos sempre via `t('chave')` com a chave nos 3 catálogos; valores e datas via `useI18n().money/dateTime/calendarDate`; chamadas à API via `services/api.ts`.

Pendências conhecidas para passos futuros:

- PASSO 16: aplicar o tema (`preferences.theme`) e o início da semana na interface definitiva; o cliente HTTP (CSRF + refresh) já existe em `services/api.ts`.
- PASSO 21: desconexão já não apaga planilhas; definir a exclusão explícita de planilhas e a revogação na exclusão de conta.
- A conexão real com o Google ainda não foi testada ponta a ponta (sem credenciais): ao configurar, confirmar o refresh token e a granularidade de escopos na tela do Google.
- PASSO 17: usar `voice.gender`/`autoSpeak`/`speakingRate` do perfil na síntese de voz; o comando por conversa "troque sua voz" vai usar `ProfileService.update`.
- `packages/contracts` ainda não é usado: os tipos de perfil existem no backend e no frontend. Avaliar mover os contratos públicos para lá quando o build do pacote estiver integrado ao Docker.
- PASSO 14/17: usar `@RateLimit` com `ASSISTANT_RATE_LIMIT_MAX_REQUESTS`/`VOICE_RATE_LIMIT_MAX_REQUESTS` (já no `.env.example`, ainda não validados no `env.ts`), de preferência por usuário.
- PASSO 20: ao bloquear um usuário, chamar `AuthService.revokeAllSessions`; promoção e rebaixamento de admins.
- Rate limit pelo proxy do Vite: todo o tráfego do navegador chega com o IP do container do frontend (um único bucket); em produção, configurar `TRUST_PROXY` atrás do proxy reverso.
- Login real com Google ainda não foi testado ponta a ponta (sem credenciais). Ao configurar, confirmar que o `iss` do ID token é `https://accounts.google.com` (o Google às vezes usa `accounts.google.com` sem esquema em outros fluxos).
- Avaliar expiração absoluta da sessão (hoje o refresh é deslizante) e uma tela de "sessões ativas".
- PASSO 09: tratar exclusão de conta/categoria/planilha com movimentações (as FKs `NO ACTION` bloqueiam) e derivar "vencido" de `due_on`.
- Avaliar mover o projeto do disco USB para o SSD (ver erros conhecidos).

## Observações operacionais

- PASSOS 01 (`5f4756e`), 02 (`6324d5d`), 03 (`32de508`), 04 (`33279f6`), 05 (`aab4870`), 06 (`9e9c872`), 07 (`ab50b00`), 08 (`a84d5fc`), 09 (`59218a0`), 10 (`c2a270b`), 11 (`d02f00c`) e 12 (`8cac5be`) commitados; o PASSO 13 aguarda commit manual do usuário.
- Ainda não existe imagem de produção.
- Fluxo após clonar/subir: `docker compose up --build`, depois `db:deploy` e `db:seed` dentro do container `backend`.
- Nenhum segredo foi recebido ou configurado.
- O `.env.example` continua sendo um contrato preliminar e deve ser ajustado conforme adapters reais forem implementados.
- A documentação deve ser atualizada com evidências reais, não com suposições de conclusão.

## Evidências do PASSO 01

- `pnpm install --frozen-lockfile --offline`: passou.
- `pnpm quality`: passou, incluindo Prettier, ESLint, TypeScript, testes e builds.
- Testes: 4 testes em 4 arquivos, todos aprovados.
- Backend real: `GET http://127.0.0.1:3000/api/v1/health` respondeu HTTP 200 com o contrato esperado.
- Build frontend: 531 módulos transformados; artefatos gerados em `apps/frontend/dist`.
- Duas árvores npm incompletas da recuperação foram enviadas à Lixeira e podem ser restauradas temporariamente se necessário; não fazem parte do projeto.

## Evidências do PASSO 02

- `docker compose build --no-cache`: backend e frontend construídos.
- `docker compose up -d --wait`: três serviços `healthy`.
- `/api/v1/health` 200; `/api/v1/health/ready` 200 com `database: up` (direto e via proxy do Vite).
- Postgres parado: readiness 503 `database: down`, liveness 200; após `start`, readiness volta a 200 sem reiniciar o backend.
- Persistência: linha gravada, `docker compose down` + `up`, linha lida; tabela de prova removida.
- Fail-fast: `DATABASE_URL=mysql://...` e `BACKEND_PORT=99999` → código 1 com mensagem por variável, sem o segredo.
- `docker compose watch`: criação/remoção sincronizadas em backend e frontend.
- `pnpm quality`: passou; 20 testes em 5 arquivos (backend 18, contracts 1, frontend 1).
- Stack derrubada ao final com `docker compose down` (volume `leccor-finance-flow_postgres-data` mantido).

## Evidências do PASSO 03

- `prisma validate`: schema válido; `prisma generate` ok no host e na imagem.
- `pnpm test:integration`: 29 testes em 2 arquivos passam no host (Postgres do Compose em `127.0.0.1:55432`) e dentro do container `backend`; nenhum banco `leccor_test_*` restante.
- Migration: aplica do zero, sem drift contra `schema.prisma`, `down.sql` remove tabelas/enums/funções e o registro da migration, reaplicação ok.
- Docker: `docker compose build --no-cache backend` ok; `db:deploy` aplicou `20261008185149_init`; `db:seed` 2× → 2 papéis e 14 categorias; `db:status` "up to date"; readiness 200; dados mantidos após `down`/`up`.
- Host: `pnpm install --frozen-lockfile --offline` ok; Prettier, ESLint, typecheck e build ok; backend 18 testes e contracts 1 teste ok.
- Frontend (não alterado): 1 teste passa isolado (131 s a frio); dentro de `pnpm quality` o worker do Vitest excedeu o tempo de inicialização por causa do disco lento, e por isso a pipeline completa terminou com código 1 nesta máquina.

## Evidências do PASSO 04

- Backend: 62 testes unitários (env com `.env.example` real, cookies/redirect/tokens incluindo vetor RFC 7636, adapter openid-client real contra Google simulado) passam no host e no container.
- Integração: 50 testes (21 de autenticação) passam no host e no container, cobrindo login completo, cookies, PKCE/nonce, replay, state inválido/expirado, falhas do Google, e-mail não verificado, bloqueio, vínculo/conflito de conta, open redirect, expiração, rotação, reuso de refresh, logout e 503 sem configuração.
- Mutação: remover a checagem do cookie de state fez 2 testes falharem (revertido).
- Docker: migration `20261008192955_auth_sessions` aplicada via `db:deploy`; sem credenciais, login → 503, `/me` → 401, logout → 204, callback forjado → 302 `/login?error=oauth_not_configured`; com credenciais fictícias, 302 para `accounts.google.com` com `code_challenge_method=S256`, `state`/`nonce` de 43 caracteres, `scope=openid email profile` e cookie `lff_oauth_state` `HttpOnly; SameSite=Lax; Path=/api/v1/auth/google; Max-Age=600`.
- `pnpm quality` passou por completo no host (Prettier, ESLint, typecheck, testes dos 3 workspaces e builds).

## Evidências do PASSO 05

- Backend: 81 testes unitários e 82 de integração (32 novos de políticas) passam no host e no container; nenhum banco `leccor_test_*` restante.
- Mutações no `RolesGuard` (ignorar papel) e no `CsrfGuard` (ignorar token) foram detectadas (2 falhas) e revertidas.
- Docker: migration `20261008200737_session_csrf_token` aplicada; via proxy do Vite, os headers `nosniff`/`DENY`/CSP/`no-referrer` e `X-Request-Id` chegam ao cliente; `GET /auth/csrf` sem sessão → 401 no contrato; `POST /auth/logout` com `Origin: https://evil.example` → 403 `csrf_failed`; preflight CORS com `ACAO` só para `http://localhost:5173`; corpo de 1,1 MB → 413 `payload_too_large`.
- `pnpm quality` passou por completo no host.

## Evidências do PASSO 06

- Backend: 101 testes unitários e 96 de integração (14 novos de perfil) passam no host e no container; nenhum banco de teste restante.
- Frontend: 47 testes (i18n, formatação, cliente HTTP, formulário, telas de perfil e login, App) passam no host e no container.
- Docker, pelo proxy do Vite e com sessão sintética criada no banco (removida ao final): `GET /profile` 200; `PATCH` sem CSRF 403; `PATCH` com token e `Origin` do frontend 200 (idioma, moeda, fuso, voz e tema persistidos, refletidos no `/auth/me`); `PATCH` com `email` 400 `validation_failed`; `/profile` e `/login` servem a SPA.
- `pnpm quality` passou por completo (com o `typecheck` do frontend agora efetivo).

## Evidências do PASSO 07

- Backend: 121 testes unitários e 117 de integração (21 novos da conexão Google) passam no host e no container; nenhum banco de teste restante.
- Frontend: 56 testes (6 novos do card de conexão, nos 3 idiomas) passam no host e no container.
- Mutações detectadas: AAD do cofre desligado e callback sem exigir o mesmo usuário.
- Docker: migration aplicada; `GET /google/connection` sem tokens; `connect` anônimo → `/login?redirectTo=%2Fprofile`; sem configuração → `/profile?googleError=google_connection_unavailable`; `DELETE` 403 sem CSRF e 200 com; consentimento real (backend avulso com credenciais fictícias) com `scope=openid email .../drive.file`, `access_type=offline`, `prompt=consent`, `include_granted_scopes=true`, PKCE S256 e `login_hint`; `credentials:rotate` executado (código 0).
- `pnpm quality` passou por completo.

## Evidências do PASSO 08

- Backend: 155 testes unitários (34 de planilha) e 134 de integração (17 de planilha) passam; suítes também verdes nos containers (155 + 133 + 63, antes do teste de configuração ausente); nenhum banco de teste restante.
- Frontend: 63 testes (5 novos do card de planilha, em 3 idiomas).
- Mutações detectadas: metadados de aba sempre recriados (idempotência) e busca por `appProperties` desligada (recuperação pós-queda).
- Docker: migration `20261008220911_spreadsheet_setup` aplicada; `POST /spreadsheets` sem chave → `503 google_connection_unavailable` (planilha `ERROR` com `last_error_code`); sem CSRF 403; com `ownerId` 400.
- Smoke real `pnpm test:google` presente e pulado por padrão (sem conta de teste).
- `pnpm quality` passou por completo.

## Evidências do PASSO 09

- Backend: 195 testes unitários (40 de finanças) e 162 de integração (28 de finanças) passam no host e no container; nenhum banco de teste restante.
- Frontend sem mudanças: 63 testes passam no container e na segunda rodada da `quality` no host.
- Mutações detectadas: leitura de movimentação sem `ownedBy` (IDOR) e canceladas somadas no resumo.
- Docker, com sessão sintética removida ao final: conta com saldo inicial 1000, despesa de 87,45 em Alimentação (`COMPLETED`, paga no dia), saldo `912.55`, resumo de outubro com 100% em Alimentação, `422 currency_mismatch` ao informar USD numa conta BRL, histórico `TRANSACTION:CREATE, FINANCIAL_ACCOUNT:CREATE`.
- `pnpm quality` passou por completo.

## Evidências do PASSO 10

- Backend no host e no container: 210 testes unitários (15 de calendário e parcelas) e 179 de integração (17 de parcelas, recorrências e investimentos). Nenhum banco de teste restante.
- Frontend sem mudanças: 63 testes passam na `quality`.
- Concorrência: 5 consultas simultâneas materializaram o aluguel uma única vez. O índice único recusa uma ocorrência duplicada inserida direto no banco (`P2002`).
- Mutações detectadas:
  - materializador sem `ownedBy`;
  - critério de "não editada" sem o valor.
- Docker, com sessão sintética removida no fim:
  - TV 12x de `300.00` no cartão (fechamento 3, vencimento 10) com primeira parcela em 10/11/2026;
  - `installment_parcel_locked`;
  - aluguel todo dia 5 materializado sob demanda (2 ocorrências);
  - aporte de 1.000 em Bitcoin (`BTC`, `0.00512345`) com corrente em `4000.00`;
  - resumo por classe;
  - histórico com `INSTALLMENT`, `RECURRING_TRANSACTION` e `INVESTMENT`.
- `pnpm quality` passou por completo.

## Evidências do PASSO 11

- Backend no host e no container: 223 testes unitários (13 novos) e 197 de integração (18 de sincronização; o teste de migrations agora espera 23 tabelas, e a nova migration reverte pelo `down.sql`). Nenhum banco de teste restante.
- Mutações detectadas:
  - texto com `=` escrito como fórmula;
  - conflito não detectado;
  - retry sem vínculo, que duplicava a linha.
- Docker:
  - migration `20261009030912_spreadsheet_sync` aplicada no container;
  - teste manual das rotas novas com sessão sintética removida no fim: status `200`; sync sem Google configurado `503 google_connection_unavailable`, com a trava liberada e `last_error_code` gravado; `403` sem CSRF; `404` para id inexistente; `400` para corpo inválido.
- `pnpm quality` passou por completo.
- Não validado contra o Google real (sem conta de teste).

## Evidências do PASSO 12

- Backend no host e no container: 268 testes unitários (45 novos) e 217 de integração (20 de IA). Frontend: 72 testes (9 novos). Nenhum banco de teste restante.
- Mutações detectadas:
  - fallback depois de erro inválido;
  - cifra devolvida na resposta admin;
  - rota admin sem `@Roles`.
- Docker, com sessões sintéticas removidas no fim:
  - seed com os três provedores inativos;
  - `403` para usuário comum;
  - `503 encryption_unavailable` ao salvar chave sem `DATA_ENCRYPTION_KEY`, sem nada gravado;
  - configuração sem chave e teste `not_configured`;
  - `/admin/ai` servido pelo Vite.
- `pnpm quality` passou por completo.
- Não validado contra as APIs reais da OpenAI, do Google e da Anthropic (sem chaves de teste).

## Evidências do PASSO 13

- Backend no host e no container: 274 testes unitários (6 novos) e 233 de integração (16 de ferramentas; o teste de migrations agora espera 24 tabelas, e a nova migration reverte pelo `down.sql`). Nenhum banco de teste restante.
- Mutações detectadas:
  - papel não verificado;
  - destrutiva executando sem confirmação;
  - hash do alvo ignorado;
  - validade da confirmação ignorada.
- Docker, com sessão sintética removida:
  - migration aplicada;
  - 30 ferramentas, 5 destrutivas;
  - confirmação por HTTP executou a exclusão (histórico `CREATE,DELETE`);
  - `403` sem CSRF, `409` no segundo uso, `404` para id inexistente, `401` anônimo.
- `pnpm quality` passou por completo.
