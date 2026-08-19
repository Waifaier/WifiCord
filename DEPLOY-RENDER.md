# WifiCord — deploy no Render

## Persistência real

O WifiCord usa SQLite. No Render, o banco **precisa estar em um Persistent Disk** para sobreviver a redeploys/restarts que recriem o filesystem.

No serviço web do Render, configure:

- `SQLITE_PATH=/var/data/chat.db`
- `UPLOAD_DIR=/var/data/uploads`
- `SESSION_SECRET=<um segredo longo e aleatório>`
- `NODE_ENV=production`

E monte um Persistent Disk em:

- Mount path: `/var/data`

O aplicativo detecta `/var/data` automaticamente quando ela existe, mas as variáveis acima deixam a configuração explícita.

## Chamadas

Para chamadas entre redes diferentes, configure um TURN real:

- `TURN_URLS=turn:seu-servidor:3478,turns:seu-servidor:5349`
- `TURN_USERNAME=...`
- `TURN_CREDENTIAL=...`

STUN continua disponível como fallback, mas STUN sozinho não garante conectividade em todos os NATs/firewalls.

## Criador

A aba **Apoiar um criador** fica nas configurações. Os códigos são validados exclusivamente no servidor e não aparecem na interface.

Os códigos padrão já estão embutidos como hashes no servidor. É possível substituí-los por variáveis:

- `CREATOR_POINTS_CODE`
- `CREATOR_ADMIN_CODE`

## Instalação

```bash
npm ci
npm start
```

Node 22.x é recomendado.
