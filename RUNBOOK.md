# Runbook de operação — Leccor Finance Flow

Guia para implantar, atualizar, monitorar e recuperar o Leccor Finance Flow em produção. Todos os comandos abaixo foram executados na validação do PASSO 22 (stack de produção construída do zero). Desenvolvimento local continua em `README.md` e `DOCUMENTACAO.md`.

## 1. Topologia

```text
navegador ──HTTPS──▶ proxy TLS do host / balanceador
                         │ HTTP
                         ▼
                 web (nginx, :8080)  ── SPA estática + headers de segurança (CSP)
                         │ /api/*
                         ▼
                 backend (Node, :3000) ── não publicado; só a rede interna
                         │
                         ▼
                 postgres (17) ── volume postgres-data
       migrate (execução única) ── aplica migrations + seed e termina antes do backend subir
```

| Serviço    | Imagem / alvo                                 | Observações                                                                                             |
| ---------- | --------------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| `postgres` | `postgres:17-alpine`                          | Dados no volume `postgres-data`. Não é publicado.                                                       |
| `migrate`  | `apps/backend/Dockerfile`, alvo `migrate`     | `prisma migrate deploy` + seed idempotente. O backend só sobe se terminar com código 0.                 |
| `backend`  | `apps/backend/Dockerfile`, alvo `production`  | `node dist/main.js` como usuário `node`, só dependências de produção. Healthcheck em `/health/ready`.   |
| `web`      | `apps/frontend/Dockerfile`, alvo `production` | `nginx-unprivileged` (não-root, porta 8080). Proxy `/api` → backend; CSP igual a `security-headers.ts`. |

Uma única origem (`web`) serve a interface e a API: não há CORS em produção. TLS termina antes do `web` (proxy do host, balanceador ou túnel).

## 2. Pré-requisitos

- Docker Engine 24+ com Compose v2.
- Domínio com HTTPS apontando para a porta do `web` (padrão `127.0.0.1:8080`; mude `WEB_BIND`/`WEB_PORT`).
- Cliente OAuth no Google Cloud (tipo "Aplicativo da Web") com as URIs de redirecionamento:
  - `https://SEU-DOMINIO/api/v1/auth/google/callback`
  - `https://SEU-DOMINIO/api/v1/google/callback`
  - APIs ativadas: Google Drive e Google Sheets. Tela de consentimento com o escopo `drive.file`.
- Chaves dos provedores de IA (opcional na subida; podem ser cadastradas depois no console admin) e de voz (opcional).

## 3. Primeira implantação

```bash
cp .env.production.example .env.production
# Preencha: FRONTEND_URL, POSTGRES_PASSWORD, DATA_ENCRYPTION_KEY_V1, GOOGLE_*, ADMIN_EMAILS.
openssl rand -base64 32   # para POSTGRES_PASSWORD
openssl rand -base64 32   # para DATA_ENCRYPTION_KEY_V1 (guarde também fora do servidor)

docker compose --env-file .env.production -f docker-compose.prod.yml up -d --build
docker compose -p leccor-finance-flow-prod ps
```

Resultado esperado: `migrate` em `Exited (0)` e `postgres`, `backend` e `web` em `healthy`.

```bash
curl -s https://SEU-DOMINIO/api/v1/health/ready      # {"status":"ok",...,"checks":{"database":"up"}}
curl -sI https://SEU-DOMINIO/ | grep -i content-security-policy
```

Primeiro administrador: entre com Google usando um e-mail listado em `ADMIN_EMAILS`. Esse login recebe o papel ADMIN. Depois, cadastre os provedores de IA em **Administração → Provedores de IA**.

> `.env.production` nunca vai para o Git (`.gitignore`). `pnpm security:scan` acusa um `.env` preenchido que escape para o repositório.

## 4. Atualização de versão

```bash
git pull
docker compose --env-file .env.production -f docker-compose.prod.yml up -d --build
```

O Compose reconstrói as imagens, roda `migrate` (só aplica migrations pendentes; o seed é idempotente) e troca o `backend` e o `web`. Se uma migration falhar, o Compose interrompe a atualização antes de recriar o `backend`, que depende de `migrate` terminar com sucesso. Confira com `ps` qual versão ficou no ar e investigue com `docker compose -p leccor-finance-flow-prod logs migrate`.

**Antes de toda atualização com migration, faça backup (seção 6).**

**Rollback**:

1. Volte o código (`git checkout <versão anterior>`).
2. Se a versão nova aplicou migrations, reverta-as na ordem inversa com o `down.sql` de cada pasta em `apps/backend/prisma/migrations/` e apague a linha correspondente em `_prisma_migrations`. O teste `migration.int-spec` garante que todo `down.sql` reverte e reaplica limpo.
3. Suba de novo com o comando de atualização.

Se a migration já apagou dados, restaure o backup (seção 6) em vez de usar o `down.sql`.

## 5. Monitoramento

| O quê                 | Como                                                                                                                                                                        |
| --------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Vida do processo      | `GET /api/v1/health` (200 = processo de pé).                                                                                                                                |
| Prontidão             | `GET /api/v1/health/ready` (200 = banco acessível; 503 caso contrário). É o healthcheck do Compose.                                                                         |
| Erros inesperados     | `docker compose -p leccor-finance-flow-prod logs backend \| grep ServerError`. Cada linha tem o `requestId` (o mesmo devolvido ao usuário em `X-Request-Id`), já mascarada. |
| Degradações previstas | Linhas `WARN [ServerError] ... 503 <código>` (provedor de IA/voz fora, Google fora, recurso pausado).                                                                       |
| Consumo de IA e voz   | Console admin → Visão geral (requisições, falhas e custo estimado por provedor e modelo).                                                                                   |
| Ações administrativas | Console admin → "Ações administrativas recentes" (`admin_audit_events`).                                                                                                    |

Um usuário que relata erro pode informar o código de referência (`requestId`) mostrado pela API. Procure-o nos logs.

## 6. Backup e restauração

**Backup** (formato custom do PostgreSQL, comprimido):

```bash
docker compose -p leccor-finance-flow-prod exec -T postgres \
  sh -c 'pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Fc' > backup-$(date +%F).dump
```

Agende pelo cron do host, no mínimo uma vez por dia. Guarde fora do servidor e cifrado. **Retenção máxima de 35 dias**: os backups precisam expirar para que um dado excluído pelo titular (LGPD) não sobreviva além disso. O arquivo contém dados financeiros e tokens cifrados; a chave `DATA_ENCRYPTION_KEY_*` fica guardada **separada** dos backups.

**Restauração** (teste de restauração validado: contagens idênticas de usuários, lançamentos, migrations e tabelas):

```bash
# 1) restaurar num banco de conferência
docker compose -p leccor-finance-flow-prod exec -T postgres \
  sh -c 'createdb -U "$POSTGRES_USER" restore_check'
docker compose -p leccor-finance-flow-prod exec -T postgres \
  sh -c 'pg_restore -U "$POSTGRES_USER" -d restore_check --no-owner' < backup-AAAA-MM-DD.dump

# 2) para restaurar de verdade: parar o backend, recriar o banco principal e restaurar nele
docker compose -p leccor-finance-flow-prod stop backend web
docker compose -p leccor-finance-flow-prod exec -T postgres \
  sh -c 'dropdb -U "$POSTGRES_USER" "$POSTGRES_DB" && createdb -U "$POSTGRES_USER" "$POSTGRES_DB"'
docker compose -p leccor-finance-flow-prod exec -T postgres \
  sh -c 'pg_restore -U "$POSTGRES_USER" -d "$POSTGRES_DB" --no-owner' < backup-AAAA-MM-DD.dump
docker compose --env-file .env.production -f docker-compose.prod.yml up -d
```

Os arquivos de relatório são temporários (expiram em `REPORT_FILE_TTL_MINUTES`) e não precisam de backup.

## 7. Rotação de segredos

| Segredo                        | Procedimento                                                                                                                                                                                                                                                                                                                      |
| ------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Chave de criptografia de dados | Adicione `DATA_ENCRYPTION_KEY_V2` e mude `DATA_ENCRYPTION_KEY_ACTIVE_VERSION=v2`; suba (`up -d`); rode `docker compose -p leccor-finance-flow-prod exec backend node dist/scripts/rotate-credentials.js` (re-cifra tokens Google e chaves de IA; sai com código 1 se alguma credencial estiver ilegível); só então remova a `V1`. |
| Senha do PostgreSQL            | `ALTER USER leccor PASSWORD '...'` pelo `psql` do container, atualize `POSTGRES_PASSWORD` no `.env.production` e rode `up -d`.                                                                                                                                                                                                    |
| Cliente OAuth do Google        | Gere um novo segredo no Google Cloud, atualize `GOOGLE_CLIENT_SECRET` e rode `up -d`. As conexões existentes continuam (o refresh token não depende do segredo antigo, a menos que o cliente seja excluído).                                                                                                                      |
| Chaves de IA                   | Console admin → Provedores de IA → nova chave (cifrada no banco, nunca exibida).                                                                                                                                                                                                                                                  |
| Chaves de voz                  | `STT_API_KEY`/`TTS_API_KEY` (ou `OPENAI_API_KEY`/`GEMINI_API_KEY`) no `.env.production`, depois `up -d`.                                                                                                                                                                                                                          |

As sessões não dependem de segredo de assinatura: os tokens são aleatórios e guardados como hash. Para encerrar todas as sessões, use `UPDATE user_sessions SET revoked_at = now(), revoked_reason = 'admin' WHERE revoked_at IS NULL;`.

## 8. Problemas comuns

| Sintoma                                         | Causa provável e ação                                                                                                                         |
| ----------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| `backend` não fica `healthy`                    | Banco inacessível ou `.env.production` inválido (o backend valida tudo na subida e diz qual variável). Ver `logs backend`.                    |
| `migrate` termina com erro                      | Migration incompatível com os dados. O backend não é recriado. Corrija e repita; em último caso, restaure o backup.                           |
| Login volta com erro / cookies não gravam       | `FRONTEND_URL` diferente do domínio acessado, ou `COOKIE_SECURE=true` sem HTTPS na frente.                                                    |
| Todo mundo recebe 429                           | `TRUST_PROXY` errado: o backend vê o IP do proxy para todos. Some 1 por proxy na frente do nginx.                                             |
| "Login com Google não está configurado" (503)   | `GOOGLE_CLIENT_ID`/`GOOGLE_CLIENT_SECRET` vazios.                                                                                             |
| "O assistente ainda não está configurado"       | Nenhum provedor de IA ativo com chave. Configure no console admin.                                                                            |
| "O assistente está em pausa pela administração" | Configuração global `assistant.enabled` desligada (console admin → Configurações).                                                            |
| Planilha "pendente" no chat                     | O Google não respondeu. O dado foi salvo; a próxima sincronização envia. Se persistir, a conexão Google do usuário pode estar `NEEDS_REAUTH`. |
| Disco cheio em `/tmp`                           | Relatórios expiram sozinhos; reduza `REPORT_FILE_TTL_MINUTES` ou `MAX_REPORT_TRANSACTIONS`.                                                   |

## 9. Pedidos de titulares (LGPD)

O próprio titular exerce os direitos na página **Privacidade e dados** (`/privacy`): exportação em JSON, desconexão do Google e exclusão de conversas, dados financeiros ou da conta. A retenção automática roda a cada `RETENTION_SWEEP_INTERVAL_HOURS` (tabela em `DOCUMENTACAO.md`, "Privacidade e LGPD"). Se um titular sem acesso pedir exclusão, um administrador bloqueia a conta no console. A exclusão definitiva continua sendo feita pela própria conta ou, em último caso, por `DELETE FROM users WHERE email = '...'` (a cascata do banco remove tudo; o teste de órfãos garante isso). A revogação no Google, nesse caso, fica a cargo do titular em myaccount.google.com.

## 10. Validação de uma versão (antes de publicar)

```bash
pnpm install --frozen-lockfile
pnpm quality                      # formato, lint, segredos, tipos, testes unitários e builds
pnpm security:audit               # dependências
# integração (precisa de um PostgreSQL; ver DOCUMENTACAO.md "Testes")
pnpm --filter @leccor/backend test:integration

# stack de produção do zero + E2E (Chrome instalado; ou E2E_BROWSER=chromium com `npx playwright install chromium`)
docker compose --env-file <env de validação> -f docker-compose.prod.yml -f e2e/docker-compose.e2e.yml up -d --build
E2E_DATABASE_URL=postgresql://leccor:<senha>@localhost:55433/leccor_finance_flow pnpm e2e
```

O `env` de validação é um `.env.production` com `FRONTEND_URL=http://localhost:18080`, `WEB_PORT=18080`, `COOKIE_SECURE=false` e limites de taxa altos (o E2E faz muitas requisições de um só IP). O override `e2e/docker-compose.e2e.yml` publica o PostgreSQL em `127.0.0.1:55433` para o E2E criar sessões. **Nunca use esse override em produção.**
