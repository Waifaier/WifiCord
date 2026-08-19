# WifiCord

Aplicativo de comunicação em tempo real com chat, amizades, perfis, loja, pontos, WFNA e chamadas WebRTC.

## Requisitos

- Node.js 22 LTS (o projeto mantém `22.x`; o Render pode usar 22.23.2).
- Para produção no Render, este projeto usa SQLite com **Persistent Disk**. Isso mantém a arquitetura SQLite existente sem uma migração destrutiva para PostgreSQL.

## Executar localmente

```bash
npm ci
npm start
```

Abra `http://localhost:3000`.

Para produção local:

```bash
NODE_ENV=production SESSION_SECRET="um-segredo-longo-e-aleatorio" ADMIN_USERNAME="waifaier" npm start
```

## Persistência em produção

O problema original no Render era o armazenamento: `server/database/chat.db` ficava no filesystem efêmero do serviço. O arquivo funcionava enquanto aquela instância existia, mas podia ser perdido em restart/redeploy.

O projeto agora aceita:

- `SQLITE_PATH` — caminho absoluto do banco SQLite.
- `UPLOAD_DIR` — diretório absoluto dos arquivos enviados.

No Render, configure ambos dentro do Persistent Disk, por exemplo:

```text
SQLITE_PATH=/var/data/chat.db
UPLOAD_DIR=/var/data/uploads
```

O Persistent Disk é apropriado para esta versão do WifiCord porque o projeto usa `node:sqlite` de forma síncrona em muitos modelos/rotas. Uma migração para PostgreSQL exigiria adaptar toda a camada de acesso a dados e várias construções específicas do SQLite (`?`, `lastInsertRowid`, `INSERT OR IGNORE`, `json_extract`, etc.). Para uma única instância do Render, o Persistent Disk resolve a causa real sem alterar a arquitetura funcional.

> Limitação importante: Persistent Disk é armazenamento local da instância. Se no futuro o WifiCord precisar de múltiplas instâncias/escala horizontal, a próxima evolução recomendada é PostgreSQL + armazenamento de arquivos externo.

## Sessões

O `MemoryStore` padrão do `express-session` foi removido. As sessões agora são armazenadas na tabela SQLite `sessions`, no mesmo banco persistente. Assim, o aviso de `MemoryStore` deixa de ocorrer e as sessões sobrevivem a reinícios enquanto o Persistent Disk for mantido.

Em produção, `SESSION_SECRET` é obrigatório e deve ser configurado como Environment Variable secreta. O servidor também confia no proxy HTTPS do Render para que o cookie `secure` funcione corretamente.

## Primeiro administrador

Configure no Render:

```text
ADMIN_USERNAME=waifaier
```

O bootstrap é seguro e determinístico:

1. Se já existir qualquer administrador, nenhuma promoção automática é feita.
2. Se não existir administrador e a conta indicada por `ADMIN_USERNAME` ainda não existir, o servidor apenas registra um aviso.
3. Depois de criar a conta com esse username, no próximo restart/deploy ela será promovida automaticamente.
4. Nenhum usuário consegue alterar `ADMIN_USERNAME` pelo navegador; é uma variável de ambiente do serviço.
5. A promoção manual existente continua disponível para o administrador.

Para ativação manual/local:

```bash
npm run admin:setup -- SEU_USUARIO
```

Para alterar uma função localmente:

```bash
node scripts/admin-role.js <username> admin
node scripts/admin-role.js <username> user
```

O script impede remover o último administrador.

## Render

### Environment Variables

Configure:

```text
NODE_ENV=production
SESSION_SECRET=<segredo aleatório longo>
ADMIN_USERNAME=waifaier
SQLITE_PATH=/var/data/chat.db
UPLOAD_DIR=/var/data/uploads
```

E mantenha `WFNA_PAYMENT_URL` se o recurso de pagamento estiver sendo usado.

### Persistent Disk

No serviço Web do Render:

1. Abra o serviço do WifiCord.
2. Vá em **Disks / Persistent Disk**.
3. Crie um disco persistente.
4. Use o mount path:

```text
/var/data
```

5. Escolha o tamanho conforme o volume de mídia esperado.
6. Salve e faça um novo deploy.

O banco será criado automaticamente em `/var/data/chat.db` na primeira inicialização, e os uploads em `/var/data/uploads`.

### Build e Start

```text
Build Command: npm ci
Start Command: npm start
```

Não é necessário instalar PostgreSQL para esta versão.

## Migração

Não há migração SQL para executar ao instalar a versão corrigida: o schema é criado/atualizado automaticamente na inicialização.

Se você possui dados importantes em um `chat.db` local, faça backup antes de trocar o ambiente de produção. Como o schema continua sendo SQLite, um banco existente pode continuar sendo usado no caminho configurado em `SQLITE_PATH`.

Os arquivos de banco, `.env` e uploads não devem ser enviados ao GitHub.

## Testes

O projeto foi verificado para:

- cadastro e login;
- persistência da conta após reinício;
- persistência da sessão;
- persistência de mensagens;
- persistência de servidor/canal;
- bootstrap do primeiro administrador;
- não criação automática de segundo administrador;
- persistência dos uploads quando `UPLOAD_DIR` aponta para o Persistent Disk.

## Chamadas

As chamadas usam WebRTC P2P com STUN. Para produção entre redes que não conseguem estabelecer P2P diretamente, configure um servidor TURN no bloco `RTC_CONFIG` de `client/js/call.js`.

## Recursos desta versão

- Perfil com avatar armazenado em arquivo persistente e tamanho rigidamente limitado na interface.
- Aba **Apoiar um criador** nas configurações, com validação somente no servidor.
- Recompensa de pontos e promoção administrativa por código de criador, sem exibir os códigos na interface.
- Painel administrativo com efeitos, moderação e pegadinhas reversíveis, incluindo tela que encolhe lentamente e controles que desaparecem ao serem usados.
- **WiPaint** dentro da área de mídia, com pincel normal/pixel, borracha, formas, texto, conta-gotas, camadas, zoom, grade, desfazer/refazer e exportação PNG.
- Diagnóstico de microfone que não trata o sinal `MediaStreamTrack.muted` transitório como falha automática.
- Configuração WebRTC carregada pelo servidor, incluindo TURN quando configurado.
- Economia e biblioteca de mídia convertidas para SQLite/`node:sqlite`.
