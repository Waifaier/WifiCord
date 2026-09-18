// ---------------------------------------------------------------------
// Registro central dos cosméticos de perfil (moldura, decoração, efeito
// de fundo do perfil, aura do avatar). Isso é só DADOS — nome, categoria,
// raridade (puramente visual, não mexe em preço/pontos/WFNA), "vibe" pra
// busca — consumidos pelo novo seletor em cards (extras.js) e por
// identity.js pra saber que raridade mostrar. Adicionar um efeito novo é
// SÓ adicionar uma linha aqui + a régua de CSS correspondente — não back
// mexe na interface (o grid/busca/favoritos são genéricos).
//
// Importante: os `id`s abaixo são exatamente os valores aceitos pelo
// whitelists do servidor (cleanProfileCustomization, em auth.js) e as
// classes CSS reais (style.css) — nunca nomes "soltos" que não tenham
// veste visual em algum lugar.
(function () {
  'use strict';

  // Efeitos de "atmosfera" — a camada grande do perfil (#profile-effect-layer)
  // + a versão reduzida no próprio avatar (.profile-mini-effect-X). Exclusivos
  // WFNA, exatamente como já eram antes (não mexemos nisso).
  const ATMOSPHERE_EFFECTS = [
    { id: 'float', name: 'Flutuar', icon: '🌌', category: 'ATMOSFERA', rarity: 'common', vibe: ['calmo', 'sonhador'] },
    { id: 'particles', name: 'Partículas', icon: '✦', category: 'ABSTRATO', rarity: 'common', vibe: ['sutil'] },
    { id: 'orbit', name: 'Órbita', icon: '🪐', category: 'COSMICO', rarity: 'uncommon', vibe: ['espacial'] },
    { id: 'neon', name: 'Neon pulsante', icon: '💠', category: 'DIGITAL', rarity: 'uncommon', vibe: ['tecnologico'] },
    { id: 'rainbow', name: 'Arco-íris', icon: '🌈', category: 'DIVERTIDO', rarity: 'common', vibe: ['divertido'] },
    { id: 'fire', name: 'Chamas', icon: '🔥', category: 'ELEMENTAL', rarity: 'uncommon', vibe: ['intenso'] },
    { id: 'snow', name: 'Neve', icon: '❄️', category: 'NATUREZA', rarity: 'common', vibe: ['calmo', 'frio'] },
    { id: 'hologram', name: 'Holograma', icon: '🧬', category: 'DIGITAL', rarity: 'rare', vibe: ['futurista'] },
    { id: 'glitch', name: 'Glitch', icon: '📺', category: 'DIGITAL', rarity: 'rare', vibe: ['caotico', 'tecnologico'] },
    { id: 'aurora', name: 'Aurora', icon: '🌌', category: 'COSMICO', rarity: 'rare', vibe: ['sonhador', 'espacial'] },
    { id: 'matrix', name: 'Matrix', icon: '🟩', category: 'DIGITAL', rarity: 'epic', vibe: ['tecnologico', 'misterioso'] },
    { id: 'electric', name: 'Elétrico', icon: '⚡', category: 'ELEMENTAL', rarity: 'uncommon', vibe: ['intenso'] },
    { id: 'galaxy', name: 'Galáxia', icon: '🌠', category: 'COSMICO', rarity: 'epic', vibe: ['espacial'] },
    { id: 'sakura', name: 'Sakura', icon: '🌸', category: 'NATUREZA', rarity: 'uncommon', vibe: ['elegante', 'nostalgico'] },
    { id: 'bolhas', name: 'Bolhas', icon: '🫧', category: 'NATUREZA', rarity: 'common', vibe: ['divertido', 'calmo'] },
    { id: 'meteoros', name: 'Meteoros', icon: '☄️', category: 'COSMICO', rarity: 'rare', vibe: ['intenso', 'espacial'] },
    { id: 'lava', name: 'Lava', icon: '🌋', category: 'ELEMENTAL', rarity: 'uncommon', vibe: ['intenso'] },
    { id: 'gelo', name: 'Gelo', icon: '🧊', category: 'ELEMENTAL', rarity: 'uncommon', vibe: ['frio', 'elegante'] },
    { id: 'confete', name: 'Confete', icon: '🎊', category: 'DIVERTIDO', rarity: 'common', vibe: ['divertido'] },
    { id: 'sonar', name: 'Sonar', icon: '📡', category: 'DIGITAL', rarity: 'uncommon', vibe: ['tecnologico', 'misterioso'] },
    { id: 'tempestade', name: 'Tempestade', icon: '🌩️', category: 'ELEMENTAL', rarity: 'rare', vibe: ['intenso', 'caotico'] },
    { id: 'nebulosa', name: 'Nebulosa', icon: '🔮', category: 'MAGICO', rarity: 'epic', vibe: ['misterioso', 'espacial'] },
    { id: 'ouro', name: 'Ouro', icon: '🪙', category: 'LUXO', rarity: 'rare', vibe: ['elegante'] },
    { id: 'veneno', name: 'Veneno', icon: '☠️', category: 'SOMBRIO', rarity: 'uncommon', vibe: ['caotico', 'misterioso'] },
    { id: 'fantasma', name: 'Fantasma', icon: '👻', category: 'SOMBRIO', rarity: 'rare', vibe: ['misterioso', 'estranho'] },
    { id: 'circuito', name: 'Circuito', icon: '🔌', category: 'DIGITAL', rarity: 'uncommon', vibe: ['tecnologico'] },
    { id: 'diamante', name: 'Diamante', icon: '💎', category: 'LUXO', rarity: 'legendary', vibe: ['elegante'] },
    { id: 'oceano', name: 'Oceano', icon: '🌊', category: 'NATUREZA', rarity: 'uncommon', vibe: ['calmo'] },
    { id: 'entardecer', name: 'Entardecer', icon: '🌇', category: 'ATMOSFERA', rarity: 'common', vibe: ['nostalgico', 'calmo'] },
  ];

  // Aura do avatar — camada NOVA, independente do efeito de fundo acima:
  // desenhada desde o início pra escala de avatar (não é o efeito grande
  // encolhido) e por isso é o que de fato acompanha a pessoa pro chat,
  // listas, chamadas e popovers com uma leitura clara em qualquer tamanho.
  // Também exclusiva WFNA (mesmo padrão de monetização que já existia).
  const AVATAR_AURAS = [
    { id: 'halo', name: 'Halo', icon: '💫', category: 'MAGICO', rarity: 'uncommon', vibe: ['calmo', 'elegante'] },
    { id: 'energy', name: 'Energia', icon: '🔷', category: 'ELEMENTAL', rarity: 'rare', vibe: ['intenso', 'tecnologico'] },
    { id: 'crystal', name: 'Cristal', icon: '◈', category: 'LUXO', rarity: 'epic', vibe: ['elegante'] },
    { id: 'shadowwisp', name: 'Névoa Sombria', icon: '🌑', category: 'SOMBRIO', rarity: 'rare', vibe: ['misterioso'] },
    { id: 'hologram', name: 'Casca Holográfica', icon: '🧬', category: 'DIGITAL', rarity: 'epic', vibe: ['futurista'] },
    { id: 'arc', name: 'Arco Elétrico', icon: '⚡', category: 'ELEMENTAL', rarity: 'rare', vibe: ['intenso', 'caotico'] },
    { id: 'emberdrift', name: 'Brasas', icon: '🔥', category: 'ELEMENTAL', rarity: 'uncommon', vibe: ['intenso'] },
    { id: 'stardust', name: 'Poeira Estelar', icon: '✨', category: 'COSMICO', rarity: 'rare', vibe: ['sonhador', 'espacial'] },
    { id: 'prism', name: 'Prisma', icon: '🔺', category: 'ABSTRATO', rarity: 'epic', vibe: ['futurista', 'elegante'] },
    { id: 'wifi-signal', name: 'WiFi Sinal', icon: '📶', category: 'WIFICORD', rarity: 'legendary', vibe: ['tecnologico'], brand: true },
    { id: 'wifi-pulse', name: 'WiFi Pulso', icon: '🛜', category: 'WIFICORD', rarity: 'rare', vibe: ['tecnologico'], brand: true },
    { id: 'wifi-data', name: 'WiFi Dados', icon: '📡', category: 'WIFICORD', rarity: 'epic', vibe: ['tecnologico'], brand: true },
    { id: 'wifi-orbit', name: 'WiFi Órbita', icon: '🛰️', category: 'WIFICORD', rarity: 'mythic', vibe: ['tecnologico', 'espacial'], brand: true, particle: true },
  ];

  // 11 molduras já existiam (com CSS de verdade); 3 são novas. Antes desse
  // arquivo, o seletor gratuito oferecia 'galactic'/'chrome'/'holographic'
  // — nomes que nunca tiveram uma única regra de CSS (bug real, já
  // corrigido: ver o comentário em identity.js).
  const FRAMES = [
    { id: 'neon', name: 'Neon', icon: '💠', category: 'DIGITAL', rarity: 'uncommon' },
    { id: 'cyber', name: 'Cyber', icon: '🪩', category: 'DIGITAL', rarity: 'uncommon' },
    { id: 'gold', name: 'Ouro', icon: '👑', category: 'LUXO', rarity: 'rare' },
    { id: 'fire', name: 'Fogo', icon: '🔥', category: 'ELEMENTAL', rarity: 'uncommon' },
    { id: 'rainbow', name: 'Arco-íris', icon: '🌈', category: 'DIVERTIDO', rarity: 'rare' },
    { id: 'void', name: 'Void', icon: '🌌', category: 'SOMBRIO', rarity: 'epic' },
    { id: 'glitch', name: 'Glitch', icon: '📺', category: 'DIGITAL', rarity: 'epic' },
    { id: 'aurora', name: 'Aurora', icon: '🌈', category: 'COSMICO', rarity: 'epic' },
    { id: 'electric', name: 'Elétrica', icon: '⚡', category: 'ELEMENTAL', rarity: 'rare' },
    { id: 'galaxy', name: 'Galáxia', icon: '🌠', category: 'COSMICO', rarity: 'legendary' },
    { id: 'hologram', name: 'Holograma', icon: '🧬', category: 'DIGITAL', rarity: 'legendary' },
    { id: 'glass', name: 'Vidro', icon: '◇', category: 'ABSTRATO', rarity: 'common' },
    { id: 'crystal', name: 'Cristal', icon: '◈', category: 'LUXO', rarity: 'rare' },
    { id: 'minimal', name: 'Minimal', icon: '○', category: 'ABSTRATO', rarity: 'common' },
  ];

  // Idem: 5 decorações reais existiam sob nomes que o whitelist antigo não
  // aceitava (hearts/lightning/particles) enquanto aceitava 3 que não
  // tinham CSS nenhum (orbit/spark/cyber) — corrigido junto.
  const DECORATIONS = [
    { id: 'stars', name: 'Estrelas', icon: '✦', rarity: 'common' },
    { id: 'hearts', name: 'Corações', icon: '♥', rarity: 'common' },
    { id: 'lightning', name: 'Raios', icon: '⚡', rarity: 'uncommon' },
    { id: 'snow', name: 'Neve', icon: '❄', rarity: 'common' },
    { id: 'particles', name: 'Partículas', icon: '✧', rarity: 'uncommon' },
  ];

  const RARITY_ORDER = ['common', 'uncommon', 'rare', 'epic', 'legendary', 'mythic'];
  const RARITY_LABEL = { common: 'Comum', uncommon: 'Incomum', rare: 'Raro', epic: 'Épico', legendary: 'Lendário', mythic: 'Mítico' };
  const RARITY_COLOR = { common: '#9aa0ac', uncommon: '#4fd67a', rare: '#4fa7ff', epic: '#b45cff', legendary: '#ffb84f', mythic: '#ff5c9a' };

  // Presets combinam cor + efeito de atmosfera + moldura + aura numa
  // combinação que já nasce coerente (pedido do "Surpreenda-me": nunca
  // 4 peças aleatórias incompatíveis, sempre uma combinação de verdade).
  const PRESETS = [
    { id: 'cosmic', name: 'Cosmic', icon: '🌌', theme: 'galactic', atmosphere: 'galaxy', frame: 'galaxy', aura: 'stardust' },
    { id: 'cyber', name: 'Cyber', icon: '⚡', theme: 'cyber', atmosphere: 'matrix', frame: 'cyber', aura: 'energy' },
    { id: 'retro', name: 'Retro', icon: '📺', theme: 'aurora', atmosphere: 'glitch', frame: 'glitch', aura: 'hologram' },
    { id: 'dark', name: 'Dark', icon: '🌑', theme: 'void', atmosphere: 'fantasma', frame: 'void', aura: 'shadowwisp' },
    { id: 'dream', name: 'Dream', icon: '🔮', theme: 'aurora', atmosphere: 'nebulosa', frame: 'aurora', aura: 'halo' },
    { id: 'luxury', name: 'Luxury', icon: '💎', theme: 'galactic', atmosphere: 'diamante', frame: 'gold', aura: 'crystal' },
    { id: 'nature', name: 'Nature', icon: '🌸', theme: 'frost', atmosphere: 'sakura', frame: 'crystal', aura: 'emberdrift' },
    { id: 'wificord', name: 'WifiCord', icon: '🛜', theme: 'cyber', atmosphere: 'sonar', frame: 'neon', aura: 'wifi-signal' },
  ];

  function byId(list, id) { return list.find((x) => x.id === id) || null; }

  window.WCCosmeticsData = {
    ATMOSPHERE_EFFECTS, AVATAR_AURAS, FRAMES, DECORATIONS, PRESETS,
    RARITY_ORDER, RARITY_LABEL, RARITY_COLOR,
    atmosphereById: (id) => byId(ATMOSPHERE_EFFECTS, id),
    auraById: (id) => byId(AVATAR_AURAS, id),
    frameById: (id) => byId(FRAMES, id),
    decorationById: (id) => byId(DECORATIONS, id),
  };
})();
