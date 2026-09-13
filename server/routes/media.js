const express = require('express');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { execFile } = require('child_process');
const ffmpegPath = require('ffmpeg-static');
const ffprobePath = require('ffprobe-static').path;
const heicConvert = require('heic-convert');
const db = require('../database/db');
const User = require('../models/User');
const { requireAuth } = require('./auth');
const { UPLOAD_DIR } = require('../storage');

const router = express.Router();

// Era 4GB — enorme demais pro servidor gratuito (512MB de RAM/container).
// Mesmo o upload sendo gravado direto no disco em stream (nunca carrega o
// arquivo inteiro na memória do processo Node — ver req.pipe(stream)
// abaixo), a ESCRITA em si ainda passa pelo cache de página do Linux, que
// conta dentro do limite de memória do container. Um upload grande (mesmo
// bem menor que 4GB) podia sozinho estourar esse limite e derrubar o
// servidor pra TODO MUNDO, não só pra quem estava enviando.
const MAX_BYTES = 50 * 1024 * 1024;

const ALLOWED = new Set([
  'image/png',
  'image/jpeg',
  'image/gif',
  'image/webp',
  'image/avif',
  // HEIC/HEIF: o formato "eficiente" que vira padrão de foto em vários
  // celulares (efeito parecido ao HEVC de vídeo, ver comentário grande
  // mais abaixo perto de OK_VIDEO_CODECS). O upload aceita, mas o arquivo
  // NUNCA é servido nesse formato — é sempre convertido pra JPEG antes de
  // salvar (ver convertHeicIfNeeded), porque nenhum navegador baseado em
  // Chromium sabe abrir HEIC dentro de uma <img>.
  'image/heic',
  'image/heif',
  'video/mp4',
  'video/webm',
  'video/quicktime',
  'video/x-matroska',
  'audio/mpeg',
  'audio/ogg',
  'audio/wav',
  'audio/webm',
  'application/pdf',
  'application/zip',
  'application/x-7z-compressed',
  'application/x-rar-compressed',
  'text/plain',
  'application/json',
  'application/octet-stream'
]);

fs.mkdirSync(UPLOAD_DIR, { recursive: true });

// A extensão salva em disco é SEMPRE escolhida pelo servidor a partir do
// mime detectado — nunca a partir do nome de arquivo enviado pelo cliente.
// Isso fecha um caminho de XSS armazenado: sem isso, alguém podia mandar
// Content-Type "application/octet-stream" (permitido, pra arquivos
// genéricos) com um X-File-Name terminando em ".html" e conseguir um
// arquivo .html de verdade salvo em /uploads, servido pelo mesmo domínio
// do app e executado como página normal pelo navegador de quem abrisse o
// link. Com a extensão fixada pelo mime, isso não é mais possível.
const SAFE_EXTENSION_BY_MIME = {
  'image/png': '.png',
  'image/jpeg': '.jpg',
  'image/gif': '.gif',
  'image/webp': '.webp',
  'image/avif': '.avif',
  'image/heic': '.heic',
  'image/heif': '.heif',
  'video/mp4': '.mp4',
  'video/webm': '.webm',
  'video/quicktime': '.mov',
  'video/x-matroska': '.mkv',
  'audio/mpeg': '.mp3',
  'audio/ogg': '.ogg',
  'audio/wav': '.wav',
  'audio/webm': '.webm',
  'application/pdf': '.pdf',
  'application/zip': '.zip',
  'application/x-7z-compressed': '.7z',
  'application/x-rar-compressed': '.rar',
  'text/plain': '.txt',
  'application/json': '.json',
  'application/octet-stream': '.bin',
};

function safeName(name) {
  return String(name || 'arquivo')
    .replace(/[^a-zA-Z0-9._-]+/g, '_')
    .slice(0, 120) || 'arquivo';
}

// ---------------------------------------------------------------------
// Normalização de mídia "eficiente" (HEVC/HEIC) pra formatos universais
// (H.264/JPEG) — ver client/js/media.js e a conversa que achou o bug: um
// vídeo gravado ou baixado nesse formato toca liso no player NATIVO do
// celular (usa o decodificador do sistema operacional), mas nunca abre
// dentro de um <video>/<img> em NENHUM navegador baseado em Chromium —
// browser normal, WebView do app Android e até o app desktop (Electron),
// já que os três usam o mesmo motor. Chrome não decodifica H.265/HEIC por
// causa de licenciamento, então é o SERVIDOR que precisa converter antes
// de guardar, senão todo mundo que recebe a mídia vê ela quebrada, mesmo
// o arquivo original sendo perfeitamente válido.
// ---------------------------------------------------------------------

// Codecs que todo navegador Chromium moderno já sabe tocar direto —
// então SÓ transcodifica quando o vídeo enviado não estiver em nenhum
// desses (evita gastar CPU/tempo à toa em vídeos que já iam funcionar).
const OK_VIDEO_CODECS = new Set(['h264', 'vp8', 'vp9']);
const OK_AUDIO_CODECS = new Set(['aac', 'opus', 'vorbis', 'mp3']);

function ffprobeStreams(filePath) {
  return new Promise((resolve, reject) => {
    execFile(
      ffprobePath,
      ['-v', 'error', '-print_format', 'json', '-show_streams', filePath],
      { maxBuffer: 10 * 1024 * 1024, timeout: 20000 },
      (err, stdout) => {
        if (err) return reject(err);
        try { resolve(JSON.parse(stdout).streams || []); } catch (e) { reject(e); }
      }
    );
  });
}

// Retorna true se o vídeo precisa ser convertido (codec de vídeo e/ou
// áudio fora da lista "todo navegador entende"). Em caso de dúvida (não
// deu pra inspecionar o arquivo — corrompido, formato exótico demais nem
// pro ffprobe) assume que precisa converter: melhor gastar um pouco de
// CPU tentando do que arriscar servir algo que não vai tocar.
async function needsVideoTranscode(filePath) {
  try {
    const streams = await ffprobeStreams(filePath);
    const video = streams.find(s => s.codec_type === 'video');
    const audio = streams.find(s => s.codec_type === 'audio');
    if (!video) return true; // nem stream de vídeo o ffprobe achou — algo está errado
    const videoOk = OK_VIDEO_CODECS.has(video.codec_name);
    const audioOk = !audio || OK_AUDIO_CODECS.has(audio.codec_name);
    return !(videoOk && audioOk);
  } catch (_) {
    return true;
  }
}

// Converte pra H.264 (vídeo) + AAC (áudio) dentro de um .mp4 com
// "faststart" (o índice do arquivo fica no começo — o navegador consegue
// começar a tocar sem esperar o download inteiro). O filtro de escala
// limita o lado MAIOR do vídeo a 1920px (mantendo a proporção, funciona
// pra vídeo vertical ou horizontal) só pra vídeos 4K não pesarem demais
// no processamento do plano gratuito do Render — a maioria dos vídeos de
// celular já nasce abaixo disso, então na prática quase nunca reduz nada.
// "veryfast" prioriza velocidade de conversão sobre compressão máxima:
// mais importante o upload não demorar muito do que o arquivo ficar 5%
// menor.
function transcodeVideoToH264(inputPath, outputPath) {
  return new Promise((resolve, reject) => {
    const args = [
      '-y', '-i', inputPath,
      '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '23',
      '-pix_fmt', 'yuv420p',
      '-vf', "scale=w='if(gt(iw,ih),min(1920,iw),-2)':h='if(gt(iw,ih),-2,min(1920,ih))'",
      '-movflags', '+faststart',
      '-c:a', 'aac', '-b:a', '128k',
      outputPath,
    ];
    execFile(ffmpegPath, args, { maxBuffer: 10 * 1024 * 1024, timeout: 180000 }, (err) => {
      if (err) return reject(err);
      resolve();
    });
  });
}

// HEIC/HEIF -> JPEG. heic-convert é puro JS/WASM (sem precisar compilar
// nada nativo no build do Render, diferente de outras libs de imagem com
// suporte a HEIC).
async function convertHeicToJpeg(inputPath, outputPath) {
  const inputBuffer = fs.readFileSync(inputPath);
  const outputBuffer = await heicConvert({ buffer: inputBuffer, format: 'JPEG', quality: 0.86 });
  fs.writeFileSync(outputPath, outputBuffer);
}

function publicRow(row) {
  return {
    id: row.id,
    name: row.original_name,
    mime: row.mime_type,
    size: Number(row.size_bytes),
    url: row.url,
    createdAt: row.created_at,
    ownerId: row.user_id
  };
}

router.get('/library', requireAuth, async (req, res) => {
  try {
    const rows = db.prepare(`SELECT * FROM media_files WHERE user_id = ? ORDER BY id DESC LIMIT 200`).all(req.session.userId);

    res.json({
      media: rows.map(publicRow)
    });
  } catch (err) {
    console.error('Erro ao carregar biblioteca:', err);
    res.status(500).json({
      error: 'Não foi possível carregar a biblioteca.'
    });
  }
});

router.post('/upload', requireAuth, async (req, res) => {
  const mime = String(
    req.headers['content-type'] || 'application/octet-stream'
  )
    .split(';')[0]
    .trim()
    .toLowerCase();

  let rawName = String(req.headers['x-file-name'] || 'arquivo');

  try {
    rawName = decodeURIComponent(rawName);
  } catch (_) {}

  const name = safeName(rawName);
  const sizeHeader = Number(req.headers['content-length'] || 0);

  try {
    const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.session.userId);

    if (!user) {
      return res.status(401).json({
        error: 'Não autenticado.'
      });
    }

    if (sizeHeader > MAX_BYTES) {
      return res.status(413).json({
        error: 'O arquivo excede o limite de 50 MB.'
      });
    }

    if (!ALLOWED.has(mime)) {
      return res.status(415).json({
        error: 'Tipo de arquivo não suportado.'
      });
    }

    const ext = SAFE_EXTENSION_BY_MIME[mime] || '.bin';

    const filename =
      `${Date.now()}-${crypto.randomBytes(10).toString('hex')}${ext}`;

    const dest = path.join(UPLOAD_DIR, filename);

    const stream = fs.createWriteStream(dest, {
      flags: 'wx'
    });

    let bytes = 0;
    let aborted = false;
    let responded = false;

    req.on('data', chunk => {
      bytes += chunk.length;

      if (bytes > MAX_BYTES && !aborted) {
        aborted = true;

        req.destroy(new Error('Arquivo muito grande'));
        stream.destroy();

        try {
          fs.unlinkSync(dest);
        } catch (_) {}
      }
    });

    req.on('aborted', () => {
      aborted = true;

      stream.destroy();

      try {
        fs.unlinkSync(dest);
      } catch (_) {}
    });

    stream.on('error', err => {
      if (responded) return;

      responded = true;

      console.error('Erro no upload:', err);

      if (!res.headersSent) {
        res.status(500).json({
          error: aborted
            ? 'Upload interrompido.'
            : 'Não foi possível salvar o arquivo.'
        });
      }
    });

    stream.on('finish', async () => {
      if (aborted || responded) return;

      // Declarados fora do try pra o catch conseguir limpar o arquivo
      // certo mesmo se o erro acontecer DEPOIS de uma conversão (nesse
      // caso "dest", o arquivo bruto original, já não existe mais —
      // quem sobrou é finalPath).
      let finalPath = dest;
      let finalFilename = filename;

      try {
        const rawStat = fs.statSync(dest);

        if (rawStat.size > MAX_BYTES) {
          try {
            fs.unlinkSync(dest);
          } catch (_) {}

          responded = true;

          return res.status(413).json({
            error: 'O arquivo excede o limite de 50 MB.'
          });
        }

        // Normaliza formato "eficiente" (HEIC/HEVC) pra algo que todo
        // navegador abre — ver o bloco grande de comentário perto de
        // OK_VIDEO_CODECS/convertHeicToJpeg mais acima. finalPath/mime/
        // filename só mudam de valor quando a conversão realmente
        // acontece (e SÓ se ela der certo); se falhar, segue com o
        // arquivo original — melhor a pessoa conseguir baixar o arquivo
        // do que o upload inteiro falhar por causa da conversão.
        let finalMime = mime;

        if (mime === 'image/heic' || mime === 'image/heif') {
          const jpgPath = dest.replace(/\.[^.]+$/, '.jpg');
          try {
            await convertHeicToJpeg(dest, jpgPath);
            fs.unlinkSync(dest);
            finalPath = jpgPath;
            finalMime = 'image/jpeg';
            finalFilename = filename.replace(/\.[^.]+$/, '.jpg');
          } catch (convErr) {
            console.error('Falha ao converter HEIC/HEIF, mantendo arquivo original:', convErr);
          }
        } else if (mime.startsWith('video/')) {
          try {
            if (await needsVideoTranscode(dest)) {
              const tmpMp4Path = dest.replace(/\.[^.]+$/, '.transcode-tmp.mp4');
              await transcodeVideoToH264(dest, tmpMp4Path);
              const finishedMp4Path = dest.replace(/\.[^.]+$/, '.mp4');
              fs.unlinkSync(dest);
              if (tmpMp4Path !== finishedMp4Path) fs.renameSync(tmpMp4Path, finishedMp4Path);
              finalPath = finishedMp4Path;
              finalMime = 'video/mp4';
              finalFilename = filename.replace(/\.[^.]+$/, '.mp4');
            }
          } catch (transErr) {
            console.error('Falha ao converter vídeo, mantendo arquivo original:', transErr);
          }
        }

        const stat = fs.statSync(finalPath);
        const url = `/uploads/${encodeURIComponent(finalFilename)}`;

        const info = db.prepare(`INSERT INTO media_files
           (user_id, original_name, stored_name, mime_type, size_bytes, url)
           VALUES (?, ?, ?, ?, ?, ?)`).run(
          req.session.userId, name, finalFilename, finalMime, stat.size, url
        );
        const row = db.prepare('SELECT * FROM media_files WHERE id = ?').get(info.lastInsertRowid);

        responded = true;

        res.json({
          ok: true,
          media: publicRow(row)
        });
      } catch (err) {
        console.error('Erro ao registrar mídia no SQLite:', err);

        // Limpa tanto o arquivo bruto original quanto o convertido (podem
        // ser dois arquivos diferentes se o erro aconteceu DEPOIS de uma
        // conversão bem-sucedida — ex.: o INSERT no banco falhou depois
        // do HEIC já ter virado JPEG).
        try {
          fs.unlinkSync(dest);
        } catch (_) {}

        if (finalPath !== dest) {
          try {
            fs.unlinkSync(finalPath);
          } catch (_) {}
        }

        if (!responded && !res.headersSent) {
          responded = true;

          res.status(500).json({
            error: 'Não foi possível registrar o arquivo.'
          });
        }
      }
    });

    req.pipe(stream);
  } catch (err) {
    console.error('Erro no upload:', err);

    if (!res.headersSent) {
      res.status(500).json({
        error: 'Erro interno durante o upload.'
      });
    }
  }
});

module.exports = router;
