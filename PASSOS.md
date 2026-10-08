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

## [ ] PASSO 07 — Conexão Google e cofre de credenciais

**Objetivo:** separar consentimento Sheets/Drive do login e guardar credenciais criptografadas.

**Tarefas:** consentimento incremental; scopes mínimos; AES-256-GCM versionado; refresh; reconexão; revogação/desconexão.

**Arquivos:** módulos `google`, serviço criptográfico e testes.

**Critérios de aceite:** tokens nunca saem do backend; credencial em repouso é ilegível; revogação não apaga planilha.

**Testes necessários:** criptografia/rotação, refresh, revogado, scopes e ownership.

**Sugestão de commit:** `feat: secure google sheets connection lifecycle`

## [ ] PASSO 08 — Criação e formatação do Google Sheets

**Objetivo:** criar a planilha financeira profissional pelas APIs oficiais.

**Tarefas:** adapter Google; abas; cabeçalhos; formatos; filtros; congelamento; cores; fórmulas; IDs e versões ocultas.

**Arquivos:** `spreadsheets`, adapters, fixtures e testes.

**Critérios de aceite:** planilha completa, pertencente ao usuário, repetição idempotente e falhas claras.

**Testes necessários:** adapter fake, payloads Google, idempotência, token expirado e smoke real opt-in.

**Sugestão de commit:** `feat: create formatted financial spreadsheets`

## [ ] PASSO 09 — Domínio financeiro e consultas

**Objetivo:** implementar contas, categorias, transações e agregações determinísticas.

**Tarefas:** regras de valores/datas/status; contas/cartões; categorias; CRUD interno; consultas por período; ActionHistory.

**Arquivos:** módulos financeiros, DTOs, domínio e testes.

**Critérios de aceite:** cálculos Decimal corretos; categorias iniciais; ownership em todas as operações; histórico funcional mínimo.

**Testes necessários:** receitas/despesas/transferências, moeda, datas, status, agregações, IDOR e transações atômicas.

**Sugestão de commit:** `feat: implement core financial domain`

## [ ] PASSO 10 — Parcelas, recorrências e investimentos

**Objetivo:** cobrir regras financeiras avançadas sem filas.

**Tarefas:** parcelamento e arredondamento; frequências; materialização sob demanda; classes de investimento; consultas.

**Arquivos:** módulos `installments`, `recurring-transactions`, `investments` e testes.

**Critérios de aceite:** soma das parcelas igual ao total; datas válidas; recorrência idempotente; classes suportadas.

**Testes necessários:** 12x, resíduos de centavos, fim de mês, quinzenal/anual, duplicidade e ownership.

**Sugestão de commit:** `feat: add installments recurrences and investments`

## [ ] PASSO 11 — Sincronização bidirecional e conflitos

**Objetivo:** manter PostgreSQL e Sheets coerentes com edição manual segura.

**Tarefas:** push/pull; checkpoints; versões; importação; deduplicação; `SYNCED/PENDING_SYNC/CONFLICT`; reconciliação.

**Arquivos:** serviços de sync, modelos/estado, endpoints e testes.

**Critérios de aceite:** não duplica registros; não perde mudança concorrente; exclusão de linha não exclui dado; mensagens refletem estado real.

**Testes necessários:** app-only, sheet-only, conflito, retry, indisponibilidade, linha inválida e prompt injection em célula.

**Sugestão de commit:** `feat: synchronize financial data with google sheets`

## [ ] PASSO 12 — Abstração multi-IA e administração de provedores

**Objetivo:** configurar OpenAI, Gemini e Claude com prioridade segura.

**Tarefas:** interfaces; factory; credenciais criptografadas; modelos/finalidades; tela admin; fallback classificado.

**Arquivos:** `ai-providers`, `admin`, adapters e testes.

**Critérios de aceite:** frontend não recebe chaves; prioridade funciona; erro inválido não causa fallback; indisponibilidade recuperável causa.

**Testes necessários:** provider fakes, matriz de erros, RBAC admin, criptografia e ausência de vazamento.

**Sugestão de commit:** `feat: add configurable ai provider fallback`

## [ ] PASSO 13 — Tool Registry e executor seguro

**Objetivo:** criar a única ponte permitida entre IA e domínio.

**Tarefas:** schemas versionados; allowlist; autorização; confirmação; resultados; tools financeiras/planilha/relatório/voz.

**Arquivos:** `assistant/tools`, contratos e testes.

**Critérios de aceite:** nenhuma ferramenta ignora usuário/permissão; argumento extra é rejeitado; destrutivas ambíguas não executam.

**Testes necessários:** cada tool, tool inexistente, schema inválido, IDOR, confirmação expirada e injeção.

**Sugestão de commit:** `feat: implement authorized assistant tool execution`

## [ ] PASSO 14 — Assistente e contexto conversacional

**Objetivo:** entregar interpretação, diálogo, memória contextual e respostas fundamentadas.

**Tarefas:** conversas/mensagens; IntentService; contexto seguro; follow-ups; sugestões; estados; confirmação pós-ação.

**Arquivos:** módulo `assistant`, APIs e testes.

**Critérios de aceite:** frases do prompt resolvem corretamente; follow-up mantém período/categoria; números vêm de tools; ambiguidade pergunta.

**Testes necessários:** corpus PT/EN/ES, contexto, alucinação numérica, falhas de provider e prompt injection.

**Sugestão de commit:** `feat: deliver contextual financial assistant`

## [ ] PASSO 15 — Undo e operações destrutivas

**Objetivo:** permitir desfazer com segurança e controlar exclusões críticas.

**Tarefas:** reversores por ação; tokens de confirmação; exclusões de histórico/dados/planilha/conta; sincronização da reversão.

**Arquivos:** `action-history`, policies, endpoints e testes.

**Critérios de aceite:** última ação elegível é restaurada; ação irreversível é explicada; alvos mudados invalidam confirmação.

**Testes necessários:** undo create/update/delete, concorrência, expiração, duplo uso e ownership.

**Sugestão de commit:** `feat: add safe undo and destructive confirmations`

## [ ] PASSO 16 — Interface conversacional premium

**Objetivo:** tornar o chat a experiência principal em desktop e mobile.

**Tarefas:** shell responsivo; chat; bolhas/tool feedback; skeletons; sugestões; botão flutuante; motion; acessibilidade.

**Arquivos:** páginas/componentes frontend, rotas e estilos.

**Critérios de aceite:** nenhuma tela de formulário financeiro; navegação acessível; feedback completo; design não genérico.

**Testes necessários:** componentes, teclado, leitor de tela básico, 320/375/768/desktop, overflow e estados de erro.

**Sugestão de commit:** `feat: build premium conversational interface`

## [ ] PASSO 17 — Voz completa

**Objetivo:** implementar ouvir -> transcrever -> executar -> responder -> falar.

**Tarefas:** MediaRecorder; providers STT/TTS; estados animados; transcrição; preferência de voz; limites e fallback texto.

**Arquivos:** módulos `voice`, hooks/componentes de microfone e testes.

**Critérios de aceite:** estados acessíveis; áudio descartado; operação sensível confirmável; mobile prioriza microfone.

**Testes necessários:** permissões negadas, MIME/tamanho, provider indisponível, preferência e fluxo E2E simulado.

**Sugestão de commit:** `feat: add end-to-end voice interaction`

## [ ] PASSO 18 — Dashboard e insights financeiros

**Objetivo:** oferecer visão financeira visual baseada nos mesmos dados.

**Tarefas:** cards; filtros; Recharts; fluxo de caixa; patrimônio; categorias; insights comparativos; estados vazios.

**Arquivos:** `dashboard`, `insights`, páginas e gráficos.

**Critérios de aceite:** períodos corretos; gráficos responsivos; valores coincidem com consultas; sem aconselhamento enganoso.

**Testes necessários:** agregações, limites de data/fuso, acessibilidade de gráficos e responsividade.

**Sugestão de commit:** `feat: add financial dashboard and grounded insights`

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
