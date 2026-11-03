// ObraStock – los datos viven en PostgreSQL; el navegador solo llama a /api/*.
const $ = s => document.querySelector(s), money = n => '$' + Math.round(n).toLocaleString('es-AR');
const NIVELES = [[100000, 'Jefe de obra'], [500000, 'Jefe de compras'], [Infinity, 'Gerencia']]; // matriz de aprobaciones
const nivel = m => NIVELES.find(n => m < n[0])[1];
const hoy = () => Date.now(), dia = 864e5;
let S = { materiales: [], obras: [], mov: [], sol: [], ia: null }, tab = 'panel', stream = null;
const api = async (m, u, b) => { const r = await fetch(u, { method: m, headers: { 'content-type': 'application/json' }, body: b && JSON.stringify(b) });
  const j = await r.json(); if (!r.ok) throw new Error(j.error || 'Error de servidor'); return j; };
async function cargar() { const ia = S.ia; S = { ...(await api('GET', '/api/estado')), ia }; render(); }
const run = p => p.then(cargar).catch(e => alert(e.message));
const mat = c => S.materiales.find(m => m.codigo === c), obra = i => S.obras.find(o => o.id === i);
const opts = (a, v, l) => a.map(x => `<option value="${x[v]}">${x[l]}</option>`).join('');
const TABS = { panel: 'Panel', stock: 'Stock', mov: 'Movimientos', compras: 'Compras', ia: 'IA' };
$('#tabs').innerHTML = Object.entries(TABS).map(([k, v]) => `<button data-t="${k}">${v}</button>`).join('');
$('#tabs').onclick = e => { if (e.target.dataset.t) { tab = e.target.dataset.t; stopCam(); render(); } };

function render() {
  document.querySelectorAll('nav button').forEach(b => b.classList.toggle('on', b.dataset.t === tab));
  $('#v').innerHTML = VIEWS[tab](); BIND[tab]?.();
}
const estado = m => m.stock < m.minimo ? ['bad', 'Bajo mínimo'] : m.stock < m.minimo * 1.3 ? ['w', 'Atención'] : ['ok', 'OK'];
const VIEWS = {
  panel() {
    const val = S.materiales.reduce((a, m) => a + m.stock * m.costo, 0), bajos = S.materiales.filter(m => m.stock < m.minimo).length;
    return `<div class="grid"><div class="card k"><b>${money(val)}</b><span>Valor en stock</span></div>
    <div class="card k"><b>${bajos}</b><span>Materiales bajo mínimo</span></div>
    <div class="card k"><b>${S.sol.filter(s => s.estado === 'Pendiente').length}</b><span>Compras por aprobar</span></div></div>
    <div class="card"><h3>Gasto vs. presupuesto</h3>${S.obras.map(o => { const p = o.gasto / o.presupuesto * 100;
      return `<p><b>${o.nombre}</b> — ${money(o.gasto)} de ${money(o.presupuesto)} (${p.toFixed(0)}%) ${p > 80 ? '<span class="tag bad">⚠ Alerta de desvío</span>' : ''}</p>
      <div class="bar"><i style="width:${Math.min(p, 100)}%;background:var(--${p > 80 ? 'bad' : p > 60 ? 'w' : 'ok'})"></i></div>`; }).join('')}</div>`;
  },
  stock() {
    return `<div class="card tw"><table><tr><th>Código</th><th>Material</th><th>Stock</th><th>Mín.</th><th>Estado</th><th>QR</th></tr>
    ${S.materiales.map(m => { const e = estado(m); return `<tr><td>${m.codigo}</td><td>${m.desc}</td><td>${m.stock} ${m.unidad}</td><td>${m.minimo}</td>
    <td><span class="tag ${e[0]}">${e[1]}</span></td><td><button class="s" data-qr="${m.codigo}">Ver</button></td></tr>`; }).join('')}</table></div>
    <div class="card"><h3>Nuevo material</h3><form id="fm"><input name="desc" placeholder="Descripción" required><input name="unidad" placeholder="Unidad" required>
    <input name="stock" type="number" min="0" placeholder="Stock inicial" required><input name="minimo" type="number" min="0" placeholder="Stock mínimo" required>
    <input name="costo" type="number" min="0" placeholder="Costo unitario $" required><button class="p">Agregar</button></form></div>`;
  },
  mov() {
    return `<div class="card"><h3>Escanear QR o cargar manualmente</h3><video id="cam" playsinline hidden></video>
    <p><button class="s" id="scan">📷 Abrir cámara</button> <span class="muted" id="smsg"></span></p>
    <form id="fv"><select name="codigo" id="sc">${opts(S.materiales, 'codigo', 'desc')}</select><select name="obra">${opts(S.obras, 'id', 'nombre')}</select>
    <select name="tipo"><option value="egreso">Egreso (salida a obra)</option><option value="ingreso">Ingreso (remito)</option></select>
    <input name="cant" type="number" min="0.01" step="any" placeholder="Cantidad" required><input name="resp" placeholder="Responsable" required><button class="p">Registrar</button></form></div>
    <div class="card tw"><h3>Últimos movimientos</h3><table>${[...S.mov].reverse().slice(0, 12).map(m => `<tr><td>${new Date(m.ts).toLocaleDateString('es-AR')}</td><td>${mat(m.codigo)?.desc}</td>
    <td>${m.tipo === 'egreso' ? '−' : '+'}${m.cant}</td><td>${obra(m.obra)?.nombre}</td><td>${m.resp}</td></tr>`).join('')}</table></div>`;
  },
  compras() {
    return `<div class="card"><h3>Nueva solicitud de compra</h3><form id="fs"><select name="codigo">${opts(S.materiales, 'codigo', 'desc')}</select>
    <select name="obra">${opts(S.obras, 'id', 'nombre')}</select><input name="cant" type="number" min="1" placeholder="Cantidad" required><button class="p">Solicitar</button></form>
    <p class="muted">Aprobación por monto: &lt;$100.000 jefe de obra · &lt;$500.000 jefe de compras · mayor: gerencia.</p></div>
    <div class="card tw"><table><tr><th>Material</th><th>Cant.</th><th>Monto</th><th>Aprueba</th><th>Estado</th><th></th></tr>
    ${S.sol.map((s, i) => `<tr><td>${mat(s.codigo)?.desc}${s.ia ? ' 🤖' : ''}</td><td>${s.cant}</td><td>${money(s.monto)}${s.excede ? ' ⚠' : ''}</td><td>${s.nivel}</td><td>${s.estado}</td>
    <td>${s.estado === 'Pendiente' ? `<button class="s" data-ok="${i}">✔</button> <button class="s" data-no="${i}">✖</button>` : ''}</td></tr>`).join('') || '<tr><td>Sin solicitudes</td></tr>'}</table></div>`;
  },
  ia() {
    const r = S.ia;
    return `<div class="card"><h3>Asistente de compras con IA</h3><p class="muted">Analiza consumo, proyecta faltantes y propone borradores de compra. Si no hay servidor/clave, usa un cálculo local.</p>
    <button class="p" id="go">Analizar ahora</button> <span id="ims" class="muted"></span></div>
    ${r ? `<div class="card"><p>${r.resumen}</p>${(r.riesgos || []).map(x => `<p>⚠ ${x}</p>`).join('')}<p class="muted">Origen: ${r.origen}</p>
    ${(r.sugerencias || []).map((s, i) => `<p>• <b>${mat(s.codigo)?.desc || s.codigo}</b>: comprar ${s.cant} — ${s.motivo} <button class="s" data-sg="${i}">Crear solicitud</button></p>`).join('')}</div>` : ''}`;
  }
};
const addSol = (codigo, cant, obraId, ia) => run(api('POST', '/api/solicitudes', { codigo, cant, obra: obraId || S.obras[0].id, ia: !!ia }));
const BIND = {
  stock() {
    $('#fm').onsubmit = e => { e.preventDefault(); run(api('POST', '/api/materiales', Object.fromEntries(new FormData(e.target)))); };
    document.querySelectorAll('[data-qr]').forEach(b => b.onclick = () => { const c = b.dataset.qr, md = $('#modal');
      md.hidden = false; md.innerHTML = `<div><h3>${c}</h3><div id="qr"></div><p>${mat(c).desc}</p><button class="s" onclick="window.print()">Imprimir</button> <button class="s" onclick="$('#modal').hidden=true">Cerrar</button></div>`;
      new QRCode($('#qr'), { text: c, width: 180, height: 180 }); });
  },
  mov() {
    $('#scan').onclick = async () => {
      if (!('BarcodeDetector' in window)) return $('#smsg').textContent = 'Tu navegador no lee QR: usá Chrome en Android o cargá a mano.';
      try { stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } }); const v = $('#cam'); v.srcObject = stream; v.hidden = false; await v.play();
        const det = new BarcodeDetector({ formats: ['qr_code'] });
        (async function loop() { if (!stream) return; const r = await det.detect(v).catch(() => []);
          if (r[0] && mat(r[0].rawValue)) { $('#sc').value = r[0].rawValue; $('#smsg').textContent = '✔ ' + mat(r[0].rawValue).desc; stopCam(); } else requestAnimationFrame(loop); })();
      } catch { $('#smsg').textContent = 'No se pudo abrir la cámara (¿permiso o HTTPS?).'; }
    };
    $('#fv').onsubmit = e => { e.preventDefault(); const d = Object.fromEntries(new FormData(e.target)), m = mat(d.codigo);
      if (d.tipo === 'egreso' && +d.cant > m.stock && !confirm('Stock insuficiente. ¿Registrar igual?')) return;
      run(api('POST', '/api/movimientos', d)); };
  },
  compras() {
    $('#fs').onsubmit = e => { e.preventDefault(); const d = Object.fromEntries(new FormData(e.target)); addSol(d.codigo, +d.cant, d.obra); };
    document.querySelectorAll('[data-ok]').forEach(b => b.onclick = () => run(api('PATCH', '/api/solicitudes/' + S.sol[b.dataset.ok].id, { estado: 'Aprobada' })));
    document.querySelectorAll('[data-no]').forEach(b => b.onclick = () => run(api('PATCH', '/api/solicitudes/' + S.sol[b.dataset.no].id, { estado: 'Rechazada' })));
  },
  ia() {
    $('#go').onclick = async () => {
      $('#ims').textContent = 'Analizando…';
      const datos = { materiales: S.materiales, obras: S.obras, movimientos: S.mov.filter(m => m.ts > hoy() - 30 * dia) };
      try { const r = await fetch('/api/ai', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(datos) });
        if (!r.ok) throw 0; S.ia = { ...(await r.json()), origen: 'Claude (IA)' };
      } catch { S.ia = local(); }
      render();
    };
    document.querySelectorAll('[data-sg]').forEach(b => b.onclick = () => { const s = S.ia.sugerencias[b.dataset.sg]; tab = 'compras'; addSol(s.codigo, s.cant, null, true); });
  }
};
function stopCam() { stream?.getTracks().forEach(t => t.stop()); stream = null; const v = $('#cam'); if (v) v.hidden = true; }
// Respaldo sin IA: promedio de consumo de 14 días → días de stock restantes
function local() {
  const sug = [], rie = [];
  S.materiales.forEach(m => { const u = S.mov.filter(x => x.codigo === m.codigo && x.tipo === 'egreso' && x.ts > hoy() - 14 * dia).reduce((a, x) => a + x.cant, 0) / 14, d = u ? m.stock / u : 999;
    if (d < 7 || m.stock < m.minimo) sug.push({ codigo: m.codigo, cant: Math.ceil(Math.max(m.minimo * 2 - m.stock, u * 14)), motivo: `quedan ~${d > 900 ? '—' : d.toFixed(1)} días de stock` }); });
  S.obras.forEach(o => o.gasto / o.presupuesto > .8 && rie.push(`${o.nombre} superó el 80% del presupuesto.`));
  return { resumen: sug.length ? `Se detectan ${sug.length} materiales con riesgo de faltante.` : 'No se detectan faltantes próximos.', riesgos: rie, sugerencias: sug, origen: 'calculo predictivo' };
}
cargar().catch(() => { $('#v').innerHTML = '<div class="card">No se pudo conectar con el servidor o la base de datos. Revisá DATABASE_URL en .env.</div>'; });
