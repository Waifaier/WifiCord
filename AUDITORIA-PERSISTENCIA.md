# Auditoria de produção — WifiCord

## 1. Causa raiz da perda de dados

O WifiCord usa `node:sqlite` e abre o banco em:

```text
server/database/chat.db
```

O código SQLite estava correto para persistência local: as escritas são feitas diretamente no arquivo e o banco usa WAL + foreign keys.

O problema no Render era o **filesystem efêmero do serviço**. O banco estava dentro do filesystem do serviço Web, não em um Persistent Disk. Assim:

- cadastro funcionava durante a vida da instância;
- mensagens/servidores/etc. também eram gravados;
- restart/redeploy podia recriar o filesystem a partir da imagem/deploy;
- o arquivo `chat.db` antigo deixava de existir;
- no novo processo o schema era recriado vazio;
- `ADMIN_USERNAME=waifaier` não encontrava a conta.

Não havia uma falha específica no `INSERT` de usuários que explicasse o desaparecimento local.

## 2. Decisão arquitetural

Foi mantido SQLite + `node:sqlite` e adicionado suporte explícito a armazenamento persistente:

```text
SQLITE_PATH=/var/data/chat.db
UPLOAD_DIR=/var/data/uploads
```

Isso é deliberado.

A aplicação usa SQLite diretamente em muitos modelos/rotas e depende de construções específicas do SQLite, incluindo:

- placeholders `?`;
- `lastInsertRowid`;
- `INSERT OR IGNORE`;
- `ON CONFLICT`;
- `datetime('now')`;
- `json_extract`;
- `PRAGMA`;
- `AUTOINCREMENT`;
- operações síncronas de `DatabaseSync`.

Migrar diretamente para PostgreSQL exigiria reescrever a camada de acesso a dados e adaptar diversas queries. Para a implantação atual em uma única instância Render, Persistent Disk é a correção mais segura e de menor risco funcional.

PostgreSQL continua sendo a evolução recomendada se o WifiCord precisar de múltiplas instâncias ou escala horizontal.

## 3. Escopo de SQLite auditado

Foram verificados os usos diretos do banco em:

- usuários/autenticação;
- amizades;
- servidores;
- membros de servidores;
- canais;
- mensagens;
- reações;
- inventário;
- pontos;
- WFNA;
- ações administrativas;
- mídia;
- configurações de servidores;
- cargos;
- cargos de membros;
- apelidos de servidor;
- apelidos locais;
- sessões;
- sessões dos minijogos.

Todas continuam usando o mesmo arquivo SQLite configurável.

## 4. Sessões

O `MemoryStore` padrão do `express-session` foi removido.

Foi criado um `SqliteSessionStore` que armazena:

```text
sid
sess
expire_at
```

na tabela `sessions`.

O armazenamento de sessão usa o mesmo SQLite persistente, com limpeza periódica de sessões expiradas.

Também foi configurado:

```js
app.set('trust proxy', 1)
```

em produção para que cookies `secure` funcionem corretamente atrás do proxy HTTPS do Render.

## 5. Mídia

Os registros de mídia já eram armazenados no SQLite, mas os arquivos físicos ficavam em `server/uploads`, que também é efêmero no Render.

Agora o diretório aceita:

```text
UPLOAD_DIR=/var/data/uploads
```

Assim, tanto o registro no banco quanto o arquivo físico podem sobreviver ao restart/deploy.

## 6. Bootstrap do administrador

O comportamento ficou:

1. `ADMIN_USERNAME` não configurado → bootstrap ignorado.
2. Já existe qualquer administrador → nenhuma promoção automática.
3. Não existe administrador e o username configurado ainda não existe → apenas aviso no log.
4. Não existe administrador e a conta configurada existe → ela é promovida.
5. Um segundo usuário não é promovido automaticamente depois que o primeiro admin existe.

A busca do username é case-insensitive.

`ADMIN_USERNAME` continua sendo exclusivamente uma variável de ambiente do servidor; não existe rota de navegador que possa alterar essa variável.

## 7. Node.js e dependências

A versão do projeto continua:

```text
Node.js 22.x
```

Não foi feita alteração desnecessária de runtime.

O `package.json` mantém as dependências existentes.

O `package-lock.json` foi normalizado para não depender de URLs internas do ambiente Replit no campo `resolved`.

## 8. Git e segredos

O `.gitignore` foi reforçado para ignorar:

```text
.env
*.db
*.db-journal
*.db-wal
*.db-shm
server/uploads/*
```

com exceção do `.gitkeep`.

Nenhum `DATABASE_URL`, senha real, token ou `SESSION_SECRET` real foi colocado no código.

O fallback de desenvolvimento do segredo de sessão foi removido: em desenvolvimento o segredo é gerado aleatoriamente no processo; em produção `SESSION_SECRET` é obrigatório.

## 9. Testes executados

Foi executado um smoke test local usando Node 22:

- criação de usuário;
- logout;
- login;
- criação de servidor;
- criação/persistência do canal geral;
- criação de mensagem;
- restart do servidor;
- recuperação da sessão existente após restart;
- recuperação do usuário após restart;
- recuperação do servidor após restart;
- recuperação da mensagem após restart;
- bootstrap de `waifaier` após restart;
- criação de segundo usuário;
- restart com administrador já existente;
- confirmação de que o segundo usuário permaneceu `role=user`;
- upload de arquivo;
- restart;
- confirmação de que o arquivo físico continuou presente.

Também foram executados `node --check` nos arquivos alterados.

O teste local mostrou o log esperado:

```text
[ADMIN] Usuário "waifaier" ainda não existe...
```

antes da conta existir, e depois:

```text
[ADMIN] Administrador ativado automaticamente: waifaier (id 1).
```

No restart seguinte:

```text
[ADMIN] Já existe um administrador: waifaier. Nenhuma promoção automática foi feita.
```

## 10. Migração de banco

Não é necessária uma migração SQL manual.

O `db.js` cria a tabela `sessions` e mantém as migrações de colunas existentes automaticamente.

Para uma instalação nova no Persistent Disk:

```text
/var/data/chat.db
```

será criado automaticamente.

Se houver um `chat.db` local importante, faça backup antes de alterar caminhos de produção.

## 11. Render

Configure um Persistent Disk com:

```text
Mount Path: /var/data
```

Environment Variables:

```text
NODE_ENV=production
SESSION_SECRET=<segredo aleatório longo>
ADMIN_USERNAME=waifaier
SQLITE_PATH=/var/data/chat.db
UPLOAD_DIR=/var/data/uploads
```

Build:

```text
npm ci
```

Start:

```text
npm start
```

O projeto não exige PostgreSQL para esta versão.

## 12. Limitação conhecida

Persistent Disk é adequado para a arquitetura atual de uma única instância.

Se futuramente o Render executar múltiplas instâncias do Web Service, SQLite em disco local não deve ser usado como banco compartilhado. Nesse cenário, a migração recomendada é PostgreSQL e, idealmente, armazenamento externo para mídia.
