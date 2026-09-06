// Compressão HTTP (gzip/deflate/brotli) sem depender de pacotes externos.
// Usa apenas o módulo nativo "zlib" do Node — não requer `npm install`.
//
// Por quê: HTML/CSS/JS são texto e comprimem MUITO bem (70-85% menores).
// Isso reduz o tráfego de dados no celular (rede móvel/wifi fraco) e
// acelera o primeiro carregamento do app, sem tocar em nada visual.

const zlib = require('zlib');

const COMPRESSIBLE_TYPE = /json|text|javascript|css|xml|svg|font|wasm/i;
const MIN_BYTES_TO_COMPRESS = 512; // corpos minúsculos não valem a pena comprimir

function pickEncoding(acceptEncoding) {
  const ae = acceptEncoding || '';
  if (typeof zlib.createBrotliCompress === 'function' && /\bbr\b/.test(ae)) return 'br';
  if (/\bgzip\b/.test(ae)) return 'gzip';
  if (/\bdeflate\b/.test(ae)) return 'deflate';
  return null;
}

function createCompressStream(encoding) {
  if (encoding === 'br') {
    return zlib.createBrotliCompress({
      params: {
        [zlib.constants.BROTLI_PARAM_QUALITY]: 5, // equilíbrio entre CPU e taxa de compressão
      },
    });
  }
  if (encoding === 'gzip') return zlib.createGzip({ level: 6 });
  return zlib.createDeflate({ level: 6 });
}

module.exports = function compression() {
  return function compressionMiddleware(req, res, next) {
    // Nunca falha a requisição por causa de compressão: qualquer problema
    // aqui simplesmente cai para a resposta normal, sem compressão.
    try {
      if (req.method === 'HEAD') return next();

      const encoding = pickEncoding(req.headers['accept-encoding']);
      if (!encoding) return next();

      const originalWrite = res.write.bind(res);
      const originalEnd = res.end.bind(res);

      let stream = null;
      let bypass = false;
      let decided = false;
      let buffered = [];

      function shouldBypass() {
        if (res.getHeader('Content-Encoding')) return true;
        if (res.statusCode === 204 || res.statusCode === 304) return true;
        const type = String(res.getHeader('Content-Type') || '');
        if (type && !COMPRESSIBLE_TYPE.test(type)) return true;
        return false;
      }

      function decide(finalSize) {
        if (decided) return;
        decided = true;
        if (typeof finalSize === 'number' && finalSize < MIN_BYTES_TO_COMPRESS) {
          bypass = true;
          return;
        }
        if (shouldBypass()) {
          bypass = true;
          return;
        }
        res.removeHeader('Content-Length');
        res.setHeader('Content-Encoding', encoding);
        const vary = res.getHeader('Vary');
        if (!vary) res.setHeader('Vary', 'Accept-Encoding');
        else if (!String(vary).includes('Accept-Encoding')) res.setHeader('Vary', vary + ', Accept-Encoding');

        stream = createCompressStream(encoding);
        stream.on('data', (chunk) => originalWrite(chunk));
        stream.on('error', () => {
          // se o zlib falhar no meio do caminho, apenas encerra a resposta
          try { originalEnd(); } catch (_) { /* noop */ }
        });
        stream.on('end', () => originalEnd());

        if (buffered.length) {
          const total = Buffer.concat(buffered);
          buffered = [];
          if (total.length) stream.write(total);
        }
      }

      res.write = function (chunk, encodingArg, callback) {
        if (chunk == null) return true;
        const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk, typeof encodingArg === 'string' ? encodingArg : undefined);
        if (!decided) {
          buffered.push(buf);
          // só decide de fato quando soubermos que vale a pena (tamanho mínimo)
          const total = buffered.reduce((n, b) => n + b.length, 0);
          if (total >= MIN_BYTES_TO_COMPRESS) decide();
          return true;
        }
        if (bypass) return originalWrite(buf);
        stream.write(buf);
        return true;
      };

      res.end = function (chunk, encodingArg, callback) {
        if (chunk != null) {
          const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk, typeof encodingArg === 'string' ? encodingArg : undefined);
          buffered.push(buf);
        }
        const finalSize = decided ? undefined : buffered.reduce((n, b) => n + b.length, 0);
        decide(finalSize);
        if (bypass) {
          const total = buffered.length ? Buffer.concat(buffered) : undefined;
          buffered = [];
          return originalEnd(total);
        }
        if (buffered.length) {
          const total = Buffer.concat(buffered);
          buffered = [];
          if (total.length) stream.write(total);
        }
        stream.end();
      };

      next();
    } catch (err) {
      next();
    }
  };
};
