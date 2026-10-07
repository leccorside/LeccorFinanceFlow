# Leccor Finance Flow

Assistente financeiro pessoal com IA, Google Sheets e experiência conversacional. O produto permitirá registrar, consultar, alterar e excluir informações financeiras por texto ou voz, sem transformar a jornada principal em um conjunto de formulários tradicionais.

## Estado atual

Arquitetura e planejamento estão concluídos. PASSO 01 e PASSO 02 concluídos: monorepo com frontend React/Vite, backend NestJS, contratos compartilhados, TypeScript estrito, pipeline de qualidade e ambiente oficial em Docker Compose (frontend, backend e PostgreSQL com healthchecks e volume persistente). Schema do banco, autenticação e funcionalidades financeiras ainda não foram iniciados.

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

O frontend fica em `http://localhost:5173` e o backend em `http://localhost:3000`. Healthchecks: `GET /api/v1/health` (liveness) e `GET /api/v1/health/ready` (readiness com PostgreSQL). Portas ocupadas podem ser trocadas no `.env` (`FRONTEND_PORT`, `BACKEND_PORT`, `POSTGRES_PORT`). Detalhes em `DOCUMENTACAO.md`.

Validação de qualidade no host:

```bash
pnpm install --frozen-lockfile
pnpm quality
```

## Próximo comando

Para autorizar o próximo passo, use:

`INICIE O PASSO 3`

Até essa autorização, Prisma, migrations e autenticação não devem ser iniciados.
