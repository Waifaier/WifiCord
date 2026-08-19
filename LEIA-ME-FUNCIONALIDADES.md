# Alterações desta versão

## Chamadas
- áudio e vídeo WebRTC;
- seleção e troca de microfone/câmera;
- teste real de microfone com medidor;
- câmera pode ser ativada durante chamada de voz;
- compartilhamento de tela sem esconder os avatares;
- tela cheia;
- avatar dos participantes;
- anel verde de fala;
- indicador "APRESENTANDO" somente enquanto a tela estiver sendo compartilhada;
- desligar/ligar microfone e câmera.

## Configurações
- janela grande e responsiva;
- navegação lateral;
- perfil, aparência, notificações, privacidade e voz/vídeo;
- seleção de dispositivos e prévia da câmera;
- teste do microfone.

## Stickers
- stickers agora são imagens SVG reais e não apenas texto/emoji;
- renderização maior e sem o texto "sticker".

## Administração
- ativação inicial somente por comando local;
- usuários, pesquisa e logs;
- pontos;
- WFNA;
- função de administrador;
- mute de chat;
- mute de voz;
- castigo;
- ban temporário;
- ban permanente;
- desbloqueio;
- encerramento de chamada;
- efeito Rainbow reversível;
- susto visual temporário e reversível;
- limpeza das punições.

### Segurança
A autorização administrativa é verificada no backend. Alterar HTML/JavaScript no navegador não concede privilégios. O primeiro administrador só pode ser criado pelo comando local e o comando deixa de funcionar quando já existe um administrador.

### Limite do mute de voz
As chamadas utilizam WebRTC P2P. O servidor controla a autorização de novas chamadas e envia o bloqueio ao cliente, mas a mídia de uma conexão WebRTC já estabelecida não passa pelo servidor. Por isso, ao aplicar mute de voz, o WifiCord desativa o microfone no cliente e o servidor bloqueia novas chamadas; o administrador também pode encerrar a chamada.
