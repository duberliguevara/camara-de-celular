(function(){
  'use strict';

  var STORAGE_KEY = 'mis-gastos-v1';
  var GENERAL_METHODS = ['Efectivo', 'Débito', 'Yape', 'Plin', 'Transferencia', 'Otro'];
  var METHOD_ICONS = { 'Efectivo': '💵', 'Débito': '🏧', 'Yape': '📱', 'Plin': '📱', 'Transferencia': '🔁', 'Otro': '💰' };
  var CARD_COLORS = ['#0f766e', '#7c3aed', '#1d4ed8', '#db2777', '#ea580c', '#0891b2', '#4d7c0f'];

  var DEFAULT_CATEGORIES = [
    { name: 'Comida', emoji: '🍽️' },
    { name: 'Supermercado', emoji: '🛒' },
    { name: 'Transporte', emoji: '🚗' },
    { name: 'Servicios', emoji: '💡' },
    { name: 'Suscripciones', emoji: '📺' },
    { name: 'Compras', emoji: '🛍️' },
    { name: 'Salud', emoji: '💊' },
    { name: 'Entretenimiento', emoji: '🎬' },
    { name: 'Educación', emoji: '📚' },
    { name: 'Hogar', emoji: '🏠' },
    { name: 'Otros', emoji: '📦' }
  ];

  // Categoría sugerida según el nombre del comercio.
  var AUTO_CATEGORY = [
    [/netflix|spotify|disney|hbo|max\.com|prime ?video|amazon prime|youtube|apple\.com|icloud|google|paramount|crunchyroll|chatgpt|openai/i, 'Suscripciones'],
    [/wong|plaza ?vea|tottus|metro|vivanda|makro|tambo|oxxo|mass|mercado|minimarket|bodega|listo|repshop/i, 'Supermercado'],
    [/uber|cabify|didi|indriver|beat|grifo|primax|repsol|pecsa|petroperu|peaje|estaciona|taxi|bus|metropolitano/i, 'Transporte'],
    [/rappi|pedidos ?ya|kfc|mc ?donald|burger|bembos|pizza|starbucks|restaur|chifa|cevich|polleria|cafe|cafeter|dunkin|popeyes|norky/i, 'Comida'],
    [/inkafarma|mifarma|farmacia|botica|clinica|clínica|hospital|laboratorio|dental/i, 'Salud'],
    [/luz del sur|enel|sedapal|calidda|movistar|claro|entel|bitel|win|internet|agua|gas natural|recibo|servicio|recarga|celular|postpago|telefon/i, 'Servicios'],
    [/saga|falabella|ripley|oechsle|paris|mercado ?libre|aliexpress|amazon|shein|zara|h&m|promart|sodimac|maestro/i, 'Compras'],
    [/cine|cineplanet|cinemark|teleticket|joinnus|steam|playstation|xbox|nintendo/i, 'Entretenimiento']
  ];

  // ---------- Estado ----------

  function uid(){ return Date.now().toString(36) + Math.random().toString(36).slice(2, 7); }

  function defaultState(){
    return {
      expenses: [],
      cards: [
        { id: 'sip', name: 'SIP', last4: '', closingDay: '', keywords: 'sip', color: CARD_COLORS[0] },
        { id: 'io', name: 'iO', last4: '', closingDay: '', keywords: 'io', color: CARD_COLORS[1] },
        { id: 'bcp', name: 'BCP Platinum', last4: '', closingDay: '', keywords: 'bcp, platinum', color: CARD_COLORS[2] }
      ],
      categories: DEFAULT_CATEGORIES.slice(),
      rate: 3.75,
      budget: null,
      settingsUpdated: 0,
      deleted: []
    };
  }

  function load(){
    try {
      var raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return defaultState();
      var s = JSON.parse(raw);
      var d = defaultState();
      return {
        expenses: Array.isArray(s.expenses) ? s.expenses : [],
        cards: Array.isArray(s.cards) ? s.cards : d.cards,
        categories: Array.isArray(s.categories) && s.categories.length ? s.categories : d.categories,
        rate: s.rate > 0 ? s.rate : d.rate,
        budget: s.budget > 0 ? s.budget : null,
        settingsUpdated: s.settingsUpdated || 0,
        deleted: Array.isArray(s.deleted) ? s.deleted : []
      };
    } catch (e) {
      return defaultState();
    }
  }

  function save(){
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    } catch (e) {
      toast('No se pudo guardar en este dispositivo');
    }
  }

  var state = load();

  // ---------- Sincronización (sync.js se registra aquí) ----------
  // Cada pago lleva `synced`: true cuando ya está en tu servidor. Los que se
  // borran quedan en state.deleted hasta que el servidor confirma el
  // borrado, así no se pierde nada si no hay señal.

  var cloud = null;

  function expenseChanged(e){
    e.synced = false;
    e.updated = Date.now();
    save();
    if (cloud) cloud.putExpense(e);
  }

  function expenseDeleted(e){
    // siempre se avisa al servidor: el pago pudo haberse subido aunque aún no esté confirmado
    if (state.deleted.indexOf(e.id) < 0) state.deleted.push(e.id);
    save();
    if (cloud) cloud.deleteExpense(e.id);
  }

  function settingsChanged(){
    state.settingsUpdated = Date.now();
    save();
    if (cloud) cloud.putSettings();
  }

  var viewYear, viewMonth; // mes que se está viendo
  var currentTab = 'expenses';
  var editingId = null;
  var selectedCat = null;
  var selectedPay = null;
  var pendingSource = null;
  var selectedKind = null; // null = gasto, 'cardPayment' = pago de tarjeta // 'card:<id>' | 'gen:<método>'
  var pendingRaw = null;  // texto de notificación del pago que se está creando

  (function(){ var n = new Date(); viewYear = n.getFullYear(); viewMonth = n.getMonth(); })();

  // ---------- Utilidades ----------

  var $ = function(id){ return document.getElementById(id); };

  function parseAmount(str){
    if (str == null) return null;
    var n = GastosParser.parseNumber(String(str).replace(/[^\d.,]/g, ''));
    return n != null && n > 0 ? Math.round(n * 100) / 100 : null;
  }

  function fmt(n, currency){
    var sym = currency === 'USD' ? 'US$ ' : 'S/ ';
    return sym + Number(n || 0).toLocaleString('es-PE', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }

  function fmtShort(n){
    if (n >= 1000) return (n / 1000).toLocaleString('es-PE', { maximumFractionDigits: 1 }) + 'k';
    return Math.round(n).toString();
  }

  function toPEN(e){ return e.currency === 'USD' ? e.amount * state.rate : e.amount; }

  function pad(n){ return n < 10 ? '0' + n : '' + n; }
  function isoDate(d){ return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()); }
  function todayISO(){ return isoDate(new Date()); }
  function parseISO(s){ var p = s.split('-'); return new Date(+p[0], +p[1] - 1, +p[2]); }

  function monthName(y, m, short){
    return new Date(y, m, 1).toLocaleDateString('es-PE', short ? { month: 'short' } : { month: 'long', year: 'numeric' });
  }

  function esc(s){
    return String(s == null ? '' : s).replace(/[&<>"']/g, function(c){
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  function catEmoji(name){
    var c = state.categories.find(function(c){ return c.name === name; });
    return c ? c.emoji : '📦';
  }

  function cardById(id){ return state.cards.find(function(c){ return c.id === id; }); }

  function payLabel(e){
    if (e.cardId) { var c = cardById(e.cardId); return c ? c.name : 'Tarjeta eliminada'; }
    return e.method || 'Otro';
  }

  function inMonth(e, y, m){
    var d = parseISO(e.date);
    return d.getFullYear() === y && d.getMonth() === m;
  }

  // Tipos de registro (campo kind):
  //  - sin kind: un gasto (cuenta en "Gastado este mes"; con tarjeta, además sube su deuda)
  //  - 'cardPayment': pago de una tarjeta. No es gasto: baja la deuda de esa tarjeta.
  //  - 'cardDebt': deuda anterior de una tarjeta. No es gasto del mes: solo sube su deuda.
  function isPay(e){ return e.kind === 'cardPayment'; }
  function isDebt(e){ return e.kind === 'cardDebt'; }
  function isSpend(e){ return !e.kind; }
  var KIND_LABEL = { cardPayment: 'Pago de tarjeta', cardDebt: 'Deuda anterior' };

  // Lo que se debe en cada tarjeta: deuda inicial + consumos - pagos (por moneda).
  function cardDebt(card){
    var d = { PEN: parseFloat(card.startDebt) || 0, USD: 0 };
    state.expenses.forEach(function(e){
      if (e.cardId !== card.id) return;
      var cur = e.currency === 'USD' ? 'USD' : 'PEN';
      d[cur] += isPay(e) ? -e.amount : e.amount; // gasto con tarjeta o deuda anterior: suma
    });
    d.PEN = Math.round(d.PEN * 100) / 100;
    d.USD = Math.round(d.USD * 100) / 100;
    return d;
  }

  function sums(list){
    var r = { PEN: 0, USD: 0, total: 0 };
    list.forEach(function(e){ r[e.currency === 'USD' ? 'USD' : 'PEN'] += e.amount; r.total += toPEN(e); });
    return r;
  }

  function sumText(s){
    if (s.USD && s.PEN) return fmt(s.PEN, 'PEN') + ' + ' + fmt(s.USD, 'USD');
    if (s.USD) return fmt(s.USD, 'USD');
    return fmt(s.PEN, 'PEN');
  }

  function guessCategory(desc){
    if (!desc) return null;
    // primero: la última categoría usada con ese mismo comercio
    var key = desc.trim().toLowerCase();
    for (var i = state.expenses.length - 1; i >= 0; i--) {
      var e = state.expenses[i];
      if (isSpend(e) && e.desc && e.desc.trim().toLowerCase() === key) return e.cat;
    }
    for (var j = 0; j < AUTO_CATEGORY.length; j++) {
      if (AUTO_CATEGORY[j][0].test(desc) && state.categories.some(function(c){ return c.name === AUTO_CATEGORY[j][1]; })) {
        return AUTO_CATEGORY[j][1];
      }
    }
    return null;
  }

  function guessGeneralMethod(text){
    if (/yape/i.test(text)) return 'Yape';
    if (/plin/i.test(text)) return 'Plin';
    if (/transfer/i.test(text)) return 'Transferencia';
    if (/d[eé]bito/i.test(text)) return 'Débito';
    return 'Otro';
  }

  // Ciclo de facturación actual de una tarjeta según su día de cierre.
  function currentCycle(card){
    var c = parseInt(card.closingDay, 10);
    if (!(c >= 1 && c <= 31)) return null;
    var now = new Date(); now.setHours(0, 0, 0, 0);
    function closing(y, m){ var last = new Date(y, m + 1, 0).getDate(); return new Date(y, m, Math.min(c, last)); }
    var thisClose = closing(now.getFullYear(), now.getMonth());
    var end, prevClose;
    if (now <= thisClose) {
      end = thisClose;
      prevClose = closing(now.getFullYear(), now.getMonth() - 1);
    } else {
      end = closing(now.getFullYear(), now.getMonth() + 1);
      prevClose = thisClose;
    }
    var start = new Date(prevClose); start.setDate(start.getDate() + 1);
    return { start: start, end: end };
  }

  var toastTimer;
  function toast(msg){
    var t = $('toast');
    t.textContent = msg;
    t.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function(){ t.classList.remove('show'); }, 2600);
  }

  // ---------- Render ----------

  function render(){
    var monthItems = state.expenses.filter(function(e){ return isSpend(e) && inMonth(e, viewYear, viewMonth); });
    if (currentTab === 'debts') { renderDebtHeader(); renderCards(); return; }
    renderHeader(monthItems);
    if (currentTab === 'expenses') renderExpenses(monthItems);
    else renderStats(monthItems);
  }

  function renderDebtHeader(){
    var tot = { PEN: 0, USD: 0, total: 0 }, owing = 0;
    state.cards.forEach(function(c){
      var d = cardDebt(c);
      if (d.PEN > 0) tot.PEN += d.PEN;
      if (d.USD > 0) tot.USD += d.USD;
      if (d.PEN > 0 || d.USD > 0) owing++;
    });
    tot.PEN = Math.round(tot.PEN * 100) / 100;
    $('debt-total').textContent = tot.USD && !tot.PEN ? fmt(tot.USD, 'USD') : fmt(tot.PEN, 'PEN');
    var sub = tot.USD && tot.PEN ? 'más ' + fmt(tot.USD, 'USD') + '\n' : '';
    var now = new Date();
    var paid = sums(state.expenses.filter(function(e){ return isPay(e) && inMonth(e, now.getFullYear(), now.getMonth()); }));
    sub += owing ? 'En ' + owing + (owing === 1 ? ' tarjeta' : ' tarjetas') : 'No debes nada en tus tarjetas ✅';
    if (paid.PEN || paid.USD) sub += ' · pagaste ' + sumText(paid) + ' este mes';
    $('debt-sub').textContent = sub;
  }

  function renderHeader(items){
    var ml = monthName(viewYear, viewMonth);
    $('month-label').textContent = ml.charAt(0).toUpperCase() + ml.slice(1);
    $('month-total-label').textContent = 'Gastado en ' + monthName(viewYear, viewMonth).split(' ')[0];
    var s = sums(items);
    $('month-total').textContent = fmt(s.total, 'PEN');
    var cardS = sums(items.filter(function(e){ return e.cardId; }));
    var genS = sums(items.filter(function(e){ return !e.cardId; }));
    var sub = 'Con tarjeta ' + fmt(cardS.total, 'PEN') + '  ·  Otros medios ' + fmt(genS.total, 'PEN');
    if (s.USD) sub += '\nIncluye ' + fmt(s.USD, 'USD') + ' (a S/ ' + state.rate + ')';
    $('month-sub').textContent = sub;

    var bar = $('budget-bar'), fill = $('budget-fill');
    if (state.budget) {
      var pct = s.total / state.budget * 100;
      bar.classList.remove('hidden');
      fill.style.width = Math.min(pct, 100) + '%';
      fill.className = pct >= 100 ? 'over' : pct >= 80 ? 'warn' : '';
      $('month-sub').textContent += '\nPresupuesto: ' + Math.round(pct) + '% de ' + fmt(state.budget, 'PEN');
    } else {
      bar.classList.add('hidden');
    }

    var n = new Date();
    $('next-month').disabled = viewYear === n.getFullYear() && viewMonth === n.getMonth();
  }

  function itemHTML(e){
    if (isDebt(e)) {
      return '<button class="item" data-id="' + e.id + '">' +
        '<span class="emoji">📌</span>' +
        '<span class="info"><div class="desc">Deuda anterior</div>' +
        '<div class="meta">💳 ' + esc(payLabel(e)) + (e.desc ? ' · ' + esc(e.desc) : '') + ' · no cuenta como gasto</div></span>' +
        '<span class="amt">' + fmt(e.amount, e.currency) + '</span></button>';
    }
    if (isPay(e)) {
      return '<button class="item" data-id="' + e.id + '">' +
        '<span class="emoji">💸</span>' +
        '<span class="info"><div class="desc">Pago de tarjeta</div>' +
        '<div class="meta">💳 ' + esc(payLabel(e)) + (e.desc ? ' · ' + esc(e.desc) : '') + '</div></span>' +
        '<span class="amt pay">− ' + fmt(e.amount, e.currency) + '</span></button>';
    }
    var meta = [];
    meta.push(e.cardId ? '💳 ' + esc(payLabel(e)) : (METHOD_ICONS[e.method] || '💰') + ' ' + esc(payLabel(e)));
    meta.push(esc(e.cat));
    if (e.installments > 1) meta.push(e.installments + ' cuotas');
    return '<button class="item" data-id="' + e.id + '">' +
      '<span class="emoji">' + catEmoji(e.cat) + '</span>' +
      '<span class="info"><div class="desc">' + esc(e.desc || e.cat) + '</div>' +
      '<div class="meta">' + meta.join(' · ') + '</div></span>' +
      '<span class="amt">' + fmt(e.amount, e.currency) + '</span></button>';
  }

  // En Deudas no se suma por día: mezclar consumos, deudas y pagos en un total confunde.
  function listHTML(items, noDaySum){
    var groups = {};
    items.slice().sort(function(a, b){
      return b.date.localeCompare(a.date) || (b.created || 0) - (a.created || 0);
    }).forEach(function(e){ (groups[e.date] = groups[e.date] || []).push(e); });
    return Object.keys(groups).sort().reverse().map(function(date){
      var list = groups[date];
      var label = parseISO(date).toLocaleDateString('es-PE', { weekday: 'long', day: 'numeric', month: 'short' });
      label = label.charAt(0).toUpperCase() + label.slice(1);
      if (date === todayISO()) label = 'Hoy';
      return '<div class="day-group"><div class="day-head"><span>' + esc(label) + '</span><span>' +
        (noDaySum ? '' : sumText(sums(list.filter(isSpend)))) + '</span></div><div class="day-card">' + list.map(itemHTML).join('') + '</div></div>';
    }).join('');
  }

  // Deudas no depende del mes que se mira en Gastos: es lo que se debe hoy.
  function renderCards(){
    var now = new Date();
    var cardItems = state.expenses.filter(function(e){ return e.cardId && isSpend(e) && inMonth(e, now.getFullYear(), now.getMonth()); });
    var cardAll = state.expenses.filter(function(e){ return e.cardId; });
    renderConvertBanner();

    $('card-summary').innerHTML = state.cards.map(function(card){
      var mine = cardItems.filter(function(e){ return e.cardId === card.id; });
      var s = sums(mine);
      var cyc = currentCycle(card), cycHTML = '';
      if (cyc) {
        var cs = sums(state.expenses.filter(function(e){
          if (e.cardId !== card.id || !isSpend(e)) return false;
          var d = parseISO(e.date);
          return d >= cyc.start && d <= cyc.end;
        }));
        var opts = { day: 'numeric', month: 'short' };
        cycHTML = '<div class="cc-cycle">Ciclo actual (cierra ' + cyc.end.toLocaleDateString('es-PE', opts) + '): <b>' +
          sumText(cs) + '</b></div>';
      }
      var debt = cardDebt(card), debtHTML;
      if (debt.PEN <= 0 && debt.USD <= 0) {
        var favor = { PEN: -debt.PEN, USD: -debt.USD, total: 0 };
        debtHTML = (favor.PEN || favor.USD) ? 'Saldo a favor<div class="cc-amt">' + sumText(favor) + '</div>'
          : 'Por pagar<div class="cc-amt">Nada ✅</div>';
      } else {
        debtHTML = 'Por pagar<div class="cc-amt">' + sumText({ PEN: Math.max(debt.PEN, 0), USD: Math.max(debt.USD, 0), total: 0 }) + '</div>';
      }
      return '<button class="cc" data-card="' + card.id + '" style="--cc:' + esc(card.color || CARD_COLORS[0]) + '">' +
        '<div class="cc-name">💳 ' + esc(card.name) + (card.last4 ? ' <span class="cc-last4">•••• ' + esc(card.last4) + '</span>' : '') + '</div>' +
        '<div class="cc-debt">' + debtHTML + '</div>' +
        '<div class="cc-month">Consumos de este mes: ' + sumText(s) + ' (' + mine.length + ')</div>' +
        cycHTML + '</button>';
    }).join('') || '<p class="empty">Agrega tus tarjetas en Opciones (⋮).</p>';

    var sel = $('card-filter'), cur = sel.value;
    sel.innerHTML = '<option value="">Todas las tarjetas</option>' + state.cards.map(function(c){
      return '<option value="' + c.id + '">' + esc(c.name) + '</option>';
    }).join('');
    sel.value = cardById(cur) ? cur : '';

    var shown = sel.value ? cardAll.filter(function(e){ return e.cardId === sel.value; }) : cardAll;
    $('card-list').innerHTML = listHTML(shown, true);
    $('card-empty').classList.toggle('hidden', shown.length > 0);
  }

  function renderExpenses(items){
    var sel = $('exp-filter'), cur = sel.value;
    var opts = '<option value="">Todos los medios de pago</option>' +
      '<option value="cards">💳 Solo tarjetas de crédito</option>' +
      state.cards.map(function(c){ return '<option value="card:' + c.id + '">💳 ' + esc(c.name) + '</option>'; }).join('') +
      GENERAL_METHODS.map(function(m){ return '<option value="gen:' + esc(m) + '">' + METHOD_ICONS[m] + ' ' + esc(m) + '</option>'; }).join('');
    sel.innerHTML = opts;
    sel.value = cur;
    if (sel.value !== cur) sel.value = '';

    var f = sel.value, q = $('search').value.trim().toLowerCase();
    var list = items.filter(function(e){
      if (f === 'cards') return !!e.cardId;
      if (f.indexOf('card:') === 0) return e.cardId === f.slice(5);
      if (f.indexOf('gen:') === 0) return !e.cardId && (e.method || 'Otro') === f.slice(4);
      return true;
    });
    if (q) list = list.filter(function(e){
      return (e.desc || '').toLowerCase().indexOf(q) >= 0 || e.cat.toLowerCase().indexOf(q) >= 0 ||
        payLabel(e).toLowerCase().indexOf(q) >= 0;
    });
    $('expense-list').innerHTML = listHTML(list);
    $('expense-empty').classList.toggle('hidden', list.length > 0);
  }

  function barsHTML(map, iconFn){
    var entries = Object.keys(map).map(function(k){ return [k, map[k]]; })
      .sort(function(a, b){ return b[1] - a[1]; });
    var total = entries.reduce(function(s, x){ return s + x[1]; }, 0);
    if (!entries.length) return '<p class="empty">Sin datos este mes.</p>';
    return entries.map(function(x){
      var pct = total ? x[1] / total * 100 : 0;
      return '<div class="bar-row"><div class="bar-top"><span>' + iconFn(x[0]) + ' ' + esc(x[0]) + '</span>' +
        '<span><span class="amt">' + fmt(x[1], 'PEN') + '</span><span class="pct">' + Math.round(pct) + '%</span></span></div>' +
        '<div class="bar"><div style="width:' + pct + '%"></div></div></div>';
    }).join('');
  }

  function renderStats(items){
    var byMethod = {}, byCat = {};
    items.forEach(function(e){
      var k = payLabel(e);
      byMethod[k] = (byMethod[k] || 0) + toPEN(e);
      byCat[e.cat] = (byCat[e.cat] || 0) + toPEN(e);
    });
    var cardNames = state.cards.map(function(c){ return c.name; });
    $('method-breakdown').innerHTML = barsHTML(byMethod, function(k){
      return cardNames.indexOf(k) >= 0 ? '💳' : (METHOD_ICONS[k] || '💰');
    });
    $('cat-breakdown').innerHTML = barsHTML(byCat, catEmoji);

    var cols = [];
    for (var i = 5; i >= 0; i--) {
      var d = new Date(viewYear, viewMonth - i, 1);
      var y = d.getFullYear(), m = d.getMonth();
      cols.push({ y: y, m: m, total: sums(state.expenses.filter(function(e){ return isSpend(e) && inMonth(e, y, m); })).total });
    }
    var max = Math.max.apply(null, cols.map(function(c){ return c.total; })) || 1;
    $('month-history').innerHTML = cols.map(function(c, idx){
      return '<div class="hcol' + (idx === 5 ? ' current' : '') + '">' +
        '<span class="hval">' + (c.total ? fmtShort(c.total) : '') + '</span>' +
        '<div class="hbar" style="height:' + (c.total / max * 100) + '%"></div>' +
        '<span class="hlab">' + esc(monthName(c.y, c.m, true).replace('.', '')) + '</span></div>';
    }).join('');
  }

  // ---------- Diálogo de pago ----------

  function renderKind(){
    var paying = !!selectedKind; // pago de tarjeta o deuda anterior: solo tarjetas, sin categoría
    document.querySelectorAll('#kind-picker [data-kind]').forEach(function(b){
      b.classList.toggle('selected', b.dataset.kind === (selectedKind || ''));
    });
    $('cat-field').classList.toggle('hidden', paying);
    $('installments-field').classList.toggle('hidden', paying);
    $('pay-label').textContent = selectedKind === 'cardPayment' ? '¿Qué tarjeta pagaste?'
      : selectedKind === 'cardDebt' ? '¿De qué tarjeta es la deuda?' : '¿Con qué pagaste?';
    $('f-desc').placeholder = selectedKind === 'cardPayment' ? 'Opcional: desde qué cuenta, nota…'
      : selectedKind === 'cardDebt' ? 'Opcional: ej. saldo al 12 de octubre' : 'Ej: Wong, Netflix, almuerzo…';
    $('dialog-title').textContent = (editingId ? 'Editar ' : 'Nuevo ') +
      (selectedKind ? KIND_LABEL[selectedKind].toLowerCase() : 'gasto');
    $('kind-hint').textContent = selectedKind === 'cardDebt'
      ? 'Lo que ya debías en la tarjeta antes de anotar aquí. Suma a "Por pagar" pero no cuenta como gasto del mes.'
      : selectedKind === 'cardPayment' ? 'Lo que pagaste de la tarjeta. Resta de "Por pagar" y no cuenta como gasto.' : '';
    if (paying && (!selectedPay || selectedPay.indexOf('card:') !== 0) && state.cards[0]) selectedPay = 'card:' + state.cards[0].id;
    renderPayPicker();
  }

  function renderPayPicker(){
    var paying = !!selectedKind;
    var html = state.cards.map(function(c){
      var v = 'card:' + c.id;
      return '<button type="button" class="chip' + (selectedPay === v ? ' selected' : '') + '" data-pay="' + v + '">💳 ' + esc(c.name) + '</button>';
    }).join('');
    if (!paying) html += GENERAL_METHODS.map(function(m){
      var v = 'gen:' + m;
      return '<button type="button" class="chip' + (selectedPay === v ? ' selected' : '') + '" data-pay="' + esc(v) + '">' + METHOD_ICONS[m] + ' ' + esc(m) + '</button>';
    }).join('');
    $('pay-picker').innerHTML = html;
  }

  function renderCatPicker(){
    $('cat-picker').innerHTML = state.categories.map(function(c){
      return '<button type="button" class="chip' + (c.name === selectedCat ? ' selected' : '') + '" data-cat="' + esc(c.name) + '">' +
        c.emoji + ' ' + esc(c.name) + '</button>';
    }).join('');
  }

  function renderSuggestions(){
    var seen = {};
    $('desc-suggestions').innerHTML = state.expenses.slice().reverse()
      .filter(function(e){
        if (!isSpend(e)) return false;
        var k = (e.desc || '').toLowerCase();
        if (!k || seen[k]) return false;
        seen[k] = 1; return true;
      })
      .slice(0, 40)
      .map(function(e){ return '<option value="' + esc(e.desc) + '">'; }).join('');
  }

  // prefill: { amount, currency, desc, date, cardId, method, cat, kind, raw, note }
  function openExpense(id, prefill){
    editingId = id || null;
    var e = id ? state.expenses.find(function(x){ return x.id === id; }) : null;
    var p = prefill || {};
    pendingRaw = e ? null : (p.raw || null);
    pendingSource = e ? null : (p.source || null);

    selectedKind = e ? (e.kind || null) : (p.kind || null);
    $('f-amount').value = e ? e.amount : (p.amount || '');
    $('f-currency').value = e ? (e.currency || 'PEN') : (p.currency || 'PEN');
    $('f-desc').value = e ? (e.desc || '') : (p.desc || '');
    $('f-date').value = e ? e.date : (p.date || todayISO());
    $('f-installments').value = e ? (e.installments || 1) : 1;

    if (e) {
      selectedPay = e.cardId ? 'card:' + e.cardId : 'gen:' + (e.method || 'Otro');
      selectedCat = e.cat;
    } else {
      if (p.cardId) selectedPay = 'card:' + p.cardId;
      else if (p.method) selectedPay = 'gen:' + p.method;
      else if (currentTab === 'debts' && state.cards[0]) selectedPay = 'card:' + ($('card-filter').value || state.cards[0].id);
      else selectedPay = lastPay();
      selectedCat = p.cat || guessCategory(p.desc) || state.categories[0].name;
    }

    var note = $('parsed-note');
    note.textContent = p.note || '';
    note.classList.toggle('hidden', !p.note);

    $('btn-delete').classList.toggle('hidden', !e);
    renderKind();
    renderCatPicker();
    renderSuggestions();
    $('expense-dialog').showModal();
    if (!e && !p.amount) setTimeout(function(){ $('f-amount').focus(); }, 50);
  }

  function lastPay(){
    for (var i = state.expenses.length - 1; i >= 0; i--) {
      var e = state.expenses[i];
      if (!isSpend(e)) continue;
      if (e.cardId && cardById(e.cardId)) return 'card:' + e.cardId;
      if (!e.cardId) return 'gen:' + (e.method || 'Otro');
    }
    return 'gen:Efectivo';
  }

  function readPay(){
    if (selectedPay && selectedPay.indexOf('card:') === 0) {
      var id = selectedPay.slice(5);
      return cardById(id) ? { cardId: id, method: null } : { cardId: null, method: 'Otro' };
    }
    return { cardId: null, method: selectedPay ? selectedPay.slice(4) : 'Efectivo' };
  }

  function addExpense(data){
    var e = Object.assign({ id: uid(), created: Date.now() }, data);
    state.expenses.push(e);
    expenseChanged(e);
    return e;
  }

  function goToMonthOf(dateISO){
    var d = parseISO(dateISO);
    viewYear = d.getFullYear(); viewMonth = d.getMonth();
  }

  // Los pagos de tarjeta viven en Deudas; todo lo demás es un gasto.
  function tabFor(e){ return isSpend(e) ? 'expenses' : 'debts'; }

  var lastGastosTab = 'expenses';

  function setTab(tab){
    currentTab = tab;
    var deudas = tab === 'debts';
    if (!deudas) lastGastosTab = tab;
    document.body.classList.toggle('mode-deudas', deudas);
    document.querySelectorAll('.mode').forEach(function(b){ b.classList.toggle('active', b.dataset.mode === (deudas ? 'deudas' : 'gastos')); });
    $('gastos-head').classList.toggle('hidden', deudas);
    $('deudas-head').classList.toggle('hidden', !deudas);
    $('gastos-tabs').classList.toggle('hidden', deudas);
    $('fab').setAttribute('aria-label', deudas ? 'Anotar pago de tarjeta' : 'Agregar gasto');
    document.querySelectorAll('.tab').forEach(function(b){ b.classList.toggle('active', b.dataset.tab === tab); });
    ['expenses', 'debts', 'stats'].forEach(function(t){ $('tab-' + t).classList.toggle('hidden', t !== tab); });
    render();
  }

  $('expense-form').addEventListener('submit', function(ev){
    ev.preventDefault();
    var amount = parseAmount($('f-amount').value);
    if (!amount) { toast('Escribe un monto válido'); $('f-amount').focus(); return; }
    var pay = readPay();
    var paying = !!selectedKind;
    if (paying && !pay.cardId) { toast('Elige la tarjeta'); return; }
    var data = {
      kind: selectedKind || null,
      amount: amount,
      currency: $('f-currency').value,
      cat: paying ? KIND_LABEL[selectedKind] : (selectedCat || 'Otros'),
      desc: $('f-desc').value.trim(),
      date: $('f-date').value || todayISO(),
      cardId: pay.cardId,
      method: pay.method,
      installments: paying ? 1 : Math.max(1, parseInt($('f-installments').value, 10) || 1)
    };
    if (editingId) {
      var e = state.expenses.find(function(x){ return x.id === editingId; });
      Object.assign(e, data);
      expenseChanged(e);
      toast('Pago actualizado');
    } else {
      var twin = sameDayTwin(data);
      if (twin && !confirm('Ya hay ' + (isSpend(twin) ? 'un gasto' : 'un registro de "' + KIND_LABEL[twin.kind] + '"') + ' de ' + fmt(twin.amount, twin.currency) +
          (twin.desc ? ' (' + twin.desc + ')' : '') + ' ese mismo día, quizá anotado desde una notificación.\n\n¿Es otro pago distinto y quieres guardarlo igual?')) return;
      if (pendingRaw) { data.raw = pendingRaw; data.source = pendingSource || 'manual'; }
      else data.source = 'manual';
      addExpense(data);
      toast('Pago guardado');
    }
    $('expense-dialog').close();
    goToMonthOf(data.date);
    setTab(tabFor(data));
  });

  $('btn-cancel').addEventListener('click', function(){ $('expense-dialog').close(); });

  $('btn-delete').addEventListener('click', function(){
    if (!editingId || !confirm('¿Eliminar este pago?')) return;
    var gone = state.expenses.find(function(x){ return x.id === editingId; });
    state.expenses = state.expenses.filter(function(x){ return x.id !== editingId; });
    expenseDeleted(gone);
    $('expense-dialog').close();
    toast('Pago eliminado');
    render();
  });

  $('kind-picker').addEventListener('click', function(ev){
    var b = ev.target.closest('[data-kind]');
    if (!b) return;
    selectedKind = b.dataset.kind || null;
    renderKind();
  });

  $('pay-picker').addEventListener('click', function(ev){
    var b = ev.target.closest('[data-pay]');
    if (!b) return;
    selectedPay = b.dataset.pay;
    renderPayPicker();
  });

  $('cat-picker').addEventListener('click', function(ev){
    var b = ev.target.closest('[data-cat]');
    if (!b) return;
    selectedCat = b.dataset.cat;
    renderCatPicker();
  });

  $('f-desc').addEventListener('change', function(){
    if (editingId) return;
    var g = guessCategory(this.value);
    if (g) { selectedCat = g; renderCatPicker(); }
  });

  // ---------- Notificaciones ----------

  function prefillFromText(text){
    var r = GastosParser.parseNotification(text, state.cards);
    var found = [];
    if (r.amount) found.push(fmt(r.amount, r.currency));
    if (r.isCardPayment) found.push('pago de tarjeta');
    if (r.cardId) found.push('💳 ' + cardById(r.cardId).name);
    if (r.merchant && !r.isCardPayment) found.push(r.merchant);
    return {
      result: r,
      prefill: {
        kind: r.isCardPayment ? 'cardPayment' : null,
        amount: r.amount,
        currency: r.currency,
        desc: r.isCardPayment ? '' : r.merchant,
        date: r.date ? isoDate(r.date) : todayISO(),
        cardId: r.cardId,
        method: r.cardId ? null : guessGeneralMethod(text),
        cat: guessCategory(r.merchant),
        raw: r.raw,
        note: found.length ? 'Detectado: ' + found.join(' · ') + '. Revisa y guarda.'
          : 'No se reconoció el monto; complétalo a mano.'
      }
    };
  }

  // ---------- Duplicados ----------
  // Un mismo pago suele avisarse varias veces: notificación del banco + correo
  // de Gmail + SMS, o Yape + la app del banco. Reglas:
  //  1. El mismo texto exacto en 24 h es la misma notificación repetida.
  //  2. Mismo tipo, monto y moneda, avisado por OTRA app dentro de 30 min y sin
  //     tarjetas distintas: es el mismo pago; el aviso nuevo solo completa datos.
  //  3. Si la MISMA app avisa dos veces el mismo monto con textos distintos,
  //     son dos pagos de verdad (ej. dos pasajes iguales) y se anotan los dos.
  var DUP_WINDOW_MS = 30 * 60 * 1000;

  function sameMoney(e, d){
    return (e.kind || null) === (d.kind || null) &&
      (e.currency || 'PEN') === (d.currency || 'PEN') &&
      Math.abs(e.amount - d.amount) < 0.005;
  }

  function findDuplicate(pf, source, at){
    var now = Date.now();
    for (var i = state.expenses.length - 1; i >= 0; i--) {
      var e = state.expenses[i];
      if (pf.raw && e.raw === pf.raw && now - (e.created || 0) < 24 * 3600 * 1000) return e;
    }
    for (var j = state.expenses.length - 1; j >= 0; j--) {
      var x = state.expenses[j];
      if (!sameMoney(x, pf)) continue;
      if (x.cardId && pf.cardId && x.cardId !== pf.cardId) continue;
      var sameSource = source && (x.sources || [x.source]).indexOf(source) >= 0;
      if (sameSource) continue;
      if (differentMerchant(x.desc, pf.desc)) continue;
      if (walletVsCard(x, pf) || walletVsCard(pf, x)) continue;
      var close = Math.abs((x.notifiedAt || x.created || 0) - at) <= DUP_WINDOW_MS;
      // un gasto anotado a mano ese mismo día también cuenta como el mismo pago
      var manualSameDay = x.source === 'manual' && x.date === pf.date;
      if (close || manualSameDay) return x;
    }
    return null;
  }

  function words(t){
    return normText(t).split(/[^a-z0-9]+/).filter(function(w){ return w.length >= 3; });
  }
  function normText(t){ return String(t || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, ''); }

  // "WONG SAN ISIDRO" y "E. WONG" comparten "wong": pueden ser el mismo pago. "WONG" y "TAMBO" no.
  function differentMerchant(a, b){
    if (!a || !b) return false;
    var wa = words(a), wb = words(b);
    if (!wa.length || !wb.length) return false;
    return !wa.some(function(w){ return wb.indexOf(w) >= 0; });
  }

  // Un pago con Yape/Plin y uno con tarjeta de crédito son pagos distintos.
  function walletVsCard(a, b){
    return !a.cardId && (a.method === 'Yape' || a.method === 'Plin') && !!b.cardId;
  }

  // Completa el gasto ya anotado con lo que traiga el aviso repetido.
  function mergeInto(e, pf, source){
    var changed = false;
    if (!e.desc && pf.desc) { e.desc = pf.desc; changed = true; if (e.cat === 'Otros' && pf.cat) e.cat = pf.cat; }
    if (!e.cardId && pf.cardId && cardById(pf.cardId) && (e.method === 'Otro' || isPay(e))) {
      e.cardId = pf.cardId; e.method = null; changed = true;
    }
    var srcs = e.sources || (e.source ? [e.source] : []);
    if (source && srcs.indexOf(source) < 0) { e.sources = srcs.concat(source); changed = true; }
    if (changed) expenseChanged(e);
  }

  function sameDayTwin(d){
    for (var i = state.expenses.length - 1; i >= 0; i--) {
      var e = state.expenses[i];
      if (e.date === d.date && sameMoney(e, d) && !(e.cardId && d.cardId && e.cardId !== d.cardId)) return e;
    }
    return null;
  }

  function handleIncoming(){
    var params = new URLSearchParams(location.search);
    var text = [params.get('title'), params.get('text'), params.get('url')].filter(Boolean).join(' ').trim();
    var monto = params.get('monto');
    if (!text && !monto) return;
    history.replaceState(null, '', location.pathname);

    var pf;
    if (text) {
      pf = prefillFromText(text).prefill;
    } else {
      // Parámetros directos: ?monto=45.9&moneda=USD&comercio=Wong&tarjeta=bcp
      var card = params.get('tarjeta');
      var cardId = card ? (cardById(card) ? card : GastosParser.parseNotification(card, state.cards).cardId) : null;
      var desc = params.get('comercio') || '';
      pf = {
        amount: parseAmount(monto),
        currency: /usd|\$|d[oó]lar/i.test(params.get('moneda') || '') ? 'USD' : 'PEN',
        desc: desc, date: todayISO(), cardId: cardId,
        method: cardId ? null : 'Otro', cat: guessCategory(desc),
        raw: 'monto=' + monto + '|' + desc + '|' + (card || '')
      };
    }

    if (params.get('auto') === '1' && pf.amount && !needsReview(pf)) {
      var e = autoSave(pf, params.get('fuente') || 'enlace');
      if (e.dup) { toast('Ese pago ya estaba anotado'); goToMonthOf(e.dup.date); setTab(tabFor(e.dup)); return; }
      goToMonthOf(e.date);
      setTab(tabFor(e));
      toast(isPay(e) ? 'Pago de tarjeta anotado: ' + fmt(e.amount, e.currency) + ' a ' + payLabel(e)
        : 'Anotado automáticamente: ' + fmt(e.amount, e.currency) + (e.desc ? ' en ' + e.desc : ''));
      return;
    }
    openExpense(null, pf);
  }

  // Un pago de tarjeta sin tarjeta reconocida no se puede restar de ninguna: se pregunta.
  function needsReview(pf){ return pf.kind === 'cardPayment' && !pf.cardId; }

  // Guarda sin preguntar. Si es un pago ya anotado (ver Duplicados) devuelve
  // { dup: gastoExistente } y solo completa sus datos.
  function autoSave(pf, source, at){
    at = at || Date.now();
    source = source || 'enlace';
    var dup = findDuplicate(pf, source, at);
    if (dup) { mergeInto(dup, pf, source); return { dup: dup }; }
    var base = { amount: pf.amount, currency: pf.currency, date: pf.date, installments: 1,
      raw: pf.raw, source: source, notifiedAt: at };
    if (pf.kind === 'cardPayment') {
      return addExpense(Object.assign(base, { kind: 'cardPayment', cat: 'Pago de tarjeta', desc: '', cardId: pf.cardId, method: null }));
    }
    return addExpense(Object.assign(base, { cat: pf.cat || 'Otros', desc: pf.desc || '',
      cardId: pf.cardId || null, method: pf.cardId ? null : (pf.method || 'Otro') }));
  }

  // ---------- APK: notificaciones leídas por la app nativa ----------

  var Native = window.AndroidGastos || null;

  function takeNativePending(){
    if (!Native) return;
    var list;
    try { list = JSON.parse(Native.takePending() || '[]'); } catch (e) { return; }
    var saved = [], dups = 0, review = null;
    list.forEach(function(item){
      // la cola trae { text, pkg, at } (versiones viejas: solo el texto)
      var text = typeof item === 'string' ? item : item.text;
      var source = typeof item === 'string' ? 'android' : item.pkg;
      var at = typeof item === 'string' ? Date.now() : item.at;
      var pf = prefillFromText(text).prefill;
      if (!pf.amount) return;
      if (!/\d{4}-\d{2}-\d{2}/.test(pf.date) || !GastosParser.parseNotification(text, []).date) pf.date = isoDate(new Date(at));
      if (needsReview(pf)) {
        if (!review && !findDuplicate(pf, source, at)) { review = pf; review.source = source; }
        return;
      }
      var e = autoSave(pf, source, at);
      if (e.dup) dups++; else saved.push(e);
    });
    if (review) openExpense(null, review);
    if (!saved.length) { if (dups) toast(dups === 1 ? 'Aviso repetido: ese pago ya estaba anotado' : dups + ' avisos repetidos ignorados'); return; }
    var last = saved[saved.length - 1];
    goToMonthOf(last.date);
    setTab(tabFor(last));
    var msg = saved.length === 1
      ? (isPay(last) ? 'Pago de tarjeta anotado: ' : 'Anotado: ') + fmt(last.amount, last.currency) + (last.desc ? ' en ' + last.desc : '')
      : saved.length + ' pagos anotados desde notificaciones';
    if (dups) msg += ' (' + dups + (dups === 1 ? ' aviso repetido ignorado)' : ' avisos repetidos ignorados)');
    toast(msg);
  }

  function refreshNativeNotif(){
    if (!Native) return;
    var on = Native.isNotificationAccessEnabled();
    $('native-notif-state').textContent = on
      ? '✅ Activado: los avisos de consumo se anotan solos.'
      : '⚠️ Desactivado.';
    $('btn-native-notif').textContent = on ? 'Ajustes de acceso a notificaciones' : 'Activar lectura de notificaciones';
  }

  if (Native) {
    $('native-notif').classList.remove('hidden');
    $('macrodroid-field').classList.add('hidden');
    $('btn-native-notif').addEventListener('click', function(){ Native.openNotificationAccessSettings(); });
    // MainActivity dispara este evento al volver a la app y cuando llega una notificación con la app abierta.
    window.addEventListener('gastosresume', function(){ takeNativePending(); refreshNativeNotif(); });
  }

  $('btn-paste').addEventListener('click', function(){
    $('paste-text').value = '';
    $('paste-dialog').showModal();
    if (navigator.clipboard && navigator.clipboard.readText) {
      navigator.clipboard.readText().then(function(t){
        if (t && !$('paste-text').value) $('paste-text').value = t;
      }).catch(function(){});
    }
  });
  $('btn-paste-cancel').addEventListener('click', function(){ $('paste-dialog').close(); });
  $('paste-form').addEventListener('submit', function(ev){
    ev.preventDefault();
    var text = $('paste-text').value.trim();
    if (!text) return;
    $('paste-dialog').close();
    openExpense(null, prefillFromText(text).prefill);
  });

  // ---------- Opciones ----------

  function renderCardsEditor(){
    $('cards-editor').innerHTML = state.cards.map(function(c){
      return '<div class="card-edit" data-id="' + c.id + '">' +
        '<div class="row tight"><input data-k="name" value="' + esc(c.name) + '" placeholder="Nombre">' +
        '<input data-k="color" type="color" value="' + esc(c.color || CARD_COLORS[0]) + '" aria-label="Color">' +
        '<button type="button" class="btn small danger" data-del="' + c.id + '" aria-label="Eliminar tarjeta">✕</button></div>' +
        '<div class="row tight"><input data-k="last4" value="' + esc(c.last4 || '') + '" placeholder="Últimos 4" inputmode="numeric" maxlength="4">' +
        '<input data-k="closingDay" value="' + esc(c.closingDay || '') + '" placeholder="Día cierre" inputmode="numeric" maxlength="2"></div>' +
        '<input data-k="keywords" value="' + esc(c.keywords || '') + '" placeholder="Palabras clave (ej: bcp, platinum)">' +
        '<input data-k="startDebt" value="' + esc(c.startDebt || '') + '" placeholder="Deuda actual al empezar, en S/ (opcional)" inputmode="decimal">' +
        '</div>';
    }).join('');
  }

  function readCardsEditor(){
    document.querySelectorAll('.card-edit').forEach(function(row){
      var card = cardById(row.dataset.id);
      if (!card) return;
      row.querySelectorAll('[data-k]').forEach(function(inp){ card[inp.dataset.k] = inp.value.trim(); });
      card.last4 = card.last4.replace(/\D/g, '').slice(0, 4);
      var cd = parseInt(card.closingDay, 10);
      card.closingDay = cd >= 1 && cd <= 31 ? String(cd) : '';
      var sd = parseAmount(card.startDebt);
      card.startDebt = sd ? String(sd) : '';
      if (!card.name) card.name = 'Tarjeta';
    });
  }

  function autoUrl(){
    return location.origin + location.pathname + '?auto=1&text=';
  }

  $('btn-menu').addEventListener('click', function(){
    $('s-rate').value = state.rate;
    $('s-budget').value = state.budget || '';
    $('s-newcat').value = '';
    $('auto-url').textContent = autoUrl() + '[texto de la notificación]';
    renderCardsEditor();
    $('menu-dialog').showModal();
  });

  $('cards-editor').addEventListener('click', function(ev){
    var b = ev.target.closest('[data-del]');
    if (!b) return;
    var card = cardById(b.dataset.del);
    var used = state.expenses.filter(function(e){ return e.cardId === card.id; }).length;
    if (!confirm('¿Eliminar la tarjeta ' + card.name + '?' + (used ? ' Sus ' + used + ' consumos quedarán como "Tarjeta eliminada".' : ''))) return;
    readCardsEditor();
    state.cards = state.cards.filter(function(c){ return c.id !== card.id; });
    settingsChanged();
    renderCardsEditor();
  });

  $('btn-addcard').addEventListener('click', function(){
    readCardsEditor();
    state.cards.push({ id: uid(), name: 'Nueva tarjeta', last4: '', closingDay: '', keywords: '',
      color: CARD_COLORS[state.cards.length % CARD_COLORS.length] });
    settingsChanged();
    renderCardsEditor();
    var inputs = document.querySelectorAll('.card-edit [data-k="name"]');
    var last = inputs[inputs.length - 1];
    if (last) { last.focus(); last.select(); }
  });

  $('btn-copy-url').addEventListener('click', function(){
    var url = autoUrl();
    if (navigator.clipboard) navigator.clipboard.writeText(url).then(function(){ toast('Enlace copiado'); });
    else prompt('Copia este enlace:', url);
  });

  $('btn-save-settings').addEventListener('click', function(){
    readCardsEditor();
    var rate = parseAmount($('s-rate').value);
    if (rate) state.rate = rate;
    state.budget = parseAmount($('s-budget').value);
    settingsChanged();
    $('menu-dialog').close();
    render();
  });

  $('btn-addcat').addEventListener('click', function(){
    var name = $('s-newcat').value.trim();
    if (!name) return;
    if (state.categories.some(function(c){ return c.name.toLowerCase() === name.toLowerCase(); })) {
      toast('Esa categoría ya existe'); return;
    }
    state.categories.splice(state.categories.length - 1, 0, { name: name, emoji: '🏷️' });
    settingsChanged();
    $('s-newcat').value = '';
    toast('Categoría "' + name + '" agregada');
  });

  function download(filename, content, type){
    if (Native) {
      if (Native.saveFile(filename, content, type)) toast('Guardado en Descargas: ' + filename);
      else toast('No se pudo guardar el archivo');
      return;
    }
    var blob = new Blob([content], { type: type });
    var a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    setTimeout(function(){ URL.revokeObjectURL(a.href); a.remove(); }, 1000);
  }

  $('btn-export-csv').addEventListener('click', function(){
    var rows = [['Fecha', 'Tipo', 'Tarjeta / medio', 'Categoría', 'Descripción', 'Moneda', 'Monto', 'Cuotas']];
    state.expenses.slice().sort(function(a, b){ return a.date.localeCompare(b.date); }).forEach(function(e){
      rows.push([e.date, KIND_LABEL[e.kind] || (e.cardId ? 'Tarjeta de crédito' : 'General'), payLabel(e), e.cat, e.desc || '',
        e.currency || 'PEN', e.amount.toFixed(2), e.installments || 1]);
    });
    var csv = rows.map(function(r){
      return r.map(function(v){ return '"' + String(v).replace(/"/g, '""') + '"'; }).join(';');
    }).join('\r\n');
    download('gastos-' + todayISO() + '.csv', '﻿' + csv, 'text/csv;charset=utf-8');
  });

  $('btn-export-json').addEventListener('click', function(){
    var copy = Object.assign({}, state, { deleted: [] });
    download('gastos-backup-' + todayISO() + '.json', JSON.stringify(copy, null, 1), 'application/json');
  });

  $('import-file').addEventListener('change', function(){
    var file = this.files[0];
    if (!file) return;
    var reader = new FileReader();
    reader.onload = function(){
      try {
        var data = JSON.parse(reader.result);
        if (!Array.isArray(data.expenses)) throw new Error('formato');
        if (!confirm('Esto reemplazará tus datos actuales por la copia (' + data.expenses.length + ' pagos). ¿Continuar?')) return;
        // Los pagos que ya estaban en el servidor y no vienen en la copia se borran allá también.
        var keep = {};
        data.expenses.forEach(function(e){ keep[e.id] = 1; });
        var deleted = state.deleted.concat(state.expenses
          .filter(function(e){ return e.synced && !keep[e.id]; })
          .map(function(e){ return e.id; }));
        localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
        state = load();
        state.deleted = deleted;
        state.expenses.forEach(function(e){ e.synced = false; });
        state.settingsUpdated = Date.now();
        save();
        if (cloud) cloud.resync();
        $('menu-dialog').close();
        render();
        toast('Copia restaurada');
      } catch (e) {
        toast('Archivo no válido');
      }
    };
    reader.readAsText(file);
    this.value = '';
  });

  // ---------- Navegación ----------

  $('prev-month').addEventListener('click', function(){
    viewMonth--; if (viewMonth < 0) { viewMonth = 11; viewYear--; }
    render();
  });
  $('next-month').addEventListener('click', function(){
    viewMonth++; if (viewMonth > 11) { viewMonth = 0; viewYear++; }
    render();
  });

  document.querySelectorAll('.tab').forEach(function(b){
    b.addEventListener('click', function(){ setTab(b.dataset.tab); });
  });

  $('search').addEventListener('input', render);
  $('card-filter').addEventListener('change', render);
  $('exp-filter').addEventListener('change', render);

  $('card-summary').addEventListener('click', function(ev){
    var b = ev.target.closest('[data-card]');
    if (!b) return;
    var sel = $('card-filter');
    sel.value = sel.value === b.dataset.card ? '' : b.dataset.card;
    render();
  });

  document.addEventListener('click', function(ev){
    var item = ev.target.closest('.item');
    if (item) openExpense(item.dataset.id);
  });

  $('fab').addEventListener('click', function(){
    openExpense(null, currentTab === 'debts' ? { kind: 'cardPayment' } : null);
  });

  document.querySelectorAll('.mode').forEach(function(b){
    b.addEventListener('click', function(){ setTab(b.dataset.mode === 'deudas' ? 'debts' : lastGastosTab); });
  });

  // ---------- Registros que parecen deudas anotadas como gasto ----------
  // Ej.: "Tarjeta de credito" S/ 3,232 anotado como consumo, cuando era lo que ya se debía.
  var DISMISS_KEY = 'mis-gastos-no-son-deudas';
  function dismissed(){ try { return JSON.parse(localStorage.getItem(DISMISS_KEY)) || []; } catch (e) { return []; } }

  function debtLookalikes(){
    var no = dismissed();
    return state.expenses.filter(function(e){
      return isSpend(e) && e.cardId && no.indexOf(e.id) < 0 &&
        /tarjeta\s+de\s+cr[eé]dito|deuda|saldo|estado de cuenta/i.test(e.desc || '');
    });
  }

  function renderConvertBanner(){
    var list = debtLookalikes();
    $('convert-banner').classList.toggle('hidden', !list.length);
    if (!list.length) return;
    var total = sums(list);
    $('convert-text').textContent = (list.length === 1 ? 'Hay 1 registro que parece' : 'Hay ' + list.length + ' registros que parecen') +
      ' lo que ya debías en tus tarjetas, pero está anotado como gasto (' + sumText(total) + ', ej. "' + list[0].desc + '" en ' +
      payLabel(list[0]) + '). Por eso "Gastado" sale tan alto. ¿Son deudas anteriores?';
  }

  $('btn-convert').addEventListener('click', function(){
    var list = debtLookalikes();
    list.forEach(function(e){ e.kind = 'cardDebt'; e.cat = KIND_LABEL.cardDebt; expenseChanged(e); });
    toast(list.length + (list.length === 1 ? ' registro pasó' : ' registros pasaron') + ' a Deuda anterior: ya no cuentan como gasto');
    render();
  });

  $('btn-convert-no').addEventListener('click', function(){
    var ids = dismissed().concat(debtLookalikes().map(function(e){ return e.id; }));
    try { localStorage.setItem(DISMISS_KEY, JSON.stringify(ids)); } catch (e) {}
    render();
  });

  // Puente para sync.js
  window.GastosApp = {
    getState: function(){ return state; },
    save: save,
    render: render,
    toast: toast,
    registerCloud: function(c){ cloud = c; }
  };

  setTab('expenses');
  handleIncoming();
  takeNativePending();
  refreshNativeNotif();
})();
