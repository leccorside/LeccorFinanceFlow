# Documentação — Leccor Finance Flow

## Visão do produto

Leccor Finance Flow será um SaaS de finanças pessoais em que texto e voz substituem formulários para operações financeiras. O usuário conversa com um assistente, que interpreta a intenção, pede dados ausentes quando necessário, executa uma ferramenta interna autorizada, sincroniza o Google Sheets e responde com base no resultado real.

O produto terá simultaneamente:

- banco PostgreSQL para estado operacional, usuários, permissões e regras;
- planilha Google profissional e sincronizada;
- dashboard responsivo;
- assistente financeiro com IA;
- relatórios PDF/XLSX;
- administração de usuários, provedores e configurações.

## Arquitetura

A solução será um monólito modular com frontend React e backend NestJS. A descrição detalhada está em `ARQUITETURA.md`.

Limites obrigatórios:

- sem filas ou brokers;
- sem microserviços;
- sem sistema de logs da aplicação;
- sem acesso direto da IA ao banco ou Sheets;
- sem cálculo monetário crítico em ponto flutuante;
- sem formulários tradicionais para CRUD financeiro.

## Execução oficial com Docker Compose

Desde o PASSO 02, Docker Compose é o modo oficial de desenvolvimento. Pré-requisito: Docker Desktop com Docker Compose v2.24 ou superior.

```bash
# opcional: copiar e ajustar portas/senha locais
cp .env.example .env

docker compose up --build            # sobe postgres, backend e frontend
docker compose up --build --watch    # idem, com hot reload (sincroniza o código nos containers)
docker compose down                  # para tudo e preserva o volume do banco
docker compose down -v               # para tudo e APAGA o volume do banco
```

Serviços:

| Serviço    | Imagem/alvo                                    | Porta no host (padrão) | Healthcheck                                    |
| ---------- | ---------------------------------------------- | ---------------------- | ---------------------------------------------- |
| `postgres` | `postgres:17-alpine`                           | `127.0.0.1:5432`       | `pg_isready`                                   |
| `backend`  | `apps/backend/Dockerfile`, alvo `development`  | `127.0.0.1:3000`       | `GET /api/v1/health/ready` (exige banco ativo) |
| `frontend` | `apps/frontend/Dockerfile`, alvo `development` | `127.0.0.1:5173`       | `GET /` do Vite                                |

Detalhes:

- Ordem de inicialização garantida por healthchecks: `postgres` saudável → `backend` saudável → `frontend`.
- O banco persiste no volume nomeado `leccor-finance-flow_postgres-data`; `down` sem `-v` não apaga dados.
- As portas são publicadas somente em `127.0.0.1`. Se 5432/3000/5173 já estiverem ocupadas, defina `POSTGRES_PORT`, `BACKEND_PORT` ou `FRONTEND_PORT` no `.env`; dentro dos containers as portas são fixas.
- O frontend encaminha `/api` para `http://backend:3000` via `API_PROXY_TARGET`.
- Dentro do Compose, `DATABASE_URL` é montada a partir de `POSTGRES_USER`, `POSTGRES_PASSWORD` e `POSTGRES_DB`; use senha com caracteres seguros para URL.
- As imagens rodam como usuário `node`, sem `.env` copiado para dentro (`.dockerignore`).
- `--watch` sincroniza `apps/*/src` e reconstrói a imagem quando `package.json`, `pnpm-lock.yaml`, `vite.config.ts` ou `apps/backend/prisma/` mudam.
- O Prisma Client é gerado dentro da imagem (postinstall do backend); a versão gerada no host não é copiada.

### Banco: migrations e seed no Docker

Migrations não rodam automaticamente ao subir o backend; são aplicadas de forma explícita:

```bash
docker compose exec backend pnpm --filter @leccor/backend db:deploy   # aplica migrations pendentes
docker compose exec backend pnpm --filter @leccor/backend db:seed     # papéis e categorias padrão (idempotente)
docker compose exec backend pnpm --filter @leccor/backend db:status   # estado das migrations
docker compose exec backend pnpm --filter @leccor/backend test:integration
```

### Healthchecks da API

- `GET /api/v1/health` — liveness: o processo responde; não consulta dependências.
- `GET /api/v1/health/ready` — readiness: executa `SELECT 1` no PostgreSQL via Prisma. Retorna `200` com `{"status":"ok","checks":{"database":"up"}}` ou `503` com `{"status":"error","checks":{"database":"down"}}`.

### Validação tipada de ambiente

O backend valida o ambiente com Zod (`apps/backend/src/config/env.ts`) antes de iniciar o Nest. Variáveis validadas hoje:

| Variável                                    | Regra                                                                           | Padrão                                              |
| ------------------------------------------- | ------------------------------------------------------------------------------- | --------------------------------------------------- |
| `NODE_ENV`                                  | `development`, `test` ou `production`                                           | `development`                                       |
| `BACKEND_PORT`                              | inteiro entre 1 e 65535                                                         | `3000`                                              |
| `DATABASE_URL`                              | URL `postgres://` ou `postgresql://` com host                                   | obrigatória                                         |
| `FRONTEND_URL`                              | URL http(s); destino dos redirects pós-login                                    | `http://localhost:5173`                             |
| `ACCESS_TOKEN_TTL`                          | duração `<n>s/m/h/d`                                                            | `15m`                                               |
| `REFRESH_TOKEN_TTL`                         | duração, maior que `ACCESS_TOKEN_TTL`                                           | `30d`                                               |
| `COOKIE_SECURE`                             | `true`/`false`                                                                  | `true` em produção, `false` fora dela               |
| `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` | os dois ou nenhum; vazios = login Google desligado                              | —                                                   |
| `GOOGLE_REDIRECT_URI`                       | URL http(s) registrada no Google Cloud                                          | `http://localhost:5173/api/v1/auth/google/callback` |
| `CORS_ALLOWED_ORIGINS`                      | lista de URLs http(s) separadas por vírgula; somadas à origem de `FRONTEND_URL` | vazio                                               |
| `RATE_LIMIT_TTL_SECONDS`                    | inteiro ≥ 1 (janela dos limites)                                                | `60`                                                |
| `RATE_LIMIT_MAX_REQUESTS`                   | inteiro ≥ 1, por IP e janela, em toda a API                                     | `100`                                               |
| `AUTH_RATE_LIMIT_MAX_REQUESTS`              | inteiro ≥ 1, por IP e janela, nas rotas `/auth`                                 | `20`                                                |
| `MAX_JSON_BODY_SIZE`                        | `<n>b`, `<n>kb` ou `<n>mb`                                                      | `1mb`                                               |
| `TRUST_PROXY`                               | `false`, `true`, número de saltos ou lista do Express                           | `false`                                             |
| `ADMIN_EMAILS`                              | e-mails separados por vírgula (normalizados)                                    | vazio                                               |

Configuração inválida encerra o processo com código 1 e uma mensagem que lista variável e regra violada, sem ecoar o valor recebido (evita vazar segredos). Novas variáveis entram no schema conforme os módulos que as usam forem implementados.

## Execução local sem Docker (alternativa)

Com Node.js 22.12 ou superior e pnpm 11.25 ou superior, e um PostgreSQL acessível em `DATABASE_URL`:

```bash
pnpm install --frozen-lockfile
pnpm dev
```

Comandos de qualidade:

```bash
pnpm format:check
pnpm lint
pnpm typecheck
pnpm test
pnpm build
pnpm quality
```

Fora do Docker, o backend usa `http://localhost:3000` e o frontend `http://localhost:5173`, encaminhando `/api` para `API_PROXY_TARGET` (padrão `http://localhost:3000`). Sem `DATABASE_URL` válida o backend não inicia.

Pré-requisitos dos próximos passos: credenciais Google OAuth para desenvolvimento e ao menos um provedor de IA configurado para testes manuais reais.

Migrações serão executadas de forma explícita e distinta entre desenvolvimento e produção. O backend não fará alterações destrutivas automáticas de schema ao subir em produção.

## Configuração

`.env.example` lista variáveis sem valores secretos. Arquivos `.env` reais não devem ser versionados. A validação de ambiente falhará cedo quando uma configuração obrigatória estiver ausente ou inválida.

Grupos de configuração:

- URLs e portas da aplicação;
- PostgreSQL;
- sessão/JWT e criptografia;
- Google OAuth/Sheets;
- provedores de IA;
- STT/TTS;
- relatórios, uploads e limites;
- recursos opcionais de documentação e testes reais.

## API REST planejada

Prefixo: `/api/v1`.

| Grupo           | Exemplos de responsabilidade                                 |
| --------------- | ------------------------------------------------------------ |
| `/auth`         | login, callback, refresh, logout, sessão (`me`) e token CSRF |
| `/profile`      | leitura e preferências do titular                            |
| `/google`       | conectar, status, reconectar e desconectar                   |
| `/spreadsheets` | criar, listar, selecionar, sincronizar e excluir             |
| `/transactions` | consultas e operações autorizadas usadas pelas ferramentas   |
| `/accounts`     | consulta e ferramentas de contas/cartões                     |
| `/categories`   | categorias padrão e personalizadas                           |
| `/investments`  | consulta e ferramentas de investimentos                      |
| `/assistant`    | conversas, mensagens, confirmações e undo                    |
| `/voice`        | transcrição, síntese e vozes disponíveis                     |
| `/reports`      | geração e download autenticado                               |
| `/dashboard`    | agregações por período                                       |
| `/admin/*`      | usuários, provedores, modelos e configurações                |

Controladores não concentrarão regra de negócio. DTOs validam formato; serviços de domínio validam invariantes; guards/policies validam papel e propriedade.

## Banco de dados

Implementado no PASSO 03 com Prisma 7.10 (`apps/backend/prisma/schema.prisma`, gerador `prisma-client` em ESM, driver adapter `@prisma/adapter-pg`, configuração em `apps/backend/prisma.config.ts`).

Entidades (tabelas em snake_case): `User`, `Role`, `UserRole` (N:N), `UserProfile`, `VoicePreference`, `GoogleConnection`, `SystemSetting`, `Spreadsheet`, `FinancialAccount`, `Category`, `Transaction`, `Investment`, `RecurringTransaction`, `Installment`, `Conversation`, `ConversationMessage`, `AIProvider`, `AIConfiguration`, `Report` e `ActionHistory`.

### Tipos e convenções

- IDs UUID v7 gerados pelo Prisma (ordenáveis no tempo); o mesmo ID irá para a linha do Sheets.
- Dinheiro em `Decimal(19,4)`; quantidade de investimento em `Decimal(28,10)`; nunca `float`.
- Datas de calendário (ocorrência, vencimento, pagamento, períodos) em `date`; instantes em `timestamptz(3)` UTC.
- Moeda: código ISO 4217 em `char(3)` maiúsculo.
- Entidades sincronizáveis guardam `sync_status` (`SYNCED`, `PENDING_SYNC`, `CONFLICT`), `sync_error` sanitizado e `version`.
- Categorias do sistema têm `owner_id` nulo e `system_key` estável (usado para i18n e seed); categorias do usuário têm `owner_id` e não têm `system_key`.
- `Category` usa árvore (`parent_id`): a transação aponta para a categoria folha; a raiz é a "Categoria" e a folha a "Subcategoria".
- `Installment` é a compra original; cada parcela é uma `Transaction` com `installment_id` + `installment_number` (únicos juntos).
- Recorrências materializadas guardam `recurrence_occurrence_on`, único por recorrência (idempotência sem fila).
- Tokens Google e API keys só existem como texto cifrado (`*_encrypted` + `encryption_key_version`).

### Regras garantidas no próprio banco

Escritas à mão no fim de `migration.sql` (o Prisma não modela CHECK, índice parcial nem trigger):

- CHECKs: valores positivos, moeda ISO, e-mail normalizado, `COMPLETED` exige `paid_on`, transferência exige conta de destino diferente da origem, campos de cartão só em `CREDIT_CARD`, dias 1–31, recorrência `CUSTOM` exige unidade, datas coerentes, prioridade de IA ≥ 1, formato dos snapshots do `ActionHistory` por ação, segredo cifrado exige versão da chave.
- Índice único parcial: no máximo uma planilha ativa por usuário.
- Isolamento por proprietário: triggers impedem que uma linha referencie conta, categoria, planilha, investimento, parcelamento, recorrência ou conversa de outro usuário (categorias do sistema são permitidas), e tornam `owner_id` imutável. É uma defesa em profundidade; a autorização principal continua na API (PASSO 05).
- Excluir o usuário remove em cascata todos os seus dados. Dentro do mesmo usuário, as FKs usam `NO ACTION`: não é possível apagar uma conta, categoria ou planilha que ainda tem movimentações (exclusão explícita, tratada nos passos de domínio).

### Migrations, reversão e seed

| Script (backend)        | Ação                                                        |
| ----------------------- | ----------------------------------------------------------- |
| `pnpm db:migrate`       | `prisma migrate dev` (cria migrations em desenvolvimento)   |
| `pnpm db:deploy`        | `prisma migrate deploy` (aplica pendentes; usado no Docker) |
| `pnpm db:seed`          | papéis `ADMIN`/`USER` e 14 categorias padrão, por upsert    |
| `pnpm db:status`        | estado das migrations                                       |
| `pnpm prisma:generate`  | regenera o client (também roda no `postinstall`)            |
| `pnpm test:integration` | testes em bancos descartáveis (exige `TEST_DATABASE_URL`)   |

Cada migration tem um `down.sql` ao lado do `migration.sql`. Para reverter (apaga todos os dados): `prisma db execute --file prisma/migrations/<nome>/down.sql`; o próprio arquivo remove o registro em `_prisma_migrations`, e `db:deploy` reaplica depois. Ao criar novas migrations com SQL manual, escrever também o `down.sql` e manter o teste de drift verde.

O Prisma Client é gerado em `apps/backend/src/generated/prisma` (fora do Git).

### Testes de integração

`test/integration/*.int-spec.ts` criam um banco `leccor_test_*` por arquivo, aplicam as migrations, executam e removem o banco. Cobrem: seed idempotente, precisão `Decimal`, cada CHECK, isolamento entre usuários, exclusão em cascata do usuário, ausência de drift entre migrations e `schema.prisma`, e reversão completa com reaplicação.

## Autenticação (login Google e sessão)

Implementada no PASSO 04 (`apps/backend/src/auth`, `apps/backend/src/users`).

### Configurar o Google Cloud (desenvolvimento)

1. No Google Cloud Console, crie um cliente OAuth do tipo **Aplicativo da Web**.
2. Em "URIs de redirecionamento autorizados", cadastre exatamente `http://localhost:5173/api/v1/auth/google/callback`. Se trocar `FRONTEND_PORT`, ajuste a URI e `GOOGLE_REDIRECT_URI`.
3. Coloque `GOOGLE_CLIENT_ID` e `GOOGLE_CLIENT_SECRET` no `.env` e recrie o backend (`docker compose up -d --build backend`).
4. Acesse `http://localhost:5173/api/v1/auth/google/login` para entrar. Após o login, `http://localhost:5173/api/v1/auth/me` mostra o usuário.

Sem essas duas variáveis o backend sobe normalmente e `GET /auth/google/login` responde `503 oauth_not_configured`.

### Endpoints

| Método e rota                                       | Uso                                                                                                                                                          |
| --------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `GET /api/v1/auth/google/login?redirectTo=/caminho` | Inicia o login: grava a tentativa e redireciona (302) ao Google com `state`, `nonce` e PKCE S256. `redirectTo` aceita só caminhos relativos do frontend.     |
| `GET /api/v1/auth/google/callback`                  | Retorno do Google. Sempre redireciona ao frontend: sucesso → `FRONTEND_URL + redirectTo` com cookies de sessão; falha → `FRONTEND_URL/login?error=<código>`. |
| `POST /api/v1/auth/refresh`                         | Gira os dois tokens usando o cookie de refresh. `204` ou `401 {code}` (limpa os cookies).                                                                    |
| `POST /api/v1/auth/logout`                          | Revoga a sessão atual e limpa os cookies. Idempotente (`204`).                                                                                               |
| `GET /api/v1/auth/me`                               | Usuário atual (id, e-mail, status, papéis, perfil básico). `401` sem sessão válida. Nunca inclui tokens.                                                     |

Códigos de erro do login (`/login?error=`): `access_denied`, `invalid_state`, `expired_state`, `provider_error`, `email_not_verified`, `account_blocked`, `account_conflict`, `oauth_not_configured`.

### Como funciona

- **Login**: Authorization Code + PKCE (S256) + `state` + `nonce`, via `openid-client` com metadados estáticos do Google (sem discovery na inicialização). O ID token tem `iss`, `aud`, `exp`, `nonce` **e assinatura** (JWKS do Google) validados. Escopos de login: só `openid email profile`; Drive/Sheets virão por consentimento separado (PASSO 07). Os tokens Google recebidos no login são descartados.
- **Tentativa de login** (`auth_login_attempts`): guarda o hash do `state`, o `nonce` e o `code_verifier` por até 10 minutos. O `state` também vai num cookie `HttpOnly` (`lff_oauth_state`), e o callback exige que os dois coincidam (proteção contra login CSRF). A tentativa é apagada ao ser usada, então um callback repetido é rejeitado; tentativas expiradas são limpas sempre que um novo login começa (sem jobs).
- **Usuário**: procurado pelo `sub` do Google; se não existir, por e-mail normalizado, vinculando a conta somente se ela ainda não tiver outra conta Google (senão `account_conflict`). Contas novas recebem o papel `USER` e perfil com nome e foto do Google. E-mail não verificado é recusado. Usuário `BLOCKED` não recebe sessão.
- **Sessão própria** (`user_sessions`): tokens opacos aleatórios de 256 bits; o banco guarda só o SHA-256 deles.

| Cookie            | Conteúdo                               | Atributos                                                                  |
| ----------------- | -------------------------------------- | -------------------------------------------------------------------------- |
| `lff_session`     | token de acesso (15 min)               | `HttpOnly`, `SameSite=Lax`, `Path=/api`, `Secure` conforme `COOKIE_SECURE` |
| `lff_refresh`     | token de refresh (30 dias, rotativo)   | `HttpOnly`, `SameSite=Strict`, `Path=/api/v1/auth`                         |
| `lff_oauth_state` | `state` do login em andamento (10 min) | `HttpOnly`, `SameSite=Lax`, `Path=/api/v1/auth/google`                     |

- **Renovação**: cada refresh troca os dois tokens. Apresentar de novo um refresh token já trocado é tratado como roubo e **revoga a sessão inteira** (`refresh_reuse`).
- **Bloqueio e revogação imediatos**: cada requisição autenticada consulta a sessão e o status do usuário; bloquear o usuário corta a sessão na próxima chamada (`user_blocked`).
- **Guard**: `SessionAuthGuard` é global (default-deny) e `@CurrentUser()` entrega o usuário da sessão. Papéis, CSRF e rate limit: ver "Segurança da API".
- **Token CSRF**: `GET /api/v1/auth/csrf` (exige sessão) devolve `{ csrfToken, headerName: "X-CSRF-Token" }`. O token é fixo durante a sessão (sobrevive ao refresh e vale para todas as abas).
- **Primeiro administrador**: e-mails listados em `ADMIN_EMAILS` recebem o papel `ADMIN` a cada login (comparação sem diferenciar maiúsculas). Remover o e-mail da lista não rebaixa ninguém; rebaixamento será ação explícita do painel admin (PASSO 20).
- **E-mail da conta**: a cada login, o e-mail da conta é sincronizado com o e-mail **verificado** da conta Google vinculada (pelo `sub`). Se o novo endereço já pertencer a outra conta, o atual é mantido.

## Perfil e internacionalização (PASSO 06)

### API

| Método e rota           | Uso                                                                               |
| ----------------------- | --------------------------------------------------------------------------------- |
| `GET /api/v1/profile`   | Perfil do próprio usuário (com valores padrão quando ainda não há registro).      |
| `PATCH /api/v1/profile` | Atualização parcial; exige `X-CSRF-Token`. Responde o perfil completo atualizado. |

Não existe rota com `:id`: cada usuário só endereça o próprio perfil, então não há o que adivinhar (sem superfície de IDOR).

Resposta:

```json
{
  "email": "ana@example.com",
  "firstName": "Ana",
  "lastName": "Silva",
  "photoUrl": null,
  "phone": "+5511999998888",
  "locale": "pt-BR",
  "currency": "BRL",
  "timeZone": "America/Sao_Paulo",
  "preferences": { "theme": "system", "weekStartsOn": "monday" },
  "voice": { "gender": "FEMALE", "autoSpeak": true, "speakingRate": 1 },
  "updatedAt": "2026-10-08T12:00:00.000Z"
}
```

Regras do `PATCH` (DTO strict; envie só o que mudou):

| Campo                                                            | Regra                                                                                        |
| ---------------------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| `firstName`, `lastName`                                          | até 100 caracteres, sem caracteres de controle; vazio ou `null` limpa                        |
| `photoUrl`                                                       | somente `https://`, até 2048 caracteres; `null` limpa                                        |
| `phone`                                                          | formato E.164 (`+5511999998888`); `null` limpa                                               |
| `locale`                                                         | `pt-BR`, `en-US` ou `es-ES` (tags BCP 47; no banco viram `pt_BR`/`en_US`/`es_ES`)            |
| `currency`                                                       | código ISO 4217 maiúsculo conhecido pelo `Intl`                                              |
| `timeZone`                                                       | nome IANA (`America/Sao_Paulo`, `Europe/Madrid`, `UTC`); offsets como `+03:00` são recusados |
| `preferences.theme` / `preferences.weekStartsOn`                 | `system`/`light`/`dark` e `monday`/`sunday` (mesclados com os já salvos)                     |
| `voice.gender` / `voice.autoSpeak` / `voice.speakingRate`        | `FEMALE`/`MALE`, booleano e 0,5–2,0 em passos de 0,05                                        |
| `email`, `id`, `userId`, `roles`, `status`, chaves desconhecidas | **rejeitados** com `400 validation_failed`                                                   |

**E-mail**: é um valor confiável e não pode ser alterado pela API. Ele acompanha o e-mail verificado da conta Google (ver "Autenticação"). Para trocá-lo, o usuário troca o e-mail no Google e entra novamente. A tela de perfil explica isso.

O `/auth/me` também passa a expor `locale` como tag BCP 47.

### Frontend

- **i18n** em `apps/frontend/src/i18n`: catálogos `pt-BR`, `en-US` e `es-ES`. O `pt-BR` é a referência e os outros são tipados com o mesmo conjunto de chaves, então faltar uma tradução é erro de compilação. Um teste confere chaves e placeholders `{nome}`. Sem biblioteca externa.
- **Idioma ativo**: antes do login, vem do navegador (`es-MX` → `es-ES`, `en` → `en-US`; demais → `pt-BR`); depois do login, do perfil (`/auth/me`). O `<html lang>` acompanha o idioma.
- **Formatação** (`i18n/format.ts`), sempre com o idioma, a moeda e o fuso do perfil:
  - **valores**: `Intl.NumberFormat` recebendo a string decimal da API, sem passar por `float`;
  - **instantes**: exibidos no fuso do perfil;
  - **datas de calendário** (vencimento, ocorrência): nunca mudam de dia por causa do fuso.
- **Cliente HTTP** (`services/api.ts`): cookies da mesma origem; envia `X-CSRF-Token` (obtido de `/auth/csrf` e guardado em memória) em toda escrita; em `401` tenta `POST /auth/refresh` uma única vez e repete a requisição; em `403 csrf_failed` busca o token de novo uma vez.
- **Telas**:
  - `/login`: botão "Entrar com Google", com mensagens de erro traduzidas a partir de `?error=`;
  - `/profile`: protegida, com prévia ao vivo de valor, data/hora no fuso e data de vencimento; envia apenas os campos alterados e marca os campos recusados pela API com `aria-invalid` e mensagem associada;
  - visitante anônimo em rota protegida vai para `/login?redirectTo=...`.
- **Tema**: a preferência é salva, mas a interface ainda usa só o tema escuro; tema claro e "seguir o sistema" serão aplicados na interface definitiva (PASSO 16).

## Google OAuth (conexão com Sheets)

A conexão com Sheets será tratada pelo backend usando Authorization Code com state e PKCE, separada do login. O consentimento para Drive/Sheets será incremental. Tokens Google permanecerão criptografados no banco e nunca serão entregues ao React.

Estados tratados:

- conectado e válido;
- token próximo da expiração;
- renovação bem-sucedida;
- consentimento revogado/expirado;
- reconexão necessária;
- desconectado pelo usuário.

Desconectar elimina credenciais locais e tenta revogar o token no Google. Isso não apagará planilhas sem uma confirmação separada e específica.

## Google Sheets

O serviço usará APIs oficiais do Google para criar e formatar a planilha. O arquivo terá abas financeiras, IDs imutáveis por registro, versão e timestamp técnico oculto.

Sincronização:

1. Carrega checkpoint e versões.
2. Lê alterações relevantes.
3. Normaliza e valida dados como conteúdo não confiável.
4. Deduplica por UUID e chaves auxiliares.
5. Aplica mudanças não conflitantes no banco.
6. Exporta o estado normalizado.
7. Atualiza checkpoint somente após confirmação.

PostgreSQL prevalece em conflitos simultâneos. Alterações manuais não conflitantes do Sheets são aceitas. Exclusão de linha não equivale a exclusão financeira.

## IA e tool calling

O modelo não executa SQL, Prisma nem Google API. Ele escolhe entre ferramentas expostas pelo `ToolRegistry`. O `ToolExecutor` valida schema, sessão, papel, ownership, confirmação, regra de negócio e resultado.

Para toda resposta quantitativa:

1. o modelo solicita uma ferramenta de consulta;
2. o backend calcula o valor real;
3. o modelo recebe um resultado estruturado;
4. a resposta é gerada sem inventar números.

Contexto conversacional guarda referências seguras, como período, categoria e IDs de resultados anteriores, sempre revalidados antes do uso.

### Fallback

OpenAI, Gemini e Claude implementarão contrato comum. A prioridade será configurável. Fallback só acontece para falhas recuperáveis de disponibilidade; erros de entrada, autorização ou regra não são ocultados por uma troca de provedor.

## Voz

O navegador pedirá permissão e capturará áudio. O backend encaminhará o conteúdo ao `SpeechToTextProvider`, executará o mesmo pipeline textual e poderá gerar áudio pelo `TextToSpeechProvider`.

Controles mínimos:

- início/parada claros;
- transcrição visível;
- estados de processamento acessíveis;
- revisão ou confirmação em ações sensíveis;
- escolha feminina/masculina persistida;
- fallback para texto quando áudio não estiver disponível.

## Segurança

### Segurança da API (PASSO 05)

Implementada em `apps/backend/src/common` e aplicada a toda requisição, nesta ordem:

1. **Middlewares HTTP** (`configureApp`, usado por `main.ts` e pelos testes): `X-Request-Id` gerado pelo servidor (ids enviados pelo cliente são ignorados), headers de segurança (`nosniff`, `X-Frame-Options: DENY`, `Referrer-Policy: no-referrer`, CSP `default-src 'none'`, COOP/CORP, `Permissions-Policy`, `Cache-Control: no-store`, HSTS quando `COOKIE_SECURE`), sem `X-Powered-By`, limite de corpo `MAX_JSON_BODY_SIZE` (acima disso, `413`) e CORS restrito a `FRONTEND_URL` + `CORS_ALLOWED_ORIGINS`, com credenciais e apenas os headers `Content-Type` e `X-CSRF-Token`.
2. **Rate limit** (`RateLimitGuard`): orçamento global por IP (`RATE_LIMIT_MAX_REQUESTS` por `RATE_LIMIT_TTL_SECONDS`) em todas as rotas, mais um orçamento próprio das rotas `/auth` (`AUTH_RATE_LIMIT_MAX_REQUESTS`) e buckets por rota com `@RateLimit({ name, limit, windowMs })`. Excedido: `429 rate_limited` com `Retry-After`. Contadores em memória do processo (uma instância; zeram ao reiniciar). Atrás de proxy, configure `TRUST_PROXY` para o IP real ser usado; pelo proxy do Vite em desenvolvimento, todo o tráfego do navegador compartilha o IP do container do frontend.
3. **Autenticação default-deny** (`SessionAuthGuard` global): toda rota exige sessão válida de usuário `ACTIVE`, exceto as marcadas com `@Public()` (hoje: `/health`, `/health/ready`, `/auth/google/login`, `/auth/google/callback`, `/auth/refresh`, `/auth/logout`). Sem sessão: `401 unauthenticated`.
4. **CSRF** (`CsrfGuard`), para `POST`/`PUT`/`PATCH`/`DELETE`: se a requisição trouxer `Origin` (ou `Referer`), a origem precisa estar na lista permitida, inclusive em rotas públicas (origem `null` nunca é aceita); em rotas autenticadas, o header `X-CSRF-Token` precisa ser igual ao token da sessão (`GET /auth/csrf`). Falha: `403 csrf_failed`. `GET`/`HEAD`/`OPTIONS` não exigem token e não devem alterar estado.
5. **Papéis** (`RolesGuard`): `@Roles('ADMIN')` exige o papel; sem ele, `403 forbidden`. Funcionalidades administrativas ficam em rotas `/admin/...` explícitas.
6. **Validação de entrada**: cada parâmetro usa `@Body(validate(schema))`, `@Param('id', uuidParam)` etc. com Zod. DTOs são criados com `dto({...})` (objeto _strict_): campos desconhecidos como `ownerId`, `id`, `role` ou `status` são **rejeitados** com `400 validation_failed`, nunca ignorados em silêncio. Os detalhes trazem caminho, regra e mensagem, nunca o valor recebido.
7. **Ownership**: ver abaixo.
8. **Erros** (`ApiExceptionFilter`): toda falha responde `{ code, message, details, requestId, timestamp }`. Erros 5xx nunca expõem mensagem original, stack ou detalhes do driver. Erros conhecidos do Prisma: registro inexistente → `404 not_found`, unicidade/FK → `409 conflict`. JSON malformado → `400 bad_request`. Nada é gravado em log (decisão de arquitetura).

### Autorização e IDOR

Toda consulta usa o usuário autenticado como parte do filtro: `findFirst({ where: { id, ...ownedBy(user) } })`, `updateMany`/`deleteMany` com o mesmo escopo, e `ResourceNotFoundException` quando nada corresponde. Buscar por um ID global e verificar depois não é permitido. Um ID de outro usuário recebe exatamente a mesma resposta de um ID inexistente (`404 not_found`), sem revelar que o recurso existe. O `ownerId` sempre vem da sessão, nunca do payload. Admin também passa por policies explícitas; não existe bypass implícito nas rotas de usuário. Os triggers de ownership do banco (PASSO 03) são a segunda linha de defesa.

Para o frontend (a partir do PASSO 16): buscar o token em `GET /auth/csrf` após o login, mantê-lo em memória e enviá-lo em `X-CSRF-Token` em toda escrita; ao receber `401`, tentar `POST /auth/refresh` uma vez.

### Segredos

- tokens e API keys criptografados com AES-256-GCM;
- chave raiz somente no ambiente/secret manager;
- rotação por versão;
- nenhum segredo no frontend, Sheets, mensagens ou commits.

### Prompt injection

Conteúdo financeiro é dado não confiável. Apenas mensagens de sistema controladas e ferramentas registradas governam comportamento. Texto em células não pode criar permissões, trocar usuário, liberar ferramenta ou confirmar ação.

### Operações destrutivas

Exclusões ambíguas ou de alto impacto exigem confirmação vinculada a um snapshot da ação. Um token expirado ou cujo alvo mudou é rejeitado. Exclusões de planilha, dados financeiros, histórico ou conta têm confirmações distintas.

### Privacidade

O desenho considera minimização, consentimento, transparência, portabilidade, revogação e exclusão. Política de retenção e backups deverá ser aprovada antes da produção.

## Dashboard e insights

As visualizações usarão agregações do backend e oferecerão períodos hoje, semana, mês, 3 meses, 6 meses, ano e personalizado. Recharts renderizará gráficos acessíveis e responsivos.

Insights são comparações determinísticas ou análises apoiadas por dados. Não prometerão retorno, não substituirão aconselhamento profissional e indicarão o período analisado.

## Relatórios

PDF e XLSX cobrirão relatórios mensal, anual, receitas, despesas, categorias, investimentos, contas, fluxo de caixa e consolidado. A geração será síncrona, com limites explícitos. O download requer sessão e ownership.

## Testes

Estratégia planejada:

- backend: Jest, Supertest e PostgreSQL de teste em Docker;
- frontend: Vitest, Testing Library e ferramenta E2E definida na etapa correspondente;
- adapters externos: fakes determinísticos por padrão;
- smoke real Google/IA: manual ou opt-in por variável de ambiente.

Cobertura crítica inclui autenticação, autorização, isolamento, tools, transações, parcelas, recorrências, sincronização, fallback, relatórios, confirmações e undo.

## Desenvolvimento incremental

`PASSOS.md` é a fonte de acompanhamento. Cada passo deve:

1. implementar somente seu escopo;
2. executar os testes definidos;
3. corrigir falhas;
4. atualizar esta documentação e `CONTEXTO.md`;
5. marcar conclusão com evidência;
6. informar uma sugestão de Conventional Commit;
7. nunca criar o commit automaticamente.
