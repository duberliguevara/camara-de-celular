// Sincroniza los gastos con tu base de datos D1 de Cloudflare a través de
// la API de functions/api/ (Cloudflare Pages).
// La app guarda todo primero en el celular; aquí se sube lo pendiente y se
// baja lo que llegó desde otros dispositivos.
(function(){
  'use strict';

  var CONF_KEY = 'mis-gastos-servidor';
  var G = window.GastosApp;
  var $ = function(id){ return document.getElementById(id); };
  var EXPENSE_FIELDS = ['id', 'amount', 'currency', 'cat', 'desc', 'date', 'cardId', 'method', 'installments', 'raw', 'created', 'updated'];
  var SETTINGS_FIELDS = ['cards', 'categories', 'rate', 'budget'];

  var timer = null, running = false, again = false;

  function loadConf(){
    try { return JSON.parse(localStorage.getItem(CONF_KEY)) || {}; } catch (e) { return {}; }
  }
  function saveConf(c){
    try { localStorage.setItem(CONF_KEY, JSON.stringify(c)); } catch (e) {}
  }
  var conf = loadConf();

  // Si la app se abrió desde el propio servidor, la dirección es esta misma.
  function servedByServer(){ return location.protocol === 'https:' || location.hostname === 'localhost'; }
  function baseUrl(){
    var u = (conf.url || '').trim().replace(/\/+$/, '');
    if (u && !/^https?:\/\//i.test(u)) u = 'https://' + u;
    return u || (servedByServer() ? location.origin : '');
  }
  function configured(){ return !!(conf.key && baseUrl()); }

  function setStatus(text, kind){
    var el = $('sync-status');
    el.textContent = text;
    el.dataset.kind = kind || '';
    $('server-state').textContent = text;
  }

  function pick(obj, fields){
    var out = {};
    fields.forEach(function(k){ out[k] = obj[k] === undefined ? null : obj[k]; });
    return out;
  }

  function request(method, path, body){
    return fetch(baseUrl() + path, {
      method: method,
      headers: { 'Authorization': 'Bearer ' + conf.key, 'Content-Type': 'application/json' },
      body: body ? JSON.stringify(body) : undefined,
      cache: 'no-store'
    }).then(function(r){
      if (r.status === 401) throw { auth: true };
      if (!r.ok) throw new Error('HTTP ' + r.status);
      return r.json();
    });
  }

  function sync(){
    if (!configured()) { setStatus('📱 Solo en este celular', 'local'); return Promise.resolve(); }
    if (running) { again = true; return Promise.resolve(); }
    running = true;

    var s = G.getState();
    var sent = {};
    var upserts = s.expenses.filter(function(e){ return !e.synced; }).map(function(e){
      sent[e.id] = e.updated || 0;
      return pick(e, EXPENSE_FIELDS);
    });
    var deletes = s.deleted.slice();
    var body = { upserts: upserts, deletes: deletes };
    if (!conf.serverHasSettings || s.settingsUpdated > (conf.settingsSeen || 0)) {
      body.settings = pick(s, SETTINGS_FIELDS);
      body.settings.updated = s.settingsUpdated || 1;
    }
    if (upserts.length || deletes.length) setStatus('🔄 Subiendo…', 'pending');

    return request('POST', '/api/sync', body).then(function(res){
      s = G.getState();
      var gone = {};
      (res.deleted || []).forEach(function(id){ gone[id] = 1; });
      var server = {};
      (res.expenses || []).forEach(function(e){
        if (e && e.id && e.amount > 0 && /^\d{4}-\d{2}-\d{2}$/.test(e.date)) server[e.id] = e;
      });

      var merged = [];
      s.expenses.forEach(function(e){
        if (gone[e.id]) return;                                   // borrado en otro dispositivo
        var changedMeanwhile = !e.synced && (!(e.id in sent) || (e.updated || 0) !== sent[e.id]);
        if (changedMeanwhile) { merged.push(e); return; }         // se sube en la próxima vuelta
        if (server[e.id]) { merged.push(Object.assign({}, server[e.id], { synced: true })); delete server[e.id]; }
      });
      Object.keys(server).forEach(function(id){ merged.push(Object.assign({}, server[id], { synced: true })); });
      s.expenses = merged;
      s.deleted = s.deleted.filter(function(id){ return deletes.indexOf(id) < 0; });

      var st = res.settings;
      if (st && (st.updated || 0) > (s.settingsUpdated || 0)) {
        SETTINGS_FIELDS.forEach(function(k){ if (st[k] != null || k === 'budget') s[k] = st[k]; });
        s.settingsUpdated = st.updated;
      }
      conf.serverHasSettings = !!st;
      conf.settingsSeen = Math.max(s.settingsUpdated || 0, st ? st.updated || 0 : 0);
      saveConf(conf);

      G.save();
      G.render();
      var hora = new Date().toLocaleTimeString('es-PE', { hour: '2-digit', minute: '2-digit' });
      setStatus('☁️ Guardado en Cloudflare · ' + hora, 'ok');
    }).catch(function(err){
      if (err && err.auth) setStatus('⚠️ Clave incorrecta (revisa Opciones)', 'error');
      else setStatus('📴 Sin conexión: se subirá cuando vuelva la señal', 'pending');
    }).then(function(){
      running = false;
      if (again) { again = false; schedule(); }
    });
  }

  function schedule(){
    clearTimeout(timer);
    timer = setTimeout(sync, 800);
  }

  // app.js llama a estas funciones al guardar, borrar o cambiar opciones.
  G.registerCloud({ putExpense: schedule, deleteExpense: schedule, putSettings: schedule, resync: schedule });

  // ---------- Opciones ----------

  function fillForm(){
    $('server-url').value = conf.url || '';
    $('server-url').placeholder = servedByServer() ? location.origin + ' (esta misma)' : 'https://mis-gastos.pages.dev';
    $('server-key').value = conf.key || '';
  }

  $('btn-menu').addEventListener('click', fillForm);
  $('sync-status').addEventListener('click', function(){ sync(); });

  $('btn-server-save').addEventListener('click', function(){
    conf.url = $('server-url').value.trim();
    conf.key = $('server-key').value.trim();
    conf.settingsSeen = 0;
    conf.serverHasSettings = false;
    saveConf(conf);
    if (!configured()) { setStatus('📱 Solo en este celular', 'local'); return; }
    setStatus('🔄 Probando conexión…', 'pending');
    request('GET', '/api/ping').then(function(){
      G.toast('Conectado a tu base de Cloudflare');
      // sube todo lo que haya en este celular (el servidor ignora lo que ya tenga más nuevo)
      G.getState().expenses.forEach(function(e){ e.synced = false; });
      sync();
    }).catch(function(err){
      setStatus(err && err.auth ? '⚠️ Clave incorrecta' : '📴 No se pudo conectar con esa dirección', 'error');
    });
  });

  window.addEventListener('online', schedule);
  document.addEventListener('visibilitychange', function(){ if (!document.hidden) schedule(); });
  setInterval(function(){ if (!document.hidden) sync(); }, 60000);

  sync();
})();
