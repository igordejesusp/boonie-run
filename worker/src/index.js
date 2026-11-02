// Servidor do Competitivo do Boonie Run (Cloudflare Worker + KV).
// Cada app publica o resumo das próprias corridas; qualquer app lê o de todos.
// A chave do Intervals só serve para provar que o atleta é quem diz ser: é conferida no Intervals e descartada, nunca é gravada.

const ORIGENS = ['https://igordejesusp.github.io', 'http://localhost:8768'];
const LIMITE = 400_000; // tamanho máximo do resumo de um atleta (bytes)

const cors = (req) => {
  const o = req.headers.get('Origin') || '';
  return {
    'Access-Control-Allow-Origin': ORIGENS.includes(o) ? o : ORIGENS[0],
    'Access-Control-Allow-Methods': 'GET,POST,DELETE,OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Vary': 'Origin',
  };
};
const json = (req, obj, status = 200, extra = {}) =>
  new Response(JSON.stringify(obj), { status, headers: { 'Content-Type': 'application/json', ...cors(req), ...extra } });

// confere no Intervals se a chave pertence ao atleta
async function confere(athlete, key) {
  if (!/^i\d{1,12}$/.test(athlete || '') || !key) return null;
  const r = await fetch(`https://intervals.icu/api/v1/athlete/${athlete}`, {
    headers: { Authorization: 'Basic ' + btoa('API_KEY:' + key) },
  });
  if (!r.ok) return null;
  const a = await r.json();
  return a && a.id === athlete ? a : null;
}

async function todos(env) {
  const out = [];
  let cursor;
  do {
    const l = await env.BR.list({ prefix: 'a:', cursor });
    const vals = await Promise.all(l.keys.map((k) => env.BR.get(k.name, 'json')));
    vals.forEach((v) => v && out.push(v));
    cursor = l.list_complete ? null : l.cursor;
  } while (cursor);
  return out;
}

export default {
  async fetch(req, env) {
    const url = new URL(req.url);
    if (req.method === 'OPTIONS') return new Response(null, { headers: cors(req) });

    if (req.method === 'GET' && url.pathname === '/all') {
      return json(req, await todos(env), 200, { 'Cache-Control': 'public, max-age=60' });
    }

    if ((req.method === 'POST' && url.pathname === '/publish') || (req.method === 'DELETE' && url.pathname === '/me')) {
      const txt = await req.text();
      if (txt.length > LIMITE) return json(req, { erro: 'resumo grande demais' }, 413);
      let b;
      try { b = JSON.parse(txt); } catch (e) { return json(req, { erro: 'json inválido' }, 400); }
      const a = await confere(b.athlete, b.key);
      if (!a) return json(req, { erro: 'chave não confere com o atleta' }, 403);

      if (req.method === 'DELETE') {
        await env.BR.delete('a:' + b.athlete);
        return json(req, { ok: true });
      }
      const runs = Array.isArray(b.runs) ? b.runs.slice(0, 200) : [];
      const reg = { id: b.athlete, name: a.name || b.athlete, pic: a.profile_medium || '', sex: a.sex || '', runs, at: Date.now() };
      await env.BR.put('a:' + b.athlete, JSON.stringify(reg));
      return json(req, { ok: true, runs: runs.length });
    }

    return json(req, { app: 'Boonie Run', rotas: ['GET /all', 'POST /publish', 'DELETE /me'] });
  },
};
