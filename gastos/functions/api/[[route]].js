// API de Mis Gastos en Cloudflare Pages Functions + base de datos D1.
//
// En Cloudflare Pages -> tu proyecto -> Settings:
//   - Bindings: D1 database, nombre de variable "DB", eligiendo tu base.
//   - Variables and Secrets: secreto "CLAVE" con la clave que escribirás en la app.
//
//   GET  /api/ping   -> comprueba la clave
//   GET  /api/datos  -> todos los gastos y opciones
//   POST /api/sync   -> sube cambios { upserts, deletes, settings } y devuelve todo
//
// Las tablas se crean solas la primera vez. Usan el prefijo "gastos_" para
// no chocar con lo que ya tengas en esa base.

const ESQUEMA = [
  `CREATE TABLE IF NOT EXISTS gastos_pagos (
     id TEXT PRIMARY KEY,
     datos TEXT NOT NULL,
     actualizado INTEGER NOT NULL,
     borrado INTEGER NOT NULL DEFAULT 0
   )`,
  `CREATE TABLE IF NOT EXISTS gastos_ajustes (
     id INTEGER PRIMARY KEY CHECK (id = 1),
     datos TEXT NOT NULL,
     actualizado INTEGER NOT NULL
   )`,
];

const MAX_BODY = 5 * 1024 * 1024;
let esquemaListo = false;

function json(status, data) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
      "Access-Control-Allow-Origin": "*",
    },
  });
}

function mismaClave(a, b) {
  const ea = new TextEncoder().encode(a);
  const eb = new TextEncoder().encode(b);
  let diff = ea.length ^ eb.length;
  for (let i = 0; i < Math.max(ea.length, eb.length); i++) diff |= (ea[i] || 0) ^ (eb[i] || 0);
  return diff === 0;
}

function autorizado(request, env) {
  const auth = request.headers.get("Authorization") || "";
  const dada = auth.startsWith("Bearer ") ? auth.slice(7) : "";
  return !!env.CLAVE && dada.length > 0 && mismaClave(dada, env.CLAVE);
}

async function prepararEsquema(db) {
  if (esquemaListo) return;
  await db.batch(ESQUEMA.map((sql) => db.prepare(sql)));
  esquemaListo = true;
}

async function estadoCompleto(db) {
  const [pagos, ajustes] = await db.batch([
    db.prepare("SELECT id, datos, borrado FROM gastos_pagos"),
    db.prepare("SELECT datos FROM gastos_ajustes WHERE id = 1"),
  ]);
  const expenses = [];
  const deleted = [];
  for (const r of pagos.results) {
    if (r.borrado) deleted.push(r.id);
    else expenses.push(JSON.parse(r.datos));
  }
  const fila = ajustes.results[0];
  return { expenses, deleted, settings: fila ? JSON.parse(fila.datos) : null };
}

// Para cada pago gana la versión con "updated" más reciente; un borrado se
// guarda como marca para que los demás dispositivos también lo borren.
async function sincronizar(db, cuerpo) {
  const ahora = Date.now();
  const stmts = [];

  for (const e of Array.isArray(cuerpo.upserts) ? cuerpo.upserts : []) {
    if (!e || typeof e.id !== "string") continue;
    const act = Number(e.updated) || ahora;
    stmts.push(
      db.prepare(
        `INSERT INTO gastos_pagos (id, datos, actualizado, borrado) VALUES (?1, ?2, ?3, 0)
         ON CONFLICT(id) DO UPDATE SET datos = excluded.datos, actualizado = excluded.actualizado, borrado = 0
         WHERE excluded.actualizado >= gastos_pagos.actualizado`
      ).bind(e.id, JSON.stringify(e), act)
    );
  }

  for (const id of Array.isArray(cuerpo.deletes) ? cuerpo.deletes : []) {
    if (typeof id !== "string") continue;
    stmts.push(
      db.prepare(
        `INSERT INTO gastos_pagos (id, datos, actualizado, borrado) VALUES (?1, '{}', ?2, 1)
         ON CONFLICT(id) DO UPDATE SET datos = '{}', actualizado = excluded.actualizado, borrado = 1`
      ).bind(id, ahora)
    );
  }

  const aj = cuerpo.settings;
  if (aj && typeof aj === "object") {
    stmts.push(
      db.prepare(
        `INSERT INTO gastos_ajustes (id, datos, actualizado) VALUES (1, ?1, ?2)
         ON CONFLICT(id) DO UPDATE SET datos = excluded.datos, actualizado = excluded.actualizado
         WHERE excluded.actualizado > gastos_ajustes.actualizado`
      ).bind(JSON.stringify(aj), Number(aj.updated) || 0)
    );
  }

  if (stmts.length) await db.batch(stmts);
  return estadoCompleto(db);
}

export async function onRequest({ request, env }) {
  const ruta = new URL(request.url).pathname.replace(/\/+$/, "");

  if (request.method === "OPTIONS") {
    return new Response(null, {
      status: 204,
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Headers": "Authorization, Content-Type",
        "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
      },
    });
  }

  if (!env.DB) return json(500, { error: "Falta conectar la base D1 con el nombre DB (Settings > Bindings)" });
  if (!env.CLAVE) return json(500, { error: "Falta el secreto CLAVE (Settings > Variables and Secrets)" });
  if (!autorizado(request, env)) return json(401, { error: "clave incorrecta" });

  await prepararEsquema(env.DB);

  if (request.method === "GET" && ruta === "/api/ping") return json(200, { ok: true });
  if (request.method === "GET" && ruta === "/api/datos") return json(200, await estadoCompleto(env.DB));

  if (request.method === "POST" && ruta === "/api/sync") {
    const texto = await request.text();
    if (!texto || texto.length > MAX_BODY) return json(413, { error: "tamaño no válido" });
    let cuerpo;
    try {
      cuerpo = JSON.parse(texto);
    } catch {
      return json(400, { error: "JSON no válido" });
    }
    if (!cuerpo || typeof cuerpo !== "object") return json(400, { error: "JSON no válido" });
    return json(200, await sincronizar(env.DB, cuerpo));
  }

  return json(404, { error: "no encontrado" });
}
