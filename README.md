# WifiCord

Aplicativo de comunicação em tempo real com chat, amizades, perfis, loja, pontos, WFNA e chamadas WebRTC.

## Executar

Requisitos: Node.js 22.5+ (22 LTS recomendado).

```bash
npm install
npm start
```

Abra `http://localhost:3000`.

## Ativar o primeiro administrador

A promoção inicial é feita **localmente no terminal**. Não existe botão no navegador para alguém se promover, e o comando só funciona enquanto não houver nenhum administrador.

```bash
npm run admin:setup -- SEU_USUARIO
```

Exemplo:

```bash
npm run admin:setup -- wifier
```

Depois reinicie o servidor e entre nessa conta. O botão de administração aparece na interface.

Consulte `ADMIN-ATIVACAO.md` para os detalhes.

## Persistência

Os dados ficam em `server/database/chat.db` e sobrevivem a reinicializações e atualizações dos arquivos. O banco original enviado com o projeto foi preservado neste pacote; as migrações novas são aplicadas automaticamente.

## Chamadas

As chamadas usam WebRTC P2P com STUN. Para produção entre redes que não conseguem estabelecer P2P diretamente, configure um servidor TURN no bloco `RTC_CONFIG` de `client/js/call.js`.

## Observação sobre Node 22+

O projeto usa o SQLite integrado de Node (`node:sqlite`) para evitar binários nativos de SQLite incompatíveis entre sistemas. Isso requer Node 22.5+.


## Administradores
Para promover: `node scripts/admin-role.js <username> admin`
Para remover: `node scripts/admin-role.js <username> user`
O script impede remover o último administrador.
