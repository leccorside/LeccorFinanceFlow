# Leccor Finance Flow

Assistente financeiro pessoal com IA, Google Sheets e experiência conversacional. O produto permitirá registrar, consultar, alterar e excluir informações financeiras por texto ou voz, sem transformar a jornada principal em um conjunto de formulários tradicionais.

## Estado atual

Arquitetura e planejamento estão concluídos. PASSOS 01 a 14 concluídos: monorepo com frontend React/Vite, backend NestJS, contratos compartilhados, TypeScript estrito, pipeline de qualidade, ambiente oficial em Docker Compose, modelo relacional completo com Prisma, login com Google (OAuth com PKCE/state/nonce) com sessão própria em cookies HttpOnly, e proteção da API (autenticação default-deny, RBAC ADMIN/USER, ownership sem IDOR, DTOs estritos, CSRF, CORS, headers de segurança, rate limit e contrato único de erros), perfil com preferências e interface em português, inglês e espanhol (idioma, moeda e fuso aplicados à apresentação), e conexão com o Google Drive/Sheets separada do login, com escopo mínimo (`drive.file`) e tokens guardados num cofre AES-256-GCM com chaves versionadas, e criação idempotente da planilha financeira no Drive do usuário (10 abas, formatos, listas, filtros, cores, fórmulas, gráfico e colunas técnicas ocultas), e domínio financeiro com contas, cartões, categorias, movimentações, consultas por período e histórico funcional (valores `Decimal`, regras determinísticas, somas por moeda, "hoje" no fuso do usuário), e compras parceladas (soma exata das parcelas, fatura do cartão), recorrências semanais, quinzenais, mensais, anuais e personalizadas materializadas sob demanda e de forma idempotente, e investimentos por classe com aportes, e sincronização bidirecional sob demanda com a planilha (edições manuais importadas pelas regras do domínio, conflitos preservados para reconciliação, linhas novas sem duplicidade, linha apagada não apaga dado e células tratadas sempre como dados), e camada de IA com OpenAI, Gemini e Claude por trás de um contrato comum (prioridade configurável, fallback apenas em falhas recuperáveis, chaves cifradas e nunca devolvidas) com tela de administração, e registro de ferramentas com executor seguro como única ponte entre a IA e os dados (allowlist, argumentos estritos, usuário sempre da sessão, ambiguidade sem execução e confirmação de uso único, com expiração, para exclusões), e assistente conversacional na API (conversas, contexto de follow-up revalidado, números sempre vindos das ferramentas, respostas seguras quando a IA falha, confirmação pós-ação e respostas em português, inglês e espanhol). A tela de chat e a voz ainda não foram iniciadas.

O primeiro administrador é definido por `ADMIN_EMAILS` no `.env`.

Para habilitar o login, configure `GOOGLE_CLIENT_ID` e `GOOGLE_CLIENT_SECRET` no `.env` (passo a passo em `DOCUMENTACAO.md`, seção "Autenticação").

Documentos preparados:

- `ARQUITETURA.md`: decisões técnicas, componentes, fluxos e modelo de segurança.
- `DOCUMENTACAO.md`: guia funcional e técnico consolidado.
- `PASSOS.md`: roteiro incremental com aceite e testes por etapa.
- `CONTEXTO.md`: estado atual e instruções para continuidade por outra IA.
- `.env.example`: contrato preliminar de configuração, sem segredos reais.

## Stack definida

- Frontend: React, TypeScript, Vite, Tailwind CSS, Framer Motion, React Router, TanStack Query, Axios e Recharts.
- Backend: NestJS modular, TypeScript, API REST, Prisma ORM e PostgreSQL.
- Infraestrutura: Docker Compose como modo oficial de execução.
- Integrações: Google OAuth 2.0, Google Drive/Sheets APIs e provedores intercambiáveis de IA, STT e TTS.

## Princípio central

> Se o usuário consegue pedir para a IA fazer, ele não precisa preencher um formulário.

A IA nunca acessará banco de dados ou planilhas diretamente. O fluxo obrigatório será:

`usuário -> assistente -> tool call estruturado -> validação -> autorização -> regra financeira -> PostgreSQL -> sincronização Google Sheets -> resultado estruturado -> resposta`

## Desenvolvimento (oficial: Docker Compose)

```bash
docker compose up --build --watch
```

Na primeira execução (e após novas migrations), aplique o schema e o seed:

```bash
docker compose exec backend pnpm --filter @leccor/backend db:deploy
docker compose exec backend pnpm --filter @leccor/backend db:seed
```

O frontend fica em `http://localhost:5173` e o backend em `http://localhost:3000`. Healthchecks: `GET /api/v1/health` (liveness) e `GET /api/v1/health/ready` (readiness com PostgreSQL). Portas ocupadas podem ser trocadas no `.env` (`FRONTEND_PORT`, `BACKEND_PORT`, `POSTGRES_PORT`). Detalhes em `DOCUMENTACAO.md`.

Validação de qualidade no host:

```bash
pnpm install --frozen-lockfile
pnpm quality
```

## Próximo comando

Para autorizar o próximo passo, use:

`INICIE O PASSO 15`

Até essa autorização, o undo e as operações destrutivas não devem ser iniciados.
