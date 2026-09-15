// Cliente REST + armazenamento da sessão
const TOKEN_KEY = 'meialua.token';

export function getToken() {
  try { return localStorage.getItem(TOKEN_KEY); } catch { return null; }
}
export function setToken(t) {
  try { if (t) localStorage.setItem(TOKEN_KEY, t); else localStorage.removeItem(TOKEN_KEY); } catch { /* sem storage */ }
  memToken = t;
}
let memToken = getToken();

// Prefixo /api/meia-lua: o jogo roda embutido dentro do WifiCord, num
// mesmo servidor Express que também serve /api/auth, /api/friends etc.
// (ver server/routes/meiaLua.js e server/integration.js no WifiCord).
export async function api(path, body, method) {
  const res = await fetch(`/api/meia-lua${path}`, {
    method: method || (body ? 'POST' : 'GET'),
    headers: { 'content-type': 'application/json', ...(memToken ? { authorization: `Bearer ${memToken}` } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  let data = {};
  try { data = await res.json(); } catch { /* vazio */ }
  if (!res.ok) {
    const err = new Error(data.error || `Erro ${res.status}`);
    err.status = res.status;
    throw err;
  }
  return data;
}
export const token = () => memToken;
