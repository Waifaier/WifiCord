# WifiCord — deploy no Render

## Persistência SQLite

O SQLite só permanece entre deploys/restarts se o serviço do Render tiver um Persistent Disk.

Configure no serviço:
- `SQLITE_PATH=/var/data/chat.db`
- `UPLOAD_DIR=/var/data/uploads`

Monte o Persistent Disk em `/var/data`.

O projeto não usa mais PostgreSQL/`pg`.

## Chamadas WebRTC

O cliente usa STUN por padrão. Para melhorar chamadas entre redes diferentes, configure um servidor TURN:

- `TURN_URLS=turn:SEU_HOST:3478,turns:SEU_HOST:5349`
- `TURN_USERNAME=...`
- `TURN_CREDENTIAL=...`

As credenciais TURN são entregues ao navegador pelo endpoint `/api/config/rtc`, como é necessário para WebRTC.

## Instalação

```bash
npm ci
npm start
```

Node recomendado: 22.x.
