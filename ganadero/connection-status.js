// Estado real de sincronización de Supabase y de la cola offline.
(function () {
  let estado = { clave:'unreachable', texto:'No sincronizado' };
  let ultimaConsulta = 0;
  let consultaActiva = null;
  let intervaloIniciado = false;

  function pintar() {
    document.querySelectorAll('[data-db-connection]').forEach((el) => {
      el.dataset.state = estado.clave;
      const etiqueta = el.querySelector('[data-db-label]');
      if (etiqueta) etiqueta.textContent = estado.texto;
      el.setAttribute('aria-label', estado.texto);
    });
  }

  function cambiar(clave, texto) {
    estado = { clave, texto };
    pintar();
  }

  function clienteSupabase() {
    if (typeof supabaseClient !== 'undefined') return supabaseClient;
    return window.supabaseClient || null;
  }

  async function comprobar(forzar) {
    if (!navigator.onLine) {
      cambiar('offline', 'No sincronizado');
      return;
    }
    if (consultaActiva) return consultaActiva;
    if (!forzar && Date.now() - ultimaConsulta < 30000) { pintar(); return; }

    const sesion = window.mockApi?.sesionActual?.();
    const cliente = clienteSupabase();
    if (!sesion?.id) {
      cambiar('unreachable', 'No sincronizado');
      return;
    }
    if (!cliente) {
      cambiar('unreachable', 'No sincronizado');
      return;
    }

    ultimaConsulta = Date.now();
    cambiar('unreachable', 'No sincronizado');
    const consulta = cliente.from('perfiles').select('id').eq('id', sesion.id).maybeSingle();
    consultaActiva = new Promise((resolve, reject) => {
      const temporizador = setTimeout(() => reject(new Error('Tiempo de espera agotado')), 8000);
      consulta.then((resultado) => { clearTimeout(temporizador); resolve(resultado); }, (error) => { clearTimeout(temporizador); reject(error); });
    }).then(async (resultado) => {
      if (resultado.error || !resultado.data) throw (resultado.error || new Error('Perfil no disponible'));
      const [pendientes, fallos] = await Promise.all([
        window.mockApi.contarPendientesSincronizar(),
        window.mockApi.listarFallosSincronizacion(),
      ]);
      cambiar(pendientes === 0 && fallos.length === 0 ? 'connected' : 'unreachable',
        pendientes === 0 && fallos.length === 0 ? 'Sincronizado' : 'No sincronizado');
    }).catch(() => {
      cambiar('unreachable', 'No sincronizado');
    }).finally(() => { consultaActiva = null; });
    return consultaActiva;
  }

  function bind(app) {
    if (!app.querySelector('[data-db-connection]')) return;
    pintar();
    if (!intervaloIniciado) {
      intervaloIniciado = true;
      window.addEventListener('offline', () => cambiar('offline', 'No sincronizado'));
      window.addEventListener('online', () => { ultimaConsulta = 0; comprobar(true); });
      window.addEventListener('ganado-cola-cambio', () => { ultimaConsulta = 0; comprobar(true); });
      window.setInterval(() => comprobar(true), 20000);
    }
    comprobar(false);
  }

  function markup() {
    return '<div class="db-connection" data-db-connection data-state="unreachable" role="status" aria-live="polite" aria-label="No sincronizado"><span class="db-connection-dot" aria-hidden="true"></span><span data-db-label>No sincronizado</span></div>';
  }

  window.GanaIDConnectionStatus = { markup, bind };
})();
