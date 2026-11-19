// Tienda local Gana ID: catálogo, carrito y pedidos pendientes en este dispositivo.
(function () {
  const PRODUCTOS = window.GANAID_TIENDA_PRODUCTOS || [];
  const WHATSAPP_NUMBER = '529999069163'; // México (+52) + 9999069163 indicado por el usuario.
  const MONEDA = new Intl.NumberFormat('es-MX', { style:'currency', currency:'MXN', maximumFractionDigits:0 });
  let categoriaActiva = 'Todos';
  let busqueda = '';

  function usuarioId() { return window.mockApi?.sesionActual?.()?.id || 'local'; }
  function clave(tipo) { return `ganaid_tienda_v1:${tipo}:${usuarioId()}`; }
  function leer(tipo) {
    try { const valor = JSON.parse(localStorage.getItem(clave(tipo)) || '[]'); return Array.isArray(valor) ? valor : []; }
    catch (_) { return []; }
  }
  function guardar(tipo, datos) {
    try { localStorage.setItem(clave(tipo), JSON.stringify(datos)); return true; }
    catch (_) { avisar('No hay espacio disponible para guardar en este dispositivo.', '⚠️'); return false; }
  }
  function escapar(valor) {
    return String(valor ?? '').replace(/[&<>"']/g, (c) => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' })[c]);
  }
  function avisar(mensaje, icono) { if (typeof window.toast === 'function') window.toast(mensaje, icono || '🛒'); }
  function producto(sku) { return PRODUCTOS.find((item) => item.sku === sku); }
  function carritoActual() { return leer('carrito').filter((linea) => producto(linea.sku) && Number(linea.cantidad) > 0); }
  function pedidosPendientes() { return leer('pedidos').filter((pedido) => pedido && pedido.estado !== 'confirmado' && pedido.estado !== 'cancelado'); }

  function totalPiezas() {
    const enCarrito = carritoActual().reduce((n, l) => n + Number(l.cantidad), 0);
    const enPendientes = pedidosPendientes().reduce((n, p) => n + p.items.reduce((s, i) => s + i.cantidad, 0), 0);
    return enCarrito + enPendientes;
  }

  function cartButtonMarkup() {
    const n = totalPiezas();
    if (n <= 0) return '';
    const badge = n > 99 ? '99+' : String(n);
    return `<button class="tienda-header-carrito" type="button" data-tienda-abrir-carrito aria-label="Ver mi pedido" title="Mi pedido"><span aria-hidden="true">🛒</span><b class="tienda-header-carrito-badge">${badge}</b></button>`;
  }

  function actualizarHeader() {
    const boton = document.querySelector('[data-tienda-abrir-carrito]');
    const n = totalPiezas();
    if (n <= 0) { boton?.remove(); return; }
    if (!boton) { if (typeof window.renderApp === 'function') window.renderApp(); return; }
    let badge = boton.querySelector('.tienda-header-carrito-badge');
    if (!badge) {
      badge = document.createElement('b');
      badge.className = 'tienda-header-carrito-badge';
      boton.appendChild(badge);
    }
    badge.textContent = n > 99 ? '99+' : String(n);
  }

  function productosFiltrados() {
    const termino = busqueda.trim().toLocaleLowerCase('es-MX');
    return PRODUCTOS.filter((item) => {
      const texto = `${item.nombre} ${item.sku} ${item.categoria}`.toLocaleLowerCase('es-MX');
      return (categoriaActiva === 'Todos' || item.categoria === categoriaActiva) && (!termino || texto.includes(termino));
    });
  }

  function htmlProductos(lista) {
    if (!lista.length) return '<div class="tienda-vacio">No encontramos productos.</div>';
    return lista.map((item) => `
      <article class="tienda-producto">
        <div class="tienda-producto-imagen"><img src="${escapar(item.imagen)}" alt="${escapar(item.nombre)}" loading="lazy" decoding="async"></div>
        <div class="tienda-producto-categoria">${escapar(item.categoria)}</div>
        <h3>${escapar(item.nombre)}</h3>
        <div class="tienda-producto-pie"><div><span class="tienda-sku">${escapar(item.sku)}</span><strong>${MONEDA.format(item.precio)}</strong><small>por pieza · MXN</small></div>
          <button class="btn btn-primary tienda-agregar" type="button" data-tienda-agregar="${escapar(item.sku)}" aria-label="Agregar ${escapar(item.nombre)} al pedido">Agregar <span aria-hidden="true">＋</span></button></div>
      </article>`).join('');
  }

  function htmlCarrito(carrito) {
    return carrito.map((linea) => {
      const item = producto(linea.sku), cantidad = Number(linea.cantidad);
      return `<div class="tienda-linea">
        <div class="tienda-linea-info"><b>${escapar(item.nombre)}</b><span>${escapar(item.sku)} · ${MONEDA.format(item.precio)} c/u</span></div>
        <div class="tienda-cantidad"><button type="button" data-tienda-cantidad="menos" data-sku="${escapar(item.sku)}" aria-label="Quitar una unidad">−</button><span>${cantidad}</span><button type="button" data-tienda-cantidad="mas" data-sku="${escapar(item.sku)}" aria-label="Agregar una unidad">＋</button></div>
        <strong class="tienda-subtotal">${MONEDA.format(item.precio * cantidad)}</strong><button class="tienda-quitar" type="button" data-tienda-quitar="${escapar(item.sku)}">Quitar</button>
      </div>`;
    }).join('');
  }

  function render() {
    const categorias = ['Todos', ...new Set(PRODUCTOS.map((item) => item.categoria))];
    return `<main class="tienda-screen">
      <section class="tienda-catalogo">
        <div class="tienda-seccion-heading"><div><h2 id="tienda-titulo-catalogo">Catálogo</h2></div><span class="tienda-total-productos">${PRODUCTOS.length} artículos</span></div>
        <label class="tienda-busqueda"><span aria-hidden="true">⌕</span><input type="search" id="tienda-buscar" placeholder="Buscar producto o SKU" value="${escapar(busqueda)}" autocomplete="off"></label>
        <div class="tienda-categorias" role="group" aria-label="Filtrar productos">${categorias.map((cat) => `<button type="button" class="tienda-filtro ${categoriaActiva === cat ? 'activo' : ''}" data-tienda-categoria="${escapar(cat)}">${escapar(cat)}</button>`).join('')}</div>
        <div class="tienda-productos" id="tienda-productos">${htmlProductos(productosFiltrados())}</div>
      </section>
    </main>`;
  }

  function renderHoja(overlay) {
    const carrito = carritoActual();
    const pendientes = pedidosPendientes();
    const totalCarrito = carrito.reduce((s, l) => s + producto(l.sku).precio * Number(l.cantidad), 0);
    const totalPendientes = pendientes.reduce((s, p) => s + p.total, 0);
    const contenido = overlay.querySelector('.tienda-hoja-contenido');
    if (!contenido) return;

    contenido.innerHTML = `
      <div class="tienda-hoja-encabezado">
        <div><h2 id="tienda-hoja-titulo">Mi pedido</h2></div>
        <button type="button" class="tienda-hoja-cerrar" data-tienda-cerrar aria-label="Cerrar">×</button>
      </div>
      <div class="tienda-hoja-items">
        ${carrito.length ? `<div class="tienda-hoja-subtitulo"><b>Productos actuales</b></div>` + htmlCarrito(carrito) : ''}
        ${pendientes.length ? `<div class="tienda-hoja-subtitulo" style="margin-top:15px;"><b>Pedidos guardados anteriormente</b></div>` + pendientes.map(p => `
          <div class="tienda-linea" style="opacity:0.85;background:#f9f9f9;padding:8px;border-radius:6px;margin-bottom:8px;">
            <div class="tienda-linea-info"><b>Pedido ${p.id}</b><span>${new Date(p.fecha).toLocaleDateString()}</span></div>
            <div style="display:flex;align-items:center;gap:10px;">
              <strong>${MONEDA.format(p.total)}</strong>
              <button class="tienda-quitar" type="button" data-tienda-borrar-pendiente="${p.id}" title="Eliminar este pedido guardado">×</button>
            </div>
          </div>`).join('') : ''}
      </div>
      ${(carrito.length || pendientes.length) ? `
        <div class="tienda-total"><span>Total consolidado</span><strong>${MONEDA.format(totalCarrito + totalPendientes)}</strong></div>
        <div class="tienda-hoja-acciones">
          <button class="btn btn-primary btn-block" type="button" data-tienda-enviar>Enviar todo por WhatsApp</button>
        </div>` : '<div class="tienda-vacio">No tienes productos seleccionados.</div>'}
      <p class="tienda-privacidad">Se enviará un solo mensaje con la suma de todos los productos listados arriba.</p>`;
  }

  function sincronizarCarrito(carrito, overlay) {
    if (!guardar('carrito', carrito)) return false;
    actualizarHeader();
    if (overlay) renderHoja(overlay);
    if (document.querySelector('.tienda-screen')) if (typeof window.renderApp === 'function') window.renderApp();
    return true;
  }

  function modificarCantidad(sku, delta, overlay) {
    const carrito = carritoActual(), linea = carrito.find((item) => item.sku === sku);
    if (!linea) return;
    linea.cantidad = Math.min(999, Number(linea.cantidad) + delta);
    sincronizarCarrito(carrito.filter((item) => item.cantidad > 0), overlay);
  }

  function textoWhatsAppConsolidado(pedidos) {
    const merge = {};
    pedidos.forEach(p => {
      p.items.forEach(item => {
        if (!merge[item.sku]) merge[item.sku] = { ...item };
        else merge[item.sku].cantidad += item.cantidad;
      });
    });
    const items = Object.values(merge);
    const lineas = ["*NUEVO PEDIDO*", ""];
    let total = 0;
    items.forEach(item => {
      const sub = item.precio * item.cantidad;
      lineas.push(`• ${item.nombre} (${item.sku})\n  ${item.cantidad} pza(s) × ${MONEDA.format(item.precio)} = ${MONEDA.format(sub)}`);
      total += sub;
    });
    lineas.push("", `*TOTAL ESTIMADO:* ${MONEDA.format(total)}`, "", "Por favor confirmar disponibilidad y envío.");
    return lineas.join("\n");
  }

  function enviarCarrito(overlay) {
    const carrito = carritoActual();
    const pendientes = pedidosPendientes();
    if (!carrito.length && !pendientes.length) return;

    const todosLosPedidos = leer('pedidos');
    const paraMensaje = [];

    if (carrito.length) {
      const items = carrito.map((l) => { const p = producto(l.sku); return { sku:p.sku, nombre:p.nombre, precio:p.precio, cantidad:Number(l.cantidad) }; });
      const fecha = new Date().toISOString();
      const pedidoNuevo = { id:`GID-${fecha.slice(0,10).replace(/-/g,'')}-${Math.random().toString(36).slice(2,6).toUpperCase()}`, fecha, items, total:items.reduce((s,i)=>s+i.precio*i.cantidad,0), estado:'confirmado' };
      todosLosPedidos.unshift(pedidoNuevo);
      paraMensaje.push(pedidoNuevo);
      guardar('carrito', []);
    }

    pendientes.forEach(p => {
      const original = todosLosPedidos.find(t => t.id === p.id);
      if (original) original.estado = 'confirmado';
      paraMensaje.push(p);
    });

    guardar('pedidos', todosLosPedidos);

    const enlace=document.createElement('a');
    enlace.href=`https://wa.me/${WHATSAPP_NUMBER}?text=${encodeURIComponent(textoWhatsAppConsolidado(paraMensaje))}`;
    enlace.target='_blank'; enlace.rel='noopener noreferrer'; document.body.appendChild(enlace); enlace.click(); enlace.remove();

    avisar('Pedido enviado', '✅');
    actualizarHeader();
    overlay?.remove();
  }

  function openCart() {
    let overlay=document.getElementById('tienda-cart-sheet');
    if(overlay){renderHoja(overlay);return;}
    overlay=document.createElement('div'); overlay.id='tienda-cart-sheet'; overlay.className='modal-backdrop tienda-hoja-backdrop';
    overlay.innerHTML='<section class="modal tienda-hoja-modal" role="dialog" aria-modal="true" aria-labelledby="tienda-hoja-titulo"><div class="tienda-hoja-contenido"></div></section>';
    document.body.appendChild(overlay);
    renderHoja(overlay);
    overlay.onclick=(event)=>{
      if(event.target===overlay||event.target.closest('[data-tienda-cerrar]')){overlay.remove();return;}
      const masMenos=event.target.closest('[data-tienda-cantidad]');
      if(masMenos){modificarCantidad(masMenos.dataset.sku,masMenos.dataset.tiendaCantidad==='mas'?1:-1,overlay);return;}
      const quitar=event.target.closest('[data-tienda-quitar]');
      if(quitar){sincronizarCarrito(carritoActual().filter((linea)=>linea.sku!==quitar.dataset.tiendaQuitar),overlay);return;}
      const borrarP = event.target.closest('[data-tienda-borrar-pendiente]');
      if(borrarP) {
        const todos = leer('pedidos');
        guardar('pedidos', todos.filter(p => p.id !== borrarP.dataset.tiendaBorrarPendiente));
        actualizarHeader(); renderHoja(overlay); return;
      }
      if(event.target.closest('[data-tienda-enviar]')){enviarCarrito(overlay);return;}
    };
  }

  window.GanaIDStore={render,bind: (app)=>{
    const root=app.querySelector('.tienda-screen'); if(!root)return;
    root.oninput=(event)=>{if(event.target.id==='tienda-buscar'){busqueda=event.target.value; const el=root.querySelector('#tienda-productos'); if(el)el.innerHTML=htmlProductos(productosFiltrados());}};
    root.onclick=(event)=>{
      const filtro=event.target.closest('[data-tienda-categoria]');
      if(filtro){categoriaActiva=filtro.dataset.tiendaCategoria;root.querySelectorAll('[data-tienda-categoria]').forEach((b)=>b.classList.toggle('activo',b===filtro));const el=root.querySelector('#tienda-productos'); if(el)el.innerHTML=htmlProductos(productosFiltrados());return;}
      const agregarBtn=event.target.closest('[data-tienda-agregar]');
      if(agregarBtn){
        const sku=agregarBtn.dataset.tiendaAgregar, carrito=carritoActual(), linea=carrito.find((item)=>item.sku===sku);
        if(linea)linea.cantidad=Math.min(999,Number(linea.cantidad)+1);else carrito.push({sku,cantidad:1});
        if(guardar('carrito',carrito)){avisar('Agregado','🛒');actualizarHeader();if(typeof window.renderApp === 'function') window.renderApp();}
      }
    };
  },openCart,cartButtonMarkup};
})();
