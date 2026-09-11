import type { CapacitorConfig } from '@capacitor/cli';

// Config da casca Android do WifiCord.
//
// server.url aponta pro site JÁ NO AR (Render). Isso é proposital: o app não
// carrega HTML/CSS/JS embutido no APK, ele abre a WebView direto no site,
// então toda atualização feita no GitHub -> Render aparece pro usuário na
// hora, sem precisar baixar um APK novo. O updater automático (ver
// android/app/src/main/java/.../updater/) só entra em ação pra mudanças da
// CASCA nativa em si (permissões, plugin de compartilhar tela, ícone) — que
// são raras — e é isso que o botão "verificar atualização" e o aviso
// automático checam contra os Releases do GitHub.
const config: CapacitorConfig = {
  appId: 'com.wificord.app',
  appName: 'WifiCord',
  webDir: 'www',
  server: {
    url: 'https://wificord.onrender.com',
    cleartext: false,
    // Permite abrir/receber links wificord.onrender.com dentro do próprio
    // app em vez de jogar pro navegador do sistema.
    allowNavigation: ['wificord.onrender.com', '*.onrender.com']
  },
  android: {
    // WebView usa o mesmo motor do Chrome no Android — necessário pra
    // WebRTC (getUserMedia) funcionar direito.
    allowMixedContent: false,
    webContentsDebuggingEnabled: false
  }
};

export default config;
