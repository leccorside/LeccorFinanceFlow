# Plano de implementação

## Regras de execução

- Executar um passo por vez e não antecipar escopo futuro.
- Antes de cada passo, confirmar pré-condições e arquivos existentes.
- Ao final: testar, corrigir, atualizar `DOCUMENTACAO.md` e `CONTEXTO.md`, registrar evidências e só então marcar o checkbox.
- Informar uma sugestão manual de Conventional Commit; não executar commit.
- Docker Compose será o modo oficial de execução e validação.
- Não adicionar filas, sistema de logs ou formulários financeiros tradicionais.

## [x] PASSO 00 — Arquitetura, documentação e planejamento

**Objetivo:** transformar o prompt em decisões técnicas e etapas verificáveis, sem implementar o sistema.

**Tarefas:**

- Analisar integralmente os 52 tópicos do `PROMPT.md`.
- Definir monólito modular, limites e fluxos críticos.
- Definir fonte de verdade e política de conflitos do Google Sheets.
- Criar `README.md`, `DOCUMENTACAO.md`, `ARQUITETURA.md`, `CONTEXTO.md`, `PASSOS.md` e `.env.example`.

**Arquivos:** os documentos acima e `PROMPT.md` como fonte.

**Critérios de aceite:** requisitos rastreáveis; barreira de não implementação respeitada; próximo passo claro; nenhum segredo real.

**Testes necessários:** presença dos arquivos, revisão de seções obrigatórias, busca por segredos acidentais e validação de consistência textual.

**Evidência:** documentação criada em 07/10/2026; nenhuma aplicação ou dependência iniciada.

**Sugestão de commit:** `docs: define arquitetura e plano inicial do finance flow`

---

## [x] PASSO 01 — Fundação do monorepo e qualidade

**Objetivo:** criar a estrutura mínima compilável de frontend, backend e contratos.

**Tarefas:** criar workspaces; configurar TypeScript estrito; iniciar React/Vite e NestJS; configurar lint/format/test; criar healthcheck básico; definir scripts raiz.

**Arquivos:** `package.json`, lockfile, `apps/frontend/**`, `apps/backend/**`, `packages/contracts/**`, configurações TS/lint/test.

**Critérios de aceite:** instalações reproduzíveis; frontend e backend compilam; healthcheck responde; nenhum módulo de negócio antecipado.

**Testes necessários:** lint, typecheck, testes base e builds dos dois apps.

**Evidência (07/10/2026):** workspaces pnpm criados para frontend, backend e contratos; React/Vite e NestJS compilam; TypeScript estrito ativo; Prettier e ESLint passam; 4 testes passam em 4 arquivos; builds dos três workspaces passam; `GET /api/v1/health` respondeu HTTP 200 com `{"status":"ok","service":"leccor-finance-flow-api"}`. Instalação reproduzível validada com `pnpm install --frozen-lockfile --offline`.

**Sugestão de commit:** `feat: scaffold frontend backend and shared contracts`

## [x] PASSO 02 — Docker Compose e configuração validada

**Objetivo:** tornar Docker o modo oficial de desenvolvimento.

**Tarefas:** Dockerfiles; Compose para frontend/backend/PostgreSQL; volumes; healthchecks; validação tipada de ambiente; `.dockerignore`.

**Arquivos:** `docker-compose.yml`, Dockerfiles, configuração de ambiente e documentação.

**Critérios de aceite:** uma inicialização sobe os três serviços; healthchecks passam; backend conecta ao Postgres; reinício preserva dados.

**Testes necessários:** build limpo, `docker compose up`, healthchecks e reinício.

**Evidência (07/10/2026):** `docker compose build --no-cache` passou para backend e frontend; `docker compose up -d --wait` deixou `postgres`, `backend` e `frontend` em `healthy`; `GET /api/v1/health` → 200, `GET /api/v1/health/ready` → 200 `{"checks":{"database":"up"}}`, inclusive via proxy do Vite; com `postgres` parado, readiness → 503 `database:down` e liveness → 200, recuperando para 200 sem reiniciar o backend após `start`; linha gravada antes de `docker compose down` foi lida após novo `up` (tabela de prova removida em seguida); `DATABASE_URL`/`BACKEND_PORT` inválidos encerram com código 1 sem ecoar o segredo; `docker compose watch` sincronizou criação e remoção de arquivos nos dois apps; `pnpm quality` passou com 20 testes em 5 arquivos. Validação feita com `POSTGRES_PORT=55432` e `BACKEND_PORT=3001` porque 5432/3000 já estavam ocupadas na máquina.

**Sugestão de commit:** `feat: adiciona ambiente de desenvolvimento com Docker`

## [x] PASSO 03 — Prisma e modelo base de dados

**Objetivo:** implementar o schema relacional completo e a primeira migration.

**Tarefas:** entidades, enums, constraints, índices, Decimal, UUIDs, relações, seed de papéis e categorias padrão.

**Arquivos:** `schema.prisma`, migrations, seed e testes de persistência.

**Critérios de aceite:** migration sobe e reverte em banco descartável; constraints impedem inconsistências; seed idempotente.

**Testes necessários:** integração Prisma/PostgreSQL, constraints, Decimal e isolamento básico por proprietário.

**Evidência (08/10/2026):** Prisma 7.10 com 20 tabelas, 23 enums e migration `20261008185149_init` (SQL gerado + CHECKs, índice parcial e triggers de ownership) com `down.sql`; 29 testes de integração passam no host e dentro do container `backend`, cada arquivo em banco descartável removido ao fim (nenhum `leccor_test_*` restante): migration aplica do zero, não há drift contra `schema.prisma`, `down.sql` remove tudo e permite reaplicar, seed idempotente, `Decimal` exato (`123456789012345.4234` somado sem erro), CHECKs rejeitam inconsistências, triggers barram referências a dados de outro usuário e troca de `owner_id`, exclusão do usuário apaga só os dados dele. No Docker: `db:deploy` aplicou a migration, `db:seed` rodou 2× resultando em 2 papéis e 14 categorias, readiness 200 via Prisma, dados mantidos após `down`/`up`. Lint, typecheck, build e 18 testes do backend passam. A suíte do frontend (inalterada) passa isolada, mas excedeu o tempo de inicialização do worker dentro de `pnpm quality` por lentidão do disco USB desta máquina.

**Sugestão de commit:** `feat: modela domínio financeiro com prisma`

## [x] PASSO 04 — Autenticação Google e sessão segura

**Objetivo:** permitir login Google e sessão própria sem expor tokens.

**Tarefas:** OAuth Authorization Code + PKCE/state/nonce; callback; cookies seguros; renovação/logout; guards; estados de usuário.

**Arquivos:** módulos `auth`, `users`, DTOs, guards e testes.

**Critérios de aceite:** login/callback seguros; sessão renovável/revogável; tokens ausentes do frontend; usuário bloqueado não acessa.

**Testes necessários:** state/nonce inválidos, replay, expiração, logout, bloqueio e sessão válida.

**Evidência (08/10/2026):** módulos `auth` e `users`, migration `20261008192955_auth_sessions` (`user_sessions`, `auth_login_attempts`, com `down.sql`). Backend com 62 testes unitários: adapter real `openid-client` contra um Google simulado rejeita nonce, audience, issuer, assinatura, expiração e state inválidos. Mais 21 testes de integração HTTP com Postgres real (50 no total), cobrindo login completo, cookies `HttpOnly`/`SameSite`/`Path`, PKCE e nonce coerentes, replay do callback, state ausente/trocado sem consumir a tentativa, tentativa expirada, falha e cancelamento no Google, e-mail não verificado, usuário bloqueado (sem sessão e com sessão cortada na hora), vínculo por e-mail sem roubo de conta, open redirect neutralizado, expiração do acesso, rotação do refresh, reuso do refresh revogando a sessão, logout idempotente e 503 sem configuração. Um teste de mutação (remover a checagem do cookie de state) foi detectado por 2 testes. No Docker: migration aplicada; login sem credenciais → 503, `/me` → 401; com credenciais fictícias, 302 para `accounts.google.com` com PKCE S256, `state`/`nonce` e só `openid email profile`; 62 + 50 testes passam dentro do container. `pnpm quality` passou por completo.

**Sugestão de commit:** `feat: implementa autenticação google e sessão segura`

## [x] PASSO 05 — RBAC, ownership e proteção de API

**Objetivo:** estabelecer autorização central antes de expor dados financeiros.

**Tarefas:** papéis ADMIN/USER; policies; ownership scopes; validação global; erros; CORS, headers, CSRF e rate limit.

**Arquivos:** `common/auth`, decorators, guards, filters e testes de segurança.

**Critérios de aceite:** USER só acessa recursos próprios; ADMIN usa rotas explícitas; nenhum IDOR ou mass assignment conhecido.

**Testes necessários:** matriz de permissões, IDs de outro usuário, payload extra, CSRF e limites.

**Evidência (08/10/2026):** infraestrutura em `src/common` (errors, validation, security), migration `20261008200737_session_csrf_token` com `down.sql`. Backend com 81 testes unitários (incluem rate limiter com relógio falso, filtro de erros, pipe Zod e origem) e 82 de integração; os 32 novos de `policy.int-spec.ts` usam um módulo de sondagem só de teste sobre a infraestrutura real. Cobrem:

- matriz anônimo/USER/ADMIN em 6 rotas e bootstrap de ADMIN por `ADMIN_EMAILS`;
- ID de outro usuário respondendo igual a ID inexistente, sem alterar nada, e ADMIN sem bypass;
- UUID inválido;
- campos extras `ownerId`/`id`/`role`/`isArchived` rejeitados sem persistir;
- valores inválidos sem eco, `413` acima do limite e JSON malformado;
- CSRF sem token, com token errado, com token de outro usuário e com token correto; token estável após refresh;
- origens `evil`/`null`/`Referer` estranho barradas, inclusive no logout público;
- contrato de erro com `X-Request-Id`, sem vazamento em 500, e unicidade → 409;
- headers de segurança, CORS permitido e negado;
- rate limit por rota, global e de `/auth`, com `429` e `Retry-After`.

Mutações no `RolesGuard` e no `CsrfGuard` foram detectadas pelos testes. No Docker, migration aplicada; via proxy do Vite, os headers de segurança chegam ao cliente; `401` no `/auth/csrf` sem sessão; `403 csrf_failed` para `Origin` estranha; preflight CORS aceito só para a origem do frontend; `413` com 1,1 MB. Testes 81 + 82 passam dentro do container e `pnpm quality` passou por completo.

**Sugestão de commit:** `feat: aplica rbac, ownership e proteção da api`

## [x] PASSO 06 — Perfil, preferências e internacionalização base

**Objetivo:** entregar perfil com PT/EN/ES, moeda, fuso e voz.

**Tarefas:** APIs de perfil; UI; catálogos i18n; datas/moedas; preferência de planilha/voz.

**Arquivos:** módulos `profile`, i18n frontend e páginas de perfil/configuração.

**Critérios de aceite:** preferências persistem; locale/fuso alteram apresentação; e-mail confiável não é arbitrariamente sobrescrito.

**Testes necessários:** validações, três idiomas, fusos e acesso de outro usuário.

**Evidência (08/10/2026):**

- **Backend**: módulo `profile` (`GET`/`PATCH /profile`) e e-mail sincronizado do Google verificado no login. 101 testes unitários (os novos validam três idiomas, fusos válidos e inválidos, moeda, telefone, foto, voz e preferências, além da rejeição de `email`/`userId`/`roles`). 96 de integração (14 novos de perfil): valores padrão, persistência de todos os campos, troca de idioma, mesclagem de preferências, limpeza com `null`, e-mail não alterável, CSRF obrigatório, isolamento entre usuários, ausência de rota por id e sincronização e conflito de e-mail no login.
- **Frontend**: i18n próprio pt-BR/en-US/es-ES, formatação `Intl`, cliente HTTP com CSRF e refresh, telas `/login` e `/profile`. 47 testes, cobrindo:
  - paridade de chaves e placeholders;
  - moeda por idioma sem erro de float;
  - instante no fuso do perfil;
  - data de calendário sem deslocamento;
  - diff de campos;
  - CSRF, refresh e retentativa do cliente;
  - perfil nos 3 idiomas;
  - prévia ao vivo;
  - salvamento só do que mudou com troca de idioma da UI;
  - erros por campo acessíveis;
  - login com erros traduzidos;
  - redirecionamento de anônimo.
- **Bug antigo corrigido**: o `typecheck` do frontend não verificava nenhum arquivo.
- **Docker, pelo proxy do Vite e com sessão sintética**: `GET /profile` 200; `PATCH` sem token 403; `PATCH` válido 200, refletido no `/auth/me`; `PATCH` com `email` 400; SPA servida em `/profile` e `/login`. As suítes passam nos containers (101 + 96 + 47) e `pnpm quality` passou por completo.

**Sugestão de commit:** `feat: adiciona perfil do usuário e preferências de localização`

## [x] PASSO 07 — Conexão Google e cofre de credenciais

**Objetivo:** separar consentimento Sheets/Drive do login e guardar credenciais criptografadas.

**Tarefas:** consentimento incremental; scopes mínimos; AES-256-GCM versionado; refresh; reconexão; revogação/desconexão.

**Arquivos:** módulos `google`, serviço criptográfico e testes.

**Critérios de aceite:** tokens nunca saem do backend; credencial em repouso é ilegível; revogação não apaga planilha.

**Testes necessários:** criptografia/rotação, refresh, revogado, scopes e ownership.

**Evidência (08/10/2026):**

- **Backend**: `CredentialVault` (AES-256-GCM, chaves versionadas, AAD por usuário e campo), módulos `crypto` e `google`, script `credentials:rotate` e migration `20261008213903_google_connection_attempts` com `down.sql` e CHECKs que só aceitam tokens cifrados. 121 testes unitários; os novos cobrem:
  - cofre: ida e volta, IV novo, contexto, adulteração de cada segmento e rotação v1→v2;
  - chaves no env: versões, tamanho e ausência de eco;
  - cliente OAuth real contra Google simulado: escopo mínimo, offline/incremental, PKCE/nonce, `invalid_grant` × falha temporária, revogação.
- **Integração**: 117 testes (21 novos):
  - estado sem tokens e anônimo → login;
  - tentativa vinculada a usuário e navegador; callback de outra sessão recusado sem consumir a tentativa; estados de login e conexão não se misturam;
  - escopo insuficiente; refresh token ausente ou mantido;
  - renovação perto da expiração; `invalid_grant` → `NEEDS_REAUTH` e reconexão; falha temporária mantém a conexão; token copiado para outro usuário não decifra;
  - desconexão revoga, apaga tokens e mantém planilhas; desconexão com falha remota; CSRF e isolamento;
  - CHECKs recusam texto puro; rotação de todas as credenciais; indisponível sem chave.
- **Frontend**: card "Conta Google conectada" no perfil, com desconexão confirmada e mensagens de retorno nos 3 idiomas. 56 testes.
- **Mutações detectadas**: AAD desligado (4 testes) e callback sem exigir o mesmo usuário (1 teste).
- **Docker**: migration aplicada; estado, redirecionamentos (anônimo → login, sem configuração → erro no perfil), `DELETE` com e sem CSRF; consentimento real com escopo `openid email drive.file`, `access_type=offline`, `prompt=consent`, `include_granted_scopes=true`, PKCE e `login_hint`; script de rotação executado. Suítes passam nos containers e `pnpm quality` passou por completo.

**Sugestão de commit:** `feat: protege o ciclo de vida da conexão com o google sheets`

## [x] PASSO 08 — Criação e formatação do Google Sheets

**Objetivo:** criar a planilha financeira profissional pelas APIs oficiais.

**Tarefas:** adapter Google; abas; cabeçalhos; formatos; filtros; congelamento; cores; fórmulas; IDs e versões ocultas.

**Arquivos:** `spreadsheets`, adapters, fixtures e testes.

**Critérios de aceite:** planilha completa, pertencente ao usuário, repetição idempotente e falhas claras.

**Testes necessários:** adapter fake, payloads Google, idempotência, token expirado e smoke real opt-in.

**Evidência (08/10/2026):**

- **Backend**: módulo `spreadsheets`:
  - cliente REST Drive/Sheets via `fetch`;
  - template declarativo em 3 idiomas;
  - construtor puro de `batchUpdate`;
  - serviço com trava, recuperação por `appProperties` e retentativa em 401;
  - migration `20261008220911_spreadsheet_setup` com `down.sql`.
- **Unitários**: 155 (34 de planilha), cobrindo:
  - payloads Google: 10 abas na ordem, aba padrão removida, metadados de planilha/aba/coluna, cabeçalhos traduzidos, colunas técnicas ocultas e protegidas, formatos de moeda/data, listas, filtros, cores, fórmulas e gráfico;
  - repetição sem criar nem duplicar nada;
  - aba renomeada pelo usuário e abas do usuário preservadas;
  - en-US/es-ES e padrões de moeda (BRL, USD, EUR, JPY);
  - cliente HTTP: URLs, corpo, `appProperties` e mapeamento de erros sem vazar o corpo da resposta.
- **Integração**: 134 (17 de planilha) com fake em memória do Drive/Sheets (lote atômico, exige aba existente, recusa duplicatas). Cobrem:
  - criação no Drive com o token do usuário e idioma/moeda/fuso do perfil;
  - segunda planilha não ativa;
  - repetição convergente com 1 arquivo;
  - recuperação após queda;
  - arquivo apagado recriado;
  - trava concorrente e trava vencida;
  - sem conexão, token expirado renovado, 401 com retentativa, acesso revogado;
  - indisponibilidade com nova tentativa sem duplicar; permissão negada; reparo com falha mantém `ACTIVE`;
  - ownership, CSRF, validação e falta de configuração (503).
- **Smoke real opcional**: `pnpm test:google` (pulado sem `RUN_GOOGLE_INTEGRATION_TESTS=true`).
- **Frontend**: card "Planilha financeira" no perfil. 63 testes.
- **Mutações detectadas**: metadados sempre recriados (idempotência) e busca por `appProperties` desligada (recuperação).
- **Docker**: migration aplicada; revelou que, sem chave de criptografia, a criação respondia 500. Corrigido para `503 google_connection_unavailable`, com teste. CSRF 403, payload inválido 400; suítes nos containers (155 + 133 + 63, antes do teste novo) e `pnpm quality` completo.

**Sugestão de commit:** `feat: cria planilhas financeiras formatadas`

## [x] PASSO 09 — Domínio financeiro e consultas

**Objetivo:** implementar contas, categorias, transações e agregações determinísticas.

**Tarefas:** regras de valores/datas/status; contas/cartões; categorias; CRUD interno; consultas por período; ActionHistory.

**Arquivos:** módulos financeiros, DTOs, domínio e testes.

**Critérios de aceite:** cálculos Decimal corretos; categorias iniciais; ownership em todas as operações; histórico funcional mínimo.

**Testes necessários:** receitas/despesas/transferências, moeda, datas, status, agregações, IDOR e transações atômicas.

**Evidência (09/10/2026):**

- **Backend**: módulo `finance` com serviços de contas, categorias, movimentações, consultas e histórico funcional, mais as rotas REST correspondentes. Sem migration nova: o schema do PASSO 03 já cobria o domínio.
- **Unitários**: 195 (40 de finanças), cobrindo:
  - parser de dinheiro sem float (casas por moeda, notação científica, separadores, negativos, `0.1 + 0.2`);
  - datas reais, limites de ano e virada de mês;
  - "hoje" em São Paulo, Tóquio e Kiritimati;
  - snapshots do histórico e diff mínimo.
- **Integração**: 162 (28 de finanças) com Postgres real e categorias semeadas, cobrindo:
  - contas: moeda do perfil, campos de cartão, nome duplicado, casas em JPY, saldo negativo, exclusão bloqueada e arquivamento;
  - despesa paga por padrão com saldo exato e conta pendente sem pagamento;
  - valores e datas inválidos;
  - moeda da conta e transferência entre moedas recusada;
  - transferências válidas e todas as inválidas; categoria × tipo; forma de pagamento de cartão; vínculo à planilha ativa;
  - edição com `version`, status e data de pagamento coerentes, histórico com diff mínimo, exclusão com snapshot completo;
  - **atomicidade** (falha no histórico desfaz a movimentação);
  - IDOR em 8 caminhos e mass assignment em 5 campos;
  - categorias traduzidas, subcategoria, nível excessivo, tipo, nome duplicado também contra as padrão, padrão somente leitura, em uso;
  - resumo por moeda, sem canceladas nem transferências, com participação por categoria raiz e maiores gastos;
  - séries por mês e por dia; busca por texto, categoria com subcategorias, valor, ordem e paginação;
  - períodos inválidos e longos;
  - vencidas e a vencer decididas pelo fuso do usuário (Kiritimati × Pago Pago) e janela de dias.
- **Mutações detectadas**: leitura sem `ownedBy` (IDOR) e canceladas contadas no resumo.
- **Bug real corrigido**: criar cartão descartava dia de fechamento, dia de vencimento e últimos dígitos.
- **Docker**, via proxy do Vite com sessão sintética: conta, despesa paga, saldo `912.55`, resumo do mês, `422 currency_mismatch` e histórico. Suítes nos containers (195 + 162 + 63) e `pnpm quality` completo.

**Sugestão de commit:** `feat: implementa o domínio financeiro principal`

## [x] PASSO 10 — Parcelas, recorrências e investimentos

**Objetivo:** cobrir regras financeiras avançadas sem filas.

**Tarefas:** parcelamento e arredondamento; frequências; materialização sob demanda; classes de investimento; consultas.

**Arquivos:** módulos `installments`, `recurring-transactions`, `investments` e testes.

**Critérios de aceite:** soma das parcelas igual ao total; datas válidas; recorrência idempotente; classes suportadas.

**Testes necessários:** 12x, resíduos de centavos, fim de mês, quinzenal/anual, duplicidade e ownership.

**Evidência (09/10/2026):**

- **Backend**: em `src/finance`, os serviços `InstallmentsService`, `RecurringTransactionsService`, `RecurrenceMaterializer` e `InvestmentsService`, as regras puras em `schedule.ts` e as rotas `/installments`, `/recurring-transactions` e `/investments` (com `/contributions` e `/summary`).
  - As validações vêm de `TransactionsService.prepare()`.
  - Sem migration nova: o schema do PASSO 03 já tinha as tabelas, as CHECKs e os índices únicos de parcela e ocorrência.
- **Unitários**: 210 no total, 15 deste passo:
  - 12x de 3.600 = 300,00; resíduo de centavos nas primeiras parcelas;
  - soma exata em 36 combinações de total × parcelas; JPY sem centavos; parcela zero recusada;
  - fim de mês sem deslize; fatura do cartão em volta do fechamento e da virada de ano;
  - mensal no dia 31 e no dia 30; semanal, quinzenal e personalizada (10 dias, 3 meses no dia 31, 2 anos);
  - anual em 29/02; data final e limite;
  - salto para janelas tardias igual a percorrer desde o início, em 7 regras.
- **Integração**: 179 no total, 17 deste passo, com Postgres real:
  - TV 12x no cartão, com fatura antes e no dia do fechamento;
  - resíduos e vencimentos de fim de mês;
  - validações; parcela travada (valor, exclusão) mas pagável; andamento da compra;
  - exclusão com snapshot completo; atomicidade da compra com 12 parcelas;
  - formato do calendário; aluguel todo dia 5 com **5 consultas simultâneas** sem duplicar; índice único como última barreira;
  - quinzenal, anual 29/02 e trimestral no dia 31;
  - horizonte de materialização (contas a vencer e limite de 366 dias);
  - edição propagando só para pendentes não editadas de hoje em diante, `version`, pausa e retomada sem duplicar, exclusão mantendo as editadas;
  - data final encurtada;
  - aporte em Bitcoin com saldo da conta e histórico; 10 classes e resumo por classe e moeda; aportes pendentes à parte;
  - moeda, quantidade inválida, categoria, tipo travado, investido derivado e exclusão bloqueada;
  - IDOR em 14 caminhos e mass assignment em 9 campos.
- **Mutações detectadas**:
  - materializador sem `ownedBy` (a consulta de outro usuário materializava a recorrência);
  - critério de "não editada" sem o valor (a ocorrência editada à mão era sobrescrita).
- **Docker**, via proxy do Vite com sessão sintética removida no fim:
  - TV 12x de 300,00 no cartão com primeiro vencimento em 10/11 (compra depois do fechamento);
  - parcela travada;
  - aluguel todo dia 5 materializado sob demanda (2 ocorrências);
  - aporte de 1.000 em Bitcoin com saldo da corrente em 4.000,00 e resumo por classe;
  - histórico.
- **Suítes nos containers**: 210 + 179. `pnpm quality` completo.

**Sugestão de commit:** `feat: adiciona parcelamentos, recorrências e investimentos`

## [x] PASSO 11 — Sincronização bidirecional e conflitos

**Objetivo:** manter PostgreSQL e Sheets coerentes com edição manual segura.

**Tarefas:** push/pull; checkpoints; versões; importação; deduplicação; `SYNCED/PENDING_SYNC/CONFLICT`; reconciliação.

**Arquivos:** serviços de sync, modelos/estado, endpoints e testes.

**Critérios de aceite:** não duplica registros; não perde mudança concorrente; exclusão de linha não exclui dado; mensagens refletem estado real.

**Testes necessários:** app-only, sheet-only, conflito, retry, indisponibilidade, linha inválida e prompt injection em célula.

**Evidência (09/10/2026):**

- **Backend**:
  - módulo `spreadsheets/sync`: `SheetSyncService`, adaptadores de Movimentações, Contas e Investimentos (Categorias só exportada) e o codec de células;
  - rotas `POST/GET /spreadsheets/:id/sync` e `POST /spreadsheets/:id/sync/conflicts/:recordId`;
  - migration `20261009030912_spreadsheet_sync` (tabela `spreadsheet_row_states` + trava `sync_started_at`, com `down.sql`);
  - cliente Google com leitura de valores (`values:batchGet` sem formatação) e posição das colunas por metadata.
- **Unitários**: 223 no total, 13 deste passo:
  - datas seriais e fuso; dinheiro exato a partir da célula; textos recusados;
  - listas traduzidas por posição; hash canônico;
  - escrita literal (texto com `=` não vira fórmula);
  - leitura por chave de coluna com coluna da pessoa no meio; agrupamento das escritas; estrutura obrigatória;
  - leitura de valores no cliente HTTP.
- **Integração**: 197 no total, 18 deste passo, com Postgres real e Google simulado com grade de células:
  - **só app**: exporta tudo como valor literal; segunda sincronização sem nenhuma escrita;
  - **edição no app**: reescreve a mesma linha;
  - **só planilha**: importa a edição pelo domínio, com histórico;
  - **linha nova**: importada uma vez; com o Google caindo no meio, o **retry vincula sem duplicar**;
  - conta e movimentação digitadas juntas;
  - **conflito**: o app vence, a linha da pessoa é preservada e a reconciliação funciona por `sheet` e por `app`;
  - edição inválida e parcela travada viram conflito e se resolvem quando a linha é corrigida;
  - **linha apagada não apaga dado**; registro apagado no app sai da planilha (ou fica como órfão, se editado);
  - ID de outro usuário e ID duplicado nunca importados (IDOR);
  - coluna inserida pela pessoa preservada;
  - **linha inválida**: 7 casos, com linha, código e coluna;
  - **prompt injection em célula** tratada como texto;
  - **indisponibilidade**: tudo fica pendente e a próxima sincronização recupera;
  - estrutura quebrada e planilha inativa recusadas; uma sincronização por vez;
  - contas e investimentos com suas regras.
- **Mutações detectadas**: texto com `=` escrito como fórmula; conflito não detectado; retry sem vínculo (duplicava).
- **Bug real corrigido durante o passo**: marcar `SYNCED` pelo Prisma atualizava `updated_at` e fazia toda sincronização reescrever todas as linhas. Agora o status é gravado por SQL direto, sem tocar em `updated_at`.
- **Docker**:
  - migration aplicada no container;
  - suítes nos containers (223 + 197);
  - teste manual das rotas com sessão sintética: status `200`; sync sem Google configurado `503 google_connection_unavailable`, com trava liberada e erro gravado; sem CSRF `403`; id inexistente `404`; corpo inválido `400`;
  - `pnpm quality` completo.
- **Não validado contra o Google real** (sem conta de teste): `values:batchGet`, `appendDimension` e `deleteDimension` seguem a documentação da API, mas falta o smoke real.

**Sugestão de commit:** `feat: sincroniza os dados financeiros com o google sheets`

## [x] PASSO 12 — Abstração multi-IA e administração de provedores

**Objetivo:** configurar OpenAI, Gemini e Claude com prioridade segura.

**Tarefas:** interfaces; factory; credenciais criptografadas; modelos/finalidades; tela admin; fallback classificado.

**Arquivos:** `ai-providers`, `admin`, adapters e testes.

**Critérios de aceite:** frontend não recebe chaves; prioridade funciona; erro inválido não causa fallback; indisponibilidade recuperável causa.

**Testes necessários:** provider fakes, matriz de erros, RBAC admin, criptografia e ausência de vazamento.

**Evidência (09/10/2026):**

- **Backend**:
  - `src/ai`: contrato comum de chat e tool calling; adaptadores HTTP de OpenAI (Chat Completions), Gemini (`generateContent`) e Anthropic (Messages); classificação de falhas; `AiService` com prioridade e fallback; `probe`; `rotateAiCredentials`;
  - `src/admin`: rotas `/admin/ai-providers` e `/admin/ai-configurations` com `@Roles('ADMIN')`;
  - seed dos três provedores (inativos); `AI_REQUEST_TIMEOUT_MS` e chaves e modelos opcionais do servidor no `env`;
  - `credentials:rotate` também cobre as chaves de IA.
- **Frontend**: tela `/admin/ai` em pt-BR, en-US e es-ES. O link "Administração" aparece só para admins, e a rota é bloqueada para os demais.
- **Unitários do backend**: 268 no total, 45 deste passo:
  - os três adaptadores com fetch falso: mapeamento de mensagens, ferramentas, resultados de ferramenta e uso;
  - chave só no header (nunca na URL ou no corpo); recusas, filtros e respostas malformadas;
  - **matriz de erros** de 11 status × 3 provedores, com classificação e recuperabilidade, sem vazar a chave nem o prompt;
  - rede, timeout real por `AbortSignal` e corpo não JSON;
  - variáveis de ambiente novas.
- **Integração**: 217 no total, 20 deste passo, com provedores falsos programáveis e Postgres real:
  - **RBAC** (`401` anônimo, `403` usuário comum em listar, criar e reordenar) e CSRF;
  - DTO estrito (`apiKeyEncrypted`, `encryptionKeyVersion`, chave com espaço, modelo inválido, finalidade desconhecida, prioridade 0);
  - **criptografia**: cifra `v1.` no banco, decifra só com o contexto certo, cifra copiada para outra configuração vira `credential_unreadable`;
  - **ausência de vazamento**: nenhuma resposta contém a chave nem a cifra, e a resposta só tem os campos permitidos;
  - troca e remoção de chave; chave do servidor como reserva; rotação `v1` → `v2`;
  - **prioridade** e reordenação; prioridade ou configuração repetida dá `409`;
  - **fallback** em cada uma das 6 falhas recuperáveis; **nenhum fallback** em `invalid_request` e `content_blocked` (`422`, os outros provedores não são chamados);
  - provedor travado cortado pelo timeout; todos falhando dão `503` com as tentativas e sem chaves;
  - inativos e sem chave pulados; nenhuma configuração dá `503 ai_not_configured`; finalidades separadas;
  - teste de conexão sem fallback.
- **Frontend**: 72 testes, 9 deste passo:
  - lista, origem da chave, campos de senha vazios;
  - nova configuração esvazia a chave depois do envio; troca e remoção de chave;
  - teste com sucesso e falha explicada; reordenação;
  - erro `409` explicado; não admin vê área restrita; inglês e espanhol; link e bloqueio da rota.
- **Mutações detectadas**: fallback depois de erro inválido; cifra vazando na resposta admin; rota admin sem `@Roles`.
- **Docker**:
  - seed com os três provedores inativos;
  - suítes nos containers (268 + 217 + 72);
  - teste manual com sessões sintéticas removidas no fim: usuário comum `403`; admin lista; chave sem criptografia configurada dá `503 encryption_unavailable`, sem nada gravado; configuração sem chave e teste `not_configured`; página `/admin/ai` servida;
  - `pnpm quality` completo.
- **Não validado contra as APIs reais** (sem chaves de teste): os formatos seguem a documentação de cada provedor; `RUN_AI_INTEGRATION_TESTS` continua reservado para um smoke real.

**Sugestão de commit:** `feat: adiciona provedores de ia configuráveis com fallback`

## [x] PASSO 13 — Tool Registry e executor seguro

**Objetivo:** criar a única ponte permitida entre IA e domínio.

**Tarefas:** schemas versionados; allowlist; autorização; confirmação; resultados; tools financeiras/planilha/relatório/voz.

**Arquivos:** `assistant/tools`, contratos e testes.

**Critérios de aceite:** nenhuma ferramenta ignora usuário/permissão; argumento extra é rejeitado; destrutivas ambíguas não executam.

**Testes necessários:** cada tool, tool inexistente, schema inválido, IDOR, confirmação expirada e injeção.

**Evidência (09/10/2026):**

- **Backend**:
  - `src/assistant/tools`: `ToolSpec`/`ToolOutcome`; `ToolRegistry` (allowlist, JSON Schema estrito, filtro por papel); `ToolExecutor` (validação, papel, conversa, ambiguidade, confirmação, execução, sincronização);
  - 30 ferramentas financeiras, de planilha e de voz, com resolução por nome restrita ao usuário;
  - rotas `GET /assistant/tools`, `GET /assistant/confirmations` e `POST /assistant/confirmations/:id/confirm|cancel`;
  - migration `20261009035926_assistant_confirmations` (CHECKs, triggers de dono, `down.sql`);
  - `AccountsService` e `CategoriesService` passaram a registrar `conversationId` no histórico.
- **Relatórios**: ficam com o PASSO 19, que cria a geração. Registrar uma ferramenta sem geração levaria o modelo a prometer o que não existe.
- **Unitários**: 274 no total, 6 deste passo:
  - contrato do registro: nomes únicos, versão, descrição, schema estrito, nenhum campo de usuário ou confirmação;
  - destrutivas com `prepare`; filtro por papel;
  - hash independente da ordem;
  - texto do usuário sem escapar do JSON.
- **Integração**: 233 no total, 16 deste passo, com Postgres real e Google simulado:
  - **cada ferramenta** (contas, categorias, transações por nome, resumo, séries, contas a vencer e vencidas, parcelas, recorrência, investimento e aporte, voz, planilha);
  - **ferramenta inexistente** (inclusive nomes "de comando" e de 500 caracteres);
  - **schema inválido** (`ownerId`, `userId`, `confirmed`, `confirmationId`, `role`, tipo errado, id e nome juntos), sem ecoar valores;
  - papel ausente; conversa de outra pessoa;
  - **IDOR** em 8 ferramentas e na confirmação ou cancelamento de outra pessoa;
  - **destrutiva ambígua** ("apague o gasto do mercado" com 3 candidatos) não executa;
  - confirmação só pelo usuário (CSRF), uso único;
  - **confirmação expirada**, cancelada, alvo alterado e alvo apagado;
  - todas as destrutivas com confirmação; parcela recusada antes;
  - **injeção** em descrição e observação tratada como dado;
  - sincronização depois de escrita (`SYNCED`, `PENDING_SYNC` com Google fora do ar).
- **Mutações detectadas**: papel não verificado; destrutiva sem confirmação; hash do alvo ignorado; validade ignorada.
- **Docker**:
  - migration aplicada; suítes nos containers (274 + 233);
  - teste manual com sessão sintética removida: 30 ferramentas (5 destrutivas), anônimo `401`, confirmação sem CSRF `403`, confirmação executa a exclusão (histórico `CREATE,DELETE`), segunda vez `409 confirmation_used`, id inexistente `404`;
  - `pnpm quality` completo.

**Sugestão de commit:** `feat: implementa execução autorizada de ferramentas do assistente`

## [x] PASSO 14 — Assistente e contexto conversacional

**Objetivo:** entregar interpretação, diálogo, memória contextual e respostas fundamentadas.

**Tarefas:** conversas/mensagens; IntentService; contexto seguro; follow-ups; sugestões; estados; confirmação pós-ação.

**Arquivos:** módulo `assistant`, APIs e testes.

**Critérios de aceite:** frases do prompt resolvem corretamente; follow-up mantém período/categoria; números vêm de tools; ambiguidade pergunta.

**Testes necessários:** corpus PT/EN/ES, contexto, alucinação numérica, falhas de provider e prompt injection.

**Evidência (09/10/2026):**

- **Backend**:
  - `AssistantService`: turno com laço modelo ↔ ferramentas, guarda de números com uma correção, estados (`answered`, `needs_confirmation`, `needs_clarification`, `error`), respostas fixas localizadas para falhas e confirmação ou cancelamento pós-ação na conversa;
  - `ConversationService`: mensagens em ordem estrita, histórico que começa numa mensagem do usuário, contexto estruturado atualizado só por ferramentas e revalidado contra o banco;
  - `IntentService`: idioma pt/en/es, tipo (comando, pergunta, conversa) e finalidade da IA, com reserva em `CHAT`;
  - `grounding.ts`; prompt e textos em `assistant.messages.ts`;
  - rotas `/assistant/messages`, `/conversations`, `/conversations/:id/messages`, `/conversations/:id/confirmations/:cid/confirm|cancel` e `/suggestions`;
  - política de limite `assistant` (`ASSISTANT_RATE_LIMIT_MAX_REQUESTS`). Sem migration: `conversations` e `conversation_messages` já existiam.
- **Unitários**: 301 no total, 27 deste passo:
  - **corpus PT/EN/ES** com as frases do PROMPT (idioma, tipo e finalidade);
  - números em formatos pt/en/es; valores com moeda e percentuais citados;
  - aceitação de valores das ferramentas, arredondamento e combinações; recusa de inventados;
  - regras do prompt; textos fixos e sugestões nos três idiomas.
- **Integração**: 247 no total, 14 deste passo, com modelo roteirizado e Postgres real:
  - "Gastei 89 reais de gasolina hoje" de ponta a ponta (ferramenta, data de hoje, histórico com a conversa, mensagens gravadas, provedor);
  - **contexto** "E no mês passado?" (período e categoria revalidados) e "Qual delas é a maior?" a partir de resultados anteriores;
  - **alucinação numérica**: uma correção e retorno aterrado; insistência vira resposta fixa, sem gravar o valor inventado;
  - **falhas de provedor**: indisponível (resposta fixa no idioma do usuário), reserva no próximo provedor, finalidade configurada, requisição inválida sem fallback, sem configuração, laço infinito cortado;
  - confirmação na conversa (outra conversa `404`, CSRF, uso único) e ambiguidade com candidatos e cancelamento;
  - **prompt injection** com modelo "sequestrado" (confirmar, `ownerId`, ids de outra pessoa, ferramenta inexistente: tudo recusado; dados nunca no prompt de sistema);
  - IDOR de conversas e validação da mensagem.
- **Mutações detectadas**: guarda de números desligada; contexto sem a categoria; confirmação aceita fora da própria conversa.
- **Bug de teste corrigido**: o fake de IA guardava a requisição por referência e via mensagens adicionadas depois; agora guarda uma cópia, como um adaptador real.
- **Docker**:
  - suítes nos containers (301 + 247);
  - teste manual sem provedor configurado: turno `error`/`ai_not_configured` com a frase fixa em português e em inglês; conversas, mensagens e sugestões; mensagem vazia `400`; sem CSRF `403`;
  - título com acento gravado corretamente quando o corpo vai em UTF-8;
  - `pnpm quality` completo.
- **Não validado com modelos reais** (sem chaves): o laço e a guarda foram exercitados com um modelo roteirizado. A qualidade da interpretação depende do provedor configurado.

**Sugestão de commit:** `feat: entrega o assistente financeiro com contexto conversacional`

## [x] PASSO 15 — Undo e operações destrutivas

**Objetivo:** permitir desfazer com segurança e controlar exclusões críticas.

**Tarefas:** reversores por ação; tokens de confirmação; exclusões de histórico/dados/planilha/conta; sincronização da reversão.

**Arquivos:** `action-history`, policies, endpoints e testes.

**Critérios de aceite:** última ação elegível é restaurada; ação irreversível é explicada; alvos mudados invalidam confirmação.

**Testes necessários:** undo create/update/delete, concorrência, expiração, duplo uso e ownership.

**Evidência (09/10/2026):**

- **Backend**:
  - `UndoService`: reversores genéricos por entidade (criação, edição, exclusão), com tratamento de parcelas e de ocorrências de recorrência;
  - lote por transação (`batch_id`) e auditoria do undo (`undo_of_id`);
  - ferramentas `undo_last_action`, `delete_conversation_history`, `delete_financial_data`, `delete_spreadsheet` (lixeira do Drive) e `delete_my_account`;
  - rotas `POST /assistant/undo` e `POST /assistant/data-deletions`;
  - confirmação configurável (`preferences.confirmSimpleDeletes`);
  - textos pós-confirmação por tipo;
  - migration `20261009050357_action_history_undo` (colunas, índice, FK, CHECK, `down.sql`);
  - `trashFile` no cliente do Drive.
- **Frontend**: controle "Pedir confirmação antes de excluir um lançamento" no perfil (pt/en/es).
- **Unitários**: 302 no total, contrato do registro atualizado e textos pós-confirmação.
- **Integração**: 264 no total, 17 deste passo:
  - **undo de criação, edição e exclusão** (mesmo id restaurado, versão e `PENDING_SYNC`), repetido indo mais para trás sem refazer, auditoria;
  - lote do aporte; compra parcelada e recorrência restauradas;
  - alvo alterado fora do histórico, referência que impede (com rollback) e ação irreversível, todos explicados;
  - **concorrência**: 3 undos simultâneos, um vence;
  - **ownership**;
  - undo pelo assistente com conversa e sincronização da reversão na planilha;
  - confirmação configurável (direto, desfazível; ambiguidade e outros tipos continuam perguntando);
  - histórico de conversas (alvo mudado → `stale`, outra pessoa `404`, **duplo uso** `409`);
  - conversa que se apaga ainda responde;
  - dados financeiros (escopo do usuário, categorias do sistema intactas);
  - planilha (lixeira do Drive; falha do Google não apaga nada);
  - conta (sessão encerrada, Google revogado, outros intactos);
  - **expiração** `410` e validação do pedido.
- **Mutações detectadas**: alvo alterado ignorado; trava de concorrência removida; exclusão de dados sem filtro de dono.
- **Bug real corrigido**: undo em vários passos falhava porque a comparação incluía a versão, que o próprio undo incrementa. Agora compara conteúdo, inclusive nas parcelas.
- **Bugs corrigidos durante os testes**: rótulo vazio no undo de edição (agora vem do registro); falha do Google ao excluir planilha virava `internal_error` (agora `google_unavailable` etc.).
- **Docker**:
  - migration aplicada; suítes nos containers (302 + 264 + 73);
  - teste manual: undo da edição (20 → 10), da criação e "nada a desfazer"; exclusão de dados com resumo, confirmada, segundo uso `confirmation_used`, histórico apagado;
  - `pnpm quality` completo.

**Sugestão de commit:** `feat: adiciona desfazer seguro e confirmações destrutivas`

## [x] PASSO 16 — Interface conversacional premium

**Objetivo:** tornar o chat a experiência principal em desktop e mobile.

**Tarefas:** shell responsivo; chat; bolhas/tool feedback; skeletons; sugestões; botão flutuante; motion; acessibilidade.

**Arquivos:** páginas/componentes frontend, rotas e estilos.

**Critérios de aceite:** nenhuma tela de formulário financeiro; navegação acessível; feedback completo; design não genérico.

**Testes necessários:** componentes, teclado, leitor de tela básico, 320/375/768/desktop, overflow e estados de erro.

**Evidência (09/10/2026):**

- **Shell**: `/` é o chat para quem está logado (`?c=<conversa>`) e uma landing com o orbe e "Entrar com Google" para visitantes; rotas desconhecidas voltam para `/`; navegação com `NavLink` (`aria-current`); botão flutuante do assistente nas demais páginas.
- **Visual**: tokens de tema em CSS (escuro "espaço profundo" ciano/violeta/magenta e claro), grade holográfica, vidro fosco, gradientes; tema do perfil aplicado (`system` segue o sistema operacional).
- **Animação de frequência**: `VoiceOrb` em canvas, com 72 barras radiais em volta de um núcleo luminoso:
  - respira em repouso;
  - "cometa" girando enquanto pensa;
  - espectro tipo voz enquanto a resposta é escrita (efeito de digitação + equalizador na bolha);
  - vermelho em erro;
  - aceita um `AnalyserNode` real para a voz do PASSO 17.
- **Chat**:
  - bolhas com hora;
  - chips de ferramenta (feito, aguarda confirmação, precisa de escolha, recusado, falhou + estado da planilha);
  - cartões de escolha para ambiguidade (respondem ao assistente com o id);
  - cartão de confirmação com resumo localizado (valor, data, conta…) e contagem regressiva, confirmar/cancelar dentro da conversa;
  - "Desfazer";
  - sugestões; histórico de conversas (coluna no desktop, gaveta no celular);
  - skeletons; erros com "Tentar de novo" (texto devolvido à caixa);
  - caixa de mensagem com Enter/Shift+Enter;
  - microfone visível e desabilitado até o PASSO 17.
- **Acessibilidade**:
  - `role="log"` com a resposta inteira para leitor de tela (a digitação é só visual);
  - estado do assistente em `role="status"`;
  - gaveta com `aria-expanded`/`aria-controls`, `inert` quando fechada e Escape devolvendo o foco;
  - alvos de 44 px; foco visível;
  - movimento reduzido: orbe estático, texto inteiro de uma vez e animações CSS/framer-motion desligadas.
- **Backend**: `GET /assistant/confirmations` passa a devolver `conversationId`.
- **Testes**:
  - frontend 97 (+24): página do chat (14), orbe (sinal, quadros, movimento reduzido), modelo do chat, tema e App;
  - backend 302 unitários e 264 de integração (`conversationId` nas confirmações pendentes).
- **Mutações detectadas**: filtro de confirmações por conversa removido; Shift+Enter enviando (a primeira versão do teste não pegava: corrigido).
- **Responsivo no Chrome real** (Playwright com API simulada) em 320, 375, 768 e 1280:
  - sem rolagem horizontal nem elemento além da tela;
  - estados Pensando → Respondendo → Pronto;
  - ordem de Tab; gaveta; erro 429; tema claro; botão flutuante; movimento reduzido sem cursor de digitação.
- **Docker**: suítes nos containers (302 + 264 + 97); `pnpm quality` completo.

**Sugestão de commit:** `feat: entrega a interface conversacional futurista`

## [x] PASSO 17 — Voz completa

**Objetivo:** implementar ouvir -> transcrever -> executar -> responder -> falar.

**Tarefas:** MediaRecorder; providers STT/TTS; estados animados; transcrição; preferência de voz; limites e fallback texto.

**Arquivos:** módulos `voice`, hooks/componentes de microfone e testes.

**Critérios de aceite:** estados acessíveis; áudio descartado; operação sensível confirmável; mobile prioriza microfone.

**Testes necessários:** permissões negadas, MIME/tamanho, provider indisponível, preferência e fluxo E2E simulado.

**Evidência (09/10/2026):**

- **Backend** (`src/voice`):
  - `GET /voice/capabilities`, `POST /voice/transcriptions` (áudio cru `audio/*`) e `POST /voice/speech` (`{ messageId }`);
  - provedores OpenAI e Gemini para STT e TTS, em ordem de fallback (`STT_PROVIDER`/`TTS_PROVIDER`), com as mesmas regras de falha recuperável do chat;
  - validação de MIME (lista fechada) **e** da assinatura dos bytes; limite de tamanho no parser (`MAX_AUDIO_SIZE_MB`);
  - áudio só em memória e zerado ao fim da requisição;
  - fala só de respostas do assistente do próprio usuário, com a voz do perfil (feminina/masculina);
  - rate limit `voice` (`VOICE_RATE_LIMIT_MAX_REQUESTS`).
- **Frontend**:
  - `useRecorder` (MediaRecorder, microfone liberado ao parar, limite de duração, descarte com Esc) e `useSpeech` (reprodução com a velocidade do perfil);
  - orbe com o **espectro real** do microfone ao ouvir e da voz ao falar;
  - estados Pronto → Ouvindo → Interpretando → Executando → Respondendo;
  - a transcrição vira mensagem comum (aparece no chat e passa pelas mesmas confirmações);
  - resposta lida em voz alta quando a pergunta foi falada ou com "ler respostas em voz alta" ligado; botão "Ouvir" em cada resposta e "Parar a fala";
  - com a caixa vazia o microfone é a ação principal (maior no celular);
  - erros de permissão, sem microfone, navegador sem gravação, gravação curta/grande e provedor indisponível explicados, sempre com o texto disponível.
- **Bug real corrigido**: numa conversa nova, uma resposta imediata (caso da voz) perdia a mensagem do usuário, porque o `receive` lia uma cópia antiga das mensagens locais.
- **Testes**:
  - backend 315 unitários (+13: áudio, WAV, clientes OpenAI/Gemini, texto falável, env) e 278 de integração (+14 de voz);
  - frontend 107 (+10 de voz com MediaRecorder, microfone, AudioContext e áudio simulados).
- **Mutações detectadas**: assinatura do áudio ignorada; buffer não descartado; fala de mensagem de outro usuário; mensagem do usuário perdida numa resposta imediata.
- **Chrome real** (microfone falso do Chrome, MediaRecorder e AnalyserNode reais, API simulada) em 375 e 1280:
  - upload `audio/webm` com assinatura EBML e CSRF;
  - estados na ordem; a fala tocou até o fim e voltou a "Pronto";
  - permissão negada em 320 e voz desligada no servidor.
- **Docker**: suítes nos containers (315 + 278 + 107); `pnpm quality` completo.

**Sugestão de commit:** `feat: adiciona interação completa por voz`

## [x] PASSO 18 — Dashboard e insights financeiros

**Objetivo:** oferecer visão financeira visual baseada nos mesmos dados.

**Tarefas:** cards; filtros; Recharts; fluxo de caixa; patrimônio; categorias; insights comparativos; estados vazios.

**Arquivos:** `dashboard`, `insights`, páginas e gráficos.

**Critérios de aceite:** períodos corretos; gráficos responsivos; valores coincidem com consultas; sem aconselhamento enganoso.

**Testes necessários:** agregações, limites de data/fuso, acessibilidade de gráficos e responsividade.

**Evidência (09/10/2026):**

- **Backend** (`src/dashboard`):
  - `GET /dashboard?period=today|week|month|3m|6m|year|custom&from&to`;
  - períodos no fuso do perfil, semana conforme `weekStartsOn`, unidades de calendário inteiras e o período anterior equivalente para comparação;
  - séries diárias até 62 dias e mensais acima disso, sem buracos;
  - por moeda (nunca somadas):
    - cards: patrimônio, saldo em contas, receitas, despesas, economia realizada, aportes, a pagar em 7 dias e vencidas;
    - fluxo de caixa, evolução patrimonial, gastos por categoria e investimentos por classe;
  - tudo calculado pelas mesmas consultas de `/finance/*`, `/accounts` e `/investments/summary`.
- **Insights determinísticos**:
  - contas vencidas e a vencer;
  - variação de despesas contra o período anterior;
  - despesas em % da receita;
  - categoria que mais cresceu e maior categoria;
  - taxa de economia dos últimos 3 meses.

  Têm limiares contra ruído, nunca dividem por zero, mostram o período analisado e trazem aviso de que não são recomendação. Também estão disponíveis para o assistente (`get_financial_insights`).

- **Frontend** (`/dashboard`, "Painel"):
  - seletor de período e período personalizado validado; seletor de moeda;
  - cards com comparação e pendências; insights em frases (pt/en/es);
  - quatro gráficos Recharts responsivos, cada um com resumo em frase e **tabela de dados acessível**, e o desenho escondido de leitores de tela;
  - listas de contas;
  - estados vazio, erro com repetição e carregando;
  - tema claro/escuro; página carregada sob demanda (chunk próprio).
- **Testes**:
  - backend 324 unitários (+9: períodos, fuso, semana, bissexto, buckets e insights) e 286 de integração (+8: painel igual às rotas existentes, insights, séries mensais e patrimônio, fuso, semana, período personalizado, posse e ferramenta do assistente);
  - frontend 119 (+12).
- **Mutações detectadas**: entrada de transferências fora do patrimônio; período anterior trocado pelo atual; limiar de participação da categoria removido.
- **Chrome real**:
  - 320, 375, 768 (claro) e 1280 (escuro e claro): sem rolagem horizontal e gráficos desenhados;
  - nada focável dentro do gráfico escondido; troca de período e personalizado enviados certo.
  - **Corrigidos depois da verificação**: o painel estourava para 626 px no celular (trilhas do grid sem `minmax(0, 1fr)`), e a pizza do Recharts deixava um elemento focável dentro do `aria-hidden`.
- **Docker**: suítes nos containers (324 + 286 + 119); `pnpm quality` completo.

**Sugestão de commit:** `feat: adiciona painel financeiro e insights baseados nos dados`

## [ ] PASSO 19 — Relatórios PDF e XLSX

**Objetivo:** gerar e baixar todos os relatórios pedidos, inclusive pelo chat.

**Tarefas:** templates; geradores; autorização; expiração; limites síncronos; tool `generateReport`.

**Arquivos:** módulo `reports`, templates e testes.

**Critérios de aceite:** tipos previstos; totais coerentes; arquivos legíveis; download isolado por usuário.

**Testes necessários:** conteúdo, layout, XLSX, PDF, IDOR, expiração e volume excedido.

**Sugestão de commit:** `feat: generate secure pdf and xlsx reports`

## [ ] PASSO 20 — Painel administrativo

**Objetivo:** administrar usuários, papéis, integrações e configurações globais.

**Tarefas:** dashboard; usuários/status; admins/permissões; provedores/modelos; STT/TTS; consumo estimado.

**Arquivos:** APIs/admin frontend e testes.

**Critérios de aceite:** somente ADMIN; segredos mascarados e nunca retornados; mudanças validadas.

**Testes necessários:** RBAC, promoção/rebaixamento seguro, bloqueio, configuração e vazamento de chave.

**Sugestão de commit:** `feat: implement secure administration console`

## [ ] PASSO 21 — Privacidade, exclusão e endurecimento

**Objetivo:** concluir direitos do titular e revisão de segurança/LGPD.

**Tarefas:** desconexão; exclusões; exportação; retenção; CSP; revisão OWASP; dependências; limites; redaction de erros.

**Arquivos:** módulos afetados, políticas e documentação.

**Critérios de aceite:** fluxos completos e confirmados; nenhuma referência órfã; documentação de retenção; revisão sem achados críticos.

**Testes necessários:** exclusão integral, falha parcial, revogação, exportação, scanners e testes de abuso.

**Sugestão de commit:** `feat: complete privacy and security hardening`

## [ ] PASSO 22 — Validação final e preparação de entrega

**Objetivo:** validar o produto completo em Docker e preparar operação.

**Tarefas:** suíte total; E2E; QA responsiva; acessibilidade; performance; documentação; runbook; matriz de rastreabilidade.

**Arquivos:** testes, documentação e configurações finais.

**Critérios de aceite:** Compose do zero; migrations; testes verdes; fluxos críticos completos; nenhum requisito crítico sem evidência.

**Testes necessários:** lint, typecheck, unit, integration, E2E, build, Docker smoke, segurança, mobile e acessibilidade.

**Sugestão de commit:** `chore: validate release readiness`
