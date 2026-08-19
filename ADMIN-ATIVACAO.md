# Ativar o administrador

A ativação inicial é deliberadamente local: nenhum usuário consegue se promover a administrador pelo navegador.

1. Crie sua conta normalmente e feche o servidor.
2. No terminal, dentro da pasta `WifiCord`, execute:

```bash
npm install
npm run admin:setup -- SEU_USUARIO
```

3. Inicie novamente:

```bash
npm start
```

4. Entre na conta promovida. O botão 🛡️ **Admin** aparecerá na interface.

O comando só funciona se ainda não existir nenhum administrador. Depois da primeira ativação, ele não pode ser usado para criar outro administrador. Administradores podem conceder/remover a função pela própria área administrativa.

## Moderação

O painel possui pontos, WFNA, funções, mute de chat/voz, castigo, ban temporário/permanente, desbloqueio, encerramento de chamada e efeitos reversíveis como Rainbow e Susto.

O mute de voz é aplicado ao cliente e também impede novas chamadas pelo servidor. Como a chamada usa WebRTC P2P, a mídia de uma conexão já estabelecida não passa pelo servidor; por isso o painel também envia o bloqueio ao cliente e encerra chamadas quando solicitado.
