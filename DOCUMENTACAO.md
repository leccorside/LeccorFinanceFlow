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

## Instalação atual da fundação

O PASSO 01 é executável localmente com Node.js 22.12 ou superior e pnpm 11.25 ou superior:

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

O healthcheck do backend está disponível em `GET http://localhost:3000/api/v1/health`. O frontend usa `http://localhost:5173` e encaminha `/api` para o backend durante o desenvolvimento.

Docker ainda não foi implementado; isso pertence exclusivamente ao PASSO 02.

### Instalação futura em Docker

Pré-requisitos futuros:

- Docker Desktop com Docker Compose;
- credenciais Google OAuth para desenvolvimento;
- ao menos um provedor de IA configurado para testes manuais reais.

Fluxo oficial planejado após o PASSO 02:

```bash
docker compose up --build
```

Serviços esperados:

- `frontend`: aplicação Vite servida no ambiente Docker;
- `backend`: API NestJS;
- `postgres`: PostgreSQL com volume persistente.

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

| Grupo           | Exemplos de responsabilidade                               |
| --------------- | ---------------------------------------------------------- |
| `/auth`         | login, callback, refresh, logout e sessão                  |
| `/profile`      | leitura e preferências do titular                          |
| `/google`       | conectar, status, reconectar e desconectar                 |
| `/spreadsheets` | criar, listar, selecionar, sincronizar e excluir           |
| `/transactions` | consultas e operações autorizadas usadas pelas ferramentas |
| `/accounts`     | consulta e ferramentas de contas/cartões                   |
| `/categories`   | categorias padrão e personalizadas                         |
| `/investments`  | consulta e ferramentas de investimentos                    |
| `/assistant`    | conversas, mensagens, confirmações e undo                  |
| `/voice`        | transcrição, síntese e vozes disponíveis                   |
| `/reports`      | geração e download autenticado                             |
| `/dashboard`    | agregações por período                                     |
| `/admin/*`      | usuários, provedores, modelos e configurações              |

Controladores não concentrarão regra de negócio. DTOs validam formato; serviços de domínio validam invariantes; guards/policies validam papel e propriedade.

## Banco de dados

O Prisma modelará as entidades exigidas no prompt: `User`, `Role`, `UserProfile`, `GoogleConnection`, `Spreadsheet`, `FinancialAccount`, `Transaction`, `Category`, `Investment`, `RecurringTransaction`, `Installment`, `Conversation`, `ConversationMessage`, `AIProvider`, `AIConfiguration`, `VoicePreference`, `Report`, `SystemSetting` e `ActionHistory`.

Decisões:

- UUID para identificadores.
- UTC no banco; apresentação no fuso do perfil.
- valores em `Decimal`, com código ISO de moeda.
- unicidade e índices compostos por proprietário/contexto.
- integridade referencial e deleção explícita.
- `ActionHistory` guarda somente informação funcional necessária para auditoria do usuário e desfazer.

## Google OAuth

O login e a conexão com Sheets serão tratados pelo backend usando Authorization Code com state, nonce e PKCE. O consentimento para Drive/Sheets será incremental. Tokens Google permanecerão criptografados no banco e nunca serão entregues ao React.

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

### Autorização e IDOR

Toda consulta usa o `userId` autenticado como parte do filtro. Buscar por um ID global e verificar depois não será o padrão. Admin também passa por policies explícitas; não existe bypass implícito.

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
