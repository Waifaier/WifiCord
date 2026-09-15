# Áudio

Todos os sons do jogo são **sintetizados em tempo real** com a Web Audio API (`client/js/audio.js`):
passos, portas, máquinas, interferência, ambiente, perseguição, eventos e jumpscares.

Nenhum arquivo de áudio de terceiros é usado. Se quiser trocar por arquivos próprios
(CC0 ou gravados por você), coloque-os nesta pasta e altere as funções em `audio.js`
para tocar `AudioBuffer`s carregados com `fetch()` + `decodeAudioData()`.

Sugestões de fontes CC0: freesound.org (filtro "Creative Commons 0"), opengameart.org (licença CC0).
