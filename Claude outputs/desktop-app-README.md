# WifiCord Desktop

App de desktop do WifiCord. Não roda o servidor — só abre uma janela
conectada em `https://wificord.onrender.com` (igual o app oficial do
Discord: é o site deles dentro de uma janela própria).

Tudo aqui é feito com **Electron** e **electron-builder**, que são
gratuitos e de código aberto.

## Rodar sem gerar instalador (pra testar)

Precisa ter o [Node.js](https://nodejs.org) instalado (qualquer versão
recente, 18+).

```bash
cd desktop-app
npm install
npm start
```

Uma janela deve abrir já carregando o WifiCord.

## Gerar o instalador (.exe / .dmg / .AppImage)

```bash
cd desktop-app
npm install

# Windows (.exe)
npm run dist:win

# Mac (.dmg) — só funciona rodando num Mac
npm run dist:mac

# Linux (.AppImage)
npm run dist:linux
```

O instalador pronto aparece na pasta `desktop-app/release/`.

**Importante:** o `electron-builder` só gera `.exe` de verdade (assinado
e funcional) se você rodar o comando **num Windows**, e o `.dmg` só
**num Mac** — não dá pra gerar o `.exe` a partir de um Linux/Mac sem
configurar Wine, o que dá mais dor de cabeça do que vale a pena. Mais
fácil: gere cada instalador na própria máquina do sistema que ele é
destinado, ou use uma máquina virtual/GitHub Actions grátis (runners
`windows-latest` e `macos-latest` do GitHub Actions são de graça pra
repositórios públicos).

## Trocar a URL do servidor

Por padrão ele aponta pra `https://wificord.onrender.com`. Se você
mudar de host, é só editar a constante `SERVER_URL` em `main.js` (ou
rodar com a variável de ambiente `WIFICORD_URL=https://sua-url.com npm start`
antes de gerar o build final).

## Ícone do app (opcional)

Não coloquei um ícone customizado ainda — o build usa o ícone padrão
do Electron. Se quiser o logo do WifiCord no `.exe`, é só colocar:

- `build/icon.ico` (Windows, 256x256)
- `build/icon.icns` (Mac)
- `build/icon.png` (Linux, 512x512)

E adicionar de volta as linhas `"icon": "build/icon.ico"` (etc.) no
bloco `build` do `package.json`. Dá pra gerar essas imagens a partir
do `client/assets/logo.svg` em qualquer conversor online gratuito
(ex: convertio.co, cloudconvert.com) ou com o Photoshop/GIMP.

## Câmera e microfone

As chamadas de voz/vídeo do WifiCord usam `getUserMedia`, que
funciona normalmente dentro do Electron — a permissão já está
liberada em `main.js`. Na primeira chamada, o sistema operacional
(Windows/Mac) pode pedir permissão de câmera/microfone pro app
"WifiCord" — é só aceitar.
