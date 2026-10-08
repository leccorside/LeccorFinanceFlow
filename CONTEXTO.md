# Contexto do projeto

## Estado em 08/10/2026

O repositório continha somente `PROMPT.md` e não estava inicializado como repositório Git. A fase de planejamento foi concluída e os PASSOS 01 a 07 foram implementados e validados.

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

O PASSO 07 está concluído. Para continuar, aguardar o usuário autorizar:

`INICIE O PASSO 8`

Quando autorizado, executar apenas o PASSO 08 de `PASSOS.md`: criação e formatação do Google Sheets. Usar `GoogleConnectionService.getAccessToken(userId)` (única fonte de token) e tratar `google_not_connected`/`google_reauth_required`/`google_unavailable`. Não antecipar o domínio financeiro (PASSO 09) nem a sincronização (PASSO 11).

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
- PASSO 12: cifrar as API keys de IA com o mesmo `CredentialVault` (contexto `ai_configurations:<id>:api_key`) e incluí-las no script `credentials:rotate`.
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
- PASSO 12: semear `AIProvider` quando a administração de provedores existir.
- Avaliar mover o projeto do disco USB para o SSD (ver erros conhecidos).

## Observações operacionais

- PASSOS 01 (`5f4756e`), 02 (`6324d5d`), 03 (`32de508`), 04 (`33279f6`), 05 (`aab4870`) e 06 (`9e9c872`) commitados; o PASSO 07 aguarda commit manual do usuário.
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
