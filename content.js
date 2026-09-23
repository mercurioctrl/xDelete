/* Vaciar cuenta de X — content script.
   Se re-inyecta en cada carga de página, así que puede recargar el timeline
   cuando se agota y seguir donde quedó. Eso es lo que un script de consola
   no puede hacer: una recarga lo mata. */

const CFG = {
  CONCURRENCIA: 6,
  RESERVA_CREDITO: 5,      // crédito que dejamos sin tocar en cada ventana
  OBJETIVO_TANDA: 200,
  SCROLLS_MAX: 30,
  SECAS_ANTES_DE_RECARGAR: 6,
  RECARGAS_SIN_MATERIAL_PARA_AVISAR: 3,   // con crédito de sobra, esto huele a pestaña congelada
  RECARGAS_VACIAS_PARA_TERMINAR: 3,
  BEARER: 'Bearer AAAAAAAAAAAAAAAAAAAAANRILgAAAAAAnNwIzUejRCOuH5E6I8xnZz4puTs%3D1Zv7ttfk8LF81IUq16cHjhLTvJu4FA33AGWWjCpTnA',
  QUERY_ID_RESPALDO: { DeleteTweet: 'nxpZCY2K-I6QoFHAHeojFQ' },
};

const dormir = (ms) => new Promise((r) => setTimeout(r, ms));
const ct0 = () => document.cookie.match('(^|;)\\s*ct0=([^;]*)')?.[2];
const leer = (k) => new Promise((r) => chrome.storage.local.get(k, (v) => r(v[k])));
const escribir = (obj) => new Promise((r) => chrome.storage.local.set(obj, r));

// ---------- endpoints ----------
async function hallarOps() {
  const ops = {};
  const urls = [...new Set(
    [...document.querySelectorAll('script[src]')].map((s) => s.src).filter((u) => u.includes('twimg.com'))
  )];
  for (const url of urls) {
    try {
      const src = await (await fetch(url)).text();
      for (const op of ['DeleteTweet', 'DeleteRetweet']) {
        if (ops[op]) continue;
        const m = src.match(new RegExp('queryId:"([^"]+)",operationName:"' + op + '"'))
               ?? src.match(new RegExp('operationName:"' + op + '",queryId:"([^"]+)"'));
        if (m) ops[op] = m[1];
      }
    } catch {}
  }
  return { ...CFG.QUERY_ID_RESPALDO, ...ops };
}

// ---------- recolección ----------
function cosechar(usuario, hechos, destino, estado) {
  const enReposts = location.pathname.endsWith('/reposts');
  for (const art of document.querySelectorAll('article')) {
    const t = art.querySelector('time[datetime]');
    const a = t?.closest('a[href*="/status/"]') ?? art.querySelector('a[href*="/status/"]');
    const href = a?.getAttribute('href') ?? '';
    const id = href.match(/\/status\/(\d+)/)?.[1];
    if (!id || hechos.has(id) || destino.has(id)) continue;
    const autor = href.match(/^\/([^/]+)\/status\//)?.[1] ?? '';
    const ctx = art.querySelector('[data-testid="socialContext"]')?.textContent ?? '';
    const esRepost = enReposts || /reposte|retwit|repost/i.test(ctx);
    // Nunca tocamos tuits ajenos.
    if (!esRepost && autor.toLowerCase() !== usuario.toLowerCase()) continue;
    destino.set(id, esRepost);
    if (t) estado.masViejo = t.getAttribute('datetime')?.slice(0, 10);
  }
  return destino.size;
}

async function juntar(usuario, hechos, estado) {
  const lote = new Map();
  let secas = 0;
  cosechar(usuario, hechos, lote, estado);
  for (let i = 0; i < CFG.SCROLLS_MAX && secas < CFG.SECAS_ANTES_DE_RECARGAR; i++) {
    if (lote.size >= CFG.OBJETIVO_TANDA) break;
    window.scrollTo(0, document.body.scrollHeight);
    await dormir(1100);
    const antes = lote.size;
    cosechar(usuario, hechos, lote, estado);
    secas = lote.size === antes ? secas + 1 : 0;
  }
  return lote;
}

// ---------- borrado ----------
async function borrar(id, esRepost, ops, estado) {
  const op = esRepost && ops.DeleteRetweet ? 'DeleteRetweet' : 'DeleteTweet';
  const variables = op === 'DeleteRetweet'
    ? { source_tweet_id: id, dark_request: false }
    : { tweet_id: id, dark_request: false };
  let r;
  try {
    r = await fetch('https://x.com/i/api/graphql/' + ops[op] + '/' + op, {
      method: 'POST', credentials: 'include',
      headers: {
        authorization: CFG.BEARER, 'content-type': 'application/json', 'x-csrf-token': ct0(),
        'x-twitter-auth-type': 'OAuth2Session', 'x-twitter-active-user': 'yes',
      },
      body: JSON.stringify({ variables, queryId: ops[op] }),
    });
  } catch { return { ok: false }; }

  const cred = Number(r.headers.get('x-rate-limit-remaining'));
  const rst = Number(r.headers.get('x-rate-limit-reset'));
  if (!Number.isNaN(cred) && op === 'DeleteTweet') {
    estado.credito = cred;
    estado.resetSeg = Math.max(0, Math.round(rst - Date.now() / 1000));
  }
  if (r.status === 429) return { ok: false, limite: true };

  const j = await r.json().catch(() => null);
  const ok = Boolean(j?.data?.delete_tweet || j?.data?.unretweet);
  const msg = (j?.errors ?? []).map((e) => e.message ?? '').join('; ');
  const ausente = /not found|does not exist|no existe|authorized/i.test(msg) || r.status === 404;
  return { ok: ok || ausente };
}

async function esperarReset(estado, sigueActivo) {
  const seg = (estado.resetSeg ?? 900) + 5;
  const hasta = Date.now() + seg * 1000;
  while (Date.now() < hasta && await sigueActivo()) {
    await dormir(5000);
    estado.resetSeg = Math.max(0, Math.round((hasta - Date.now()) / 1000));
    await escribir({ estado });
  }
  estado.credito = null;
}

// Avisa sólo cuando hay crédito para borrar pero no aparece material: eso no es
// la espera normal del rate limit, es la pestaña congelada por estar de fondo.
function avisarTrabada(estado) {
  if (!chrome.notifications) return;
  chrome.notifications.create('trabada', {
    type: 'basic',
    iconUrl: 'data:image/svg+xml;base64,' + btoa('<svg xmlns="http://www.w3.org/2000/svg" width="128" height="128"><rect width="128" height="128" fill="#1d9bf0"/><text x="64" y="86" font-size="72" text-anchor="middle" fill="#fff">X</text></svg>'),
    title: 'Borrado frenado',
    message: 'Hay ' + (estado.credito ?? '?') + ' de cupo sin usar pero no encuentro tuits. '
           + 'Poné la ventana del perfil al frente (no minimizada).',
    priority: 2,
  });
}

// ---------- ciclo ----------
(async function principal() {
  const usuario = location.pathname.split('/')[1];
  if (!usuario) return;

  const cfg = (await leer('config')) ?? {};
  if (!cfg.activo || cfg.usuario?.toLowerCase() !== usuario.toLowerCase()) return;

  const sigueActivo = async () => Boolean((await leer('config'))?.activo);

  const hechos = new Set((await leer('hechos')) ?? []);
  const estado = (await leer('estado')) ?? {
    posts: 0, reposts: 0, fallos: 0, recargas: 0, recargasVacias: 0,
    credito: null, resetSeg: null, masViejo: null, terminado: false, inicio: Date.now(),
  };
  if (estado.terminado) return;

  const ops = await hallarOps();
  estado.pestana = location.pathname;
  await escribir({ estado });

  const lote = await juntar(usuario, hechos, estado);

  if (lote.size === 0) {
    // Nada visible acá. Probamos la pestaña siguiente; si ya dimos la vuelta,
    // recargamos, que es lo único que destraba el timeline cacheado de X.
    const rutas = ['/' + usuario, '/' + usuario + '/with_replies', '/' + usuario + '/reposts'];
    const i = rutas.indexOf(location.pathname);
    const proxima = rutas[(i + 1) % rutas.length];

    estado.recargasVacias++;

    // Crédito de sobra y cero material: no es el rate limit, es que no puede leer.
    const conCredito = estado.credito === null || estado.credito > 20;
    if (conCredito && estado.recargasVacias === CFG.RECARGAS_SIN_MATERIAL_PARA_AVISAR) {
      avisarTrabada(estado);
    }

    if (estado.recargasVacias >= CFG.RECARGAS_VACIAS_PARA_TERMINAR * rutas.length) {
      estado.terminado = true;
      await escribir({ estado, config: { ...cfg, activo: false } });
      return;
    }
    await escribir({ estado });
    await dormir(1500);
    location.href = 'https://x.com' + proxima;
    return;
  }

  estado.recargasVacias = 0;
  const entradas = [...lote.entries()];

  for (let k = 0; k < entradas.length; k += CFG.CONCURRENCIA) {
    if (!await sigueActivo()) return;

    if (estado.credito !== null && estado.credito <= CFG.RESERVA_CREDITO) {
      await esperarReset(estado, sigueActivo);
      if (!await sigueActivo()) return;
    }

    const grupo = entradas.slice(k, k + CFG.CONCURRENCIA);
    const salidas = await Promise.all(grupo.map(([id, rt]) => borrar(id, rt, ops, estado)));
    salidas.forEach((s, n) => {
      const [id, esRepost] = grupo[n];
      if (s.ok) { hechos.add(id); esRepost ? estado.reposts++ : estado.posts++; }
      else if (!s.limite) estado.fallos++;
    });
    await escribir({ hechos: [...hechos], estado });
  }

  // Tanda lista: recargamos para que X sirva timeline fresco. Al volver a cargar,
  // este mismo script se inyecta solo y sigue.
  estado.recargas++;
  await escribir({ estado });
  await dormir(1500);
  location.reload();
})();
