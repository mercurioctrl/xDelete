const $ = (id) => document.getElementById(id);

function pintar({ config = {}, estado = {} }) {
  const activo = Boolean(config.activo);
  $('arrancar').style.display = activo ? 'none' : 'block';
  $('parar').style.display = activo ? 'block' : 'none';
  $('usuario').disabled = activo;
  if (config.usuario) $('usuario').value = config.usuario;

  $('posts').textContent = estado.posts ?? 0;
  $('reposts').textContent = estado.reposts ?? 0;
  $('fallos').textContent = estado.fallos ?? 0;
  $('recargas').textContent = estado.recargas ?? 0;
  $('masViejo').textContent = estado.masViejo ?? '—';
  $('credito').textContent = estado.credito === null || estado.credito === undefined
    ? '—'
    : estado.credito + (estado.resetSeg ? ' · ' + Math.ceil(estado.resetSeg / 60) + 'm' : '');

  $('aviso').textContent = estado.terminado
    ? 'Terminado: el timeline no devolvió más material.'
    : activo
      ? 'Corriendo. Dejá la pestaña del perfil abierta y adelante.'
      : 'Abrí tu perfil en x.com antes de empezar.';
}

const refrescar = () => chrome.storage.local.get(['config', 'estado'], pintar);

$('arrancar').addEventListener('click', async () => {
  const usuario = $('usuario').value.trim().replace(/^@/, '');
  if (!usuario) { $('usuario').focus(); return; }
  await chrome.storage.local.set({
    config: { activo: true, usuario },
    estado: { posts: 0, reposts: 0, fallos: 0, recargas: 0, recargasVacias: 0,
              credito: null, resetSeg: null, masViejo: null, terminado: false, inicio: Date.now() },
  });
  refrescar();
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (tab?.url?.includes('x.com')) chrome.tabs.reload(tab.id);
});

$('parar').addEventListener('click', async () => {
  const { config = {} } = await chrome.storage.local.get('config');
  await chrome.storage.local.set({ config: { ...config, activo: false } });
  refrescar();
});

refrescar();
setInterval(refrescar, 1500);
