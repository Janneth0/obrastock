// Servidor mínimo sin dependencias: sirve /public y expone POST /api/ai (proxy a Claude).
// La clave NUNCA va en el frontend: vive solo acá, en .env.
const http = require('http'), fs = require('fs'), path = require('path'), { Pool } = require('pg');
const PORT = process.env.PORT || 3000;
const MODELO = process.env.MODELO || 'claude-sonnet-5-5';
const TIPOS = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json' };

const SISTEMA = `Sos un analista de compras y stock para una constructora argentina.
Recibís materiales (stock, mínimo, costo), movimientos recientes y obras con presupuesto/gasto.
Respondé SOLO con JSON válido, sin texto extra ni backticks, con esta forma:
{"resumen":"2-4 oraciones claras","riesgos":["..."],"sugerencias":[{"codigo":"...","cant":número,"motivo":"..."}]}
Reglas: estimá consumo diario por material con los egresos, proyectá cuántos días de stock quedan,
sugerí compras solo si hay riesgo de faltante (< 7 días o bajo el mínimo), y avisá de obras que superen el 80% del presupuesto.`;

async function consultarIA(datos) {
  if (!process.env.ANTHROPIC_API_KEY) throw new Error('Falta ANTHROPIC_API_KEY en .env');
  const r = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-api-key': process.env.ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01' },
    body: JSON.stringify({ model: MODELO, max_tokens: 1200, system: SISTEMA,
      messages: [{ role: 'user', content: JSON.stringify(datos) }] })
  });
  const j = await r.json();
  if (!r.ok) throw new Error(j.error?.message || 'Error de la API');
  const txt = j.content.map(b => b.text || '').join('').replace(/```json|```/g, '').trim();
  return JSON.parse(txt);
}

// ---------- Base de datos (PostgreSQL) ----------
const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const sqlf = f => fs.readFileSync(path.join(__dirname, 'db', f), 'utf8');
async function iniciarDB() {
  await pool.query(sqlf('schema.sql'));
  const { rows } = await pool.query('SELECT count(*)::int AS n FROM materiales');
  if (!rows[0].n) await pool.query(sqlf('seed.sql'));
}
const NIVELES = [[1e5, 'Jefe de obra'], [5e5, 'Jefe de compras'], [Infinity, 'Gerencia']];
const nivel = m => NIVELES.find(n => m < n[0])[1];
const Q = {
  materiales: `SELECT codigo, descripcion AS "desc", unidad, stock::float8 AS stock, minimo::float8 AS minimo, costo::float8 AS costo FROM materiales ORDER BY codigo`,
  obras: `SELECT id, nombre, presupuesto::float8 AS presupuesto, gasto::float8 AS gasto FROM obras ORDER BY id`,
  mov: `SELECT (extract(epoch FROM ts)*1000)::float8 AS ts, codigo, obra_id AS obra, tipo, cantidad::float8 AS cant, responsable AS resp FROM movimientos WHERE ts > now() - interval '60 days' ORDER BY ts, id`,
  sol: `SELECT id, codigo, cantidad::float8 AS cant, obra_id AS obra, monto::float8 AS monto, nivel, estado, excede, ia FROM solicitudes ORDER BY id`
};
const err = m => Object.assign(new Error(m), { status: 400 });
const RUTAS = {
  'GET /api/estado': async () => {
    const r = await Promise.all(Object.values(Q).map(q => pool.query(q)));
    return Object.fromEntries(Object.keys(Q).map((k, i) => [k, r[i].rows]));
  },
  'POST /api/materiales': async b => {
    if (!b.desc || !b.unidad) throw err('Faltan datos');
    await pool.query(`INSERT INTO materiales (codigo, descripcion, unidad, stock, minimo, costo)
      VALUES ('MAT-' || lpad(nextval('mat_seq')::text, 3, '0'), $1, $2, $3, $4, $5)`, [b.desc, b.unidad, +b.stock || 0, +b.minimo || 0, +b.costo || 0]);
    return { ok: true };
  },
  // Transacción: el stock, el gasto de la obra y el movimiento cambian juntos o no cambian
  'POST /api/movimientos': async b => {
    const cant = +b.cant, eg = b.tipo === 'egreso';
    if (!(cant > 0) || !['ingreso', 'egreso'].includes(b.tipo) || !b.resp) throw err('Datos inválidos');
    const c = await pool.connect();
    try {
      await c.query('BEGIN');
      const m = (await c.query('SELECT costo FROM materiales WHERE codigo = $1 FOR UPDATE', [b.codigo])).rows[0];
      if (!m) throw err('Material inexistente');
      await c.query('UPDATE materiales SET stock = stock + $1 WHERE codigo = $2', [eg ? -cant : cant, b.codigo]);
      if (eg) await c.query('UPDATE obras SET gasto = gasto + $1 WHERE id = $2', [cant * m.costo, b.obra]);
      await c.query('INSERT INTO movimientos (codigo, obra_id, tipo, cantidad, responsable) VALUES ($1,$2,$3,$4,$5)', [b.codigo, b.obra, b.tipo, cant, b.resp]);
      await c.query('COMMIT');
    } catch (e) { await c.query('ROLLBACK'); throw e; } finally { c.release(); }
    return { ok: true };
  },
  'POST /api/solicitudes': async b => {
    const cant = +b.cant; if (!(cant > 0)) throw err('Cantidad inválida');
    const m = (await pool.query('SELECT costo::float8 AS costo FROM materiales WHERE codigo = $1', [b.codigo])).rows[0];
    const o = (await pool.query('SELECT presupuesto::float8 AS p, gasto::float8 AS g FROM obras WHERE id = $1', [b.obra])).rows[0];
    if (!m || !o) throw err('Material u obra inexistente');
    const monto = cant * m.costo;
    await pool.query('INSERT INTO solicitudes (codigo, obra_id, cantidad, monto, nivel, excede, ia) VALUES ($1,$2,$3,$4,$5,$6,$7)',
      [b.codigo, b.obra, cant, monto, nivel(monto), o.g + monto > o.p, !!b.ia]);
    return { ok: true };
  },
  'PATCH /api/solicitudes': async (b, id) => {
    if (!['Aprobada', 'Rechazada'].includes(b.estado)) throw err('Estado inválido');
    await pool.query("UPDATE solicitudes SET estado = $1 WHERE id = $2 AND estado = 'Pendiente'", [b.estado, +id]);
    return { ok: true };
  }
};
async function api(req, res) {
  let body = ''; for await (const c of req) { body += c; if (body.length > 2e6) return res.destroy(); }
  const [url] = req.url.split('?'), m = url.match(/^(\/api\/\w+)(?:\/(\d+))?$/), h = m && RUTAS[req.method + ' ' + m[1]];
  const out = (code, o) => { res.writeHead(code, { 'content-type': 'application/json' }); res.end(JSON.stringify(o)); };
  if (!h) return out(404, { error: 'Ruta inexistente' });
  try { out(200, await h(body ? JSON.parse(body) : {}, m[2])); } catch (e) { console.error(e.message); out(e.status || 500, { error: e.message }); }
}

const handler = async (req, res) => {
  if (req.url.startsWith('/api/') && req.url !== '/api/ai') return api(req, res);
  if (req.method === 'POST' && req.url === '/api/ai') {
    let body = ''; req.on('data', c => { body += c; if (body.length > 2e6) req.destroy(); });
    req.on('end', async () => {
      try { const out = await consultarIA(JSON.parse(body));
        res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify(out));
      } catch (e) { res.writeHead(500, { 'content-type': 'application/json' }); res.end(JSON.stringify({ error: e.message })); }
    });
    return;
  }
  const f = path.join(__dirname, 'public', req.url === '/' ? 'index.html' : path.normalize(req.url).replace(/^(\.\.[\/\\])+/, ''));
  fs.readFile(f, (err, data) => {
    if (err) { res.writeHead(404); return res.end('No encontrado'); }
    res.writeHead(200, { 'content-type': TIPOS[path.extname(f)] || 'application/octet-stream' }); res.end(data);
  });
};

iniciarDB().then(() => http.createServer(handler).listen(PORT, () => console.log('ObraStock en http://localhost:' + PORT)))
  .catch(e => { console.error('No se pudo conectar a PostgreSQL:', e.message); process.exit(1); });
