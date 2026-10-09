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
    [/luz del sur|enel|sedapal|calidda|movistar|claro|entel|bitel|win|internet|agua|gas natural/i, 'Servicios'],
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
      budget: null
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
        budget: s.budget > 0 ? s.budget : null
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
  var viewYear, viewMonth; // mes que se está viendo
  var currentTab = 'cards';
  var editingId = null;
  var selectedCat = null;
  var selectedPay = null; // 'card:<id>' | 'gen:<método>'
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
      if (e.desc && e.desc.trim().toLowerCase() === key) return e.cat;
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
    var monthItems = state.expenses.filter(function(e){ return inMonth(e, viewYear, viewMonth); });
    renderHeader(monthItems);
    if (currentTab === 'cards') renderCards(monthItems);
    else if (currentTab === 'general') renderGeneral(monthItems);
    else renderStats(monthItems);
  }

  function renderHeader(items){
    var ml = monthName(viewYear, viewMonth);
    $('month-label').textContent = ml.charAt(0).toUpperCase() + ml.slice(1);
    var s = sums(items);
    $('month-total').textContent = fmt(s.total, 'PEN');
    var cardS = sums(items.filter(function(e){ return e.cardId; }));
    var genS = sums(items.filter(function(e){ return !e.cardId; }));
    var sub = '💳 ' + fmt(cardS.total, 'PEN') + '  ·  💵 ' + fmt(genS.total, 'PEN');
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

  function listHTML(items){
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
        sumText(sums(list)) + '</span></div><div class="day-card">' + list.map(itemHTML).join('') + '</div></div>';
    }).join('');
  }

  function renderCards(items){
    var cardItems = items.filter(function(e){ return e.cardId; });

    $('card-summary').innerHTML = state.cards.map(function(card){
      var mine = cardItems.filter(function(e){ return e.cardId === card.id; });
      var s = sums(mine);
      var cyc = currentCycle(card), cycHTML = '';
      if (cyc) {
        var cs = sums(state.expenses.filter(function(e){
          if (e.cardId !== card.id) return false;
          var d = parseISO(e.date);
          return d >= cyc.start && d <= cyc.end;
        }));
        var opts = { day: 'numeric', month: 'short' };
        cycHTML = '<div class="cc-cycle">Ciclo actual (cierra ' + cyc.end.toLocaleDateString('es-PE', opts) + '): <b>' +
          sumText(cs) + '</b></div>';
      }
      return '<button class="cc" data-card="' + card.id + '" style="--cc:' + esc(card.color || CARD_COLORS[0]) + '">' +
        '<div class="cc-name">💳 ' + esc(card.name) + (card.last4 ? ' <span class="cc-last4">•••• ' + esc(card.last4) + '</span>' : '') + '</div>' +
        '<div class="cc-amt">' + sumText(s) + '</div>' +
        '<div class="cc-count">' + mine.length + (mine.length === 1 ? ' consumo' : ' consumos') + ' en el mes</div>' +
        cycHTML + '</button>';
    }).join('') || '<p class="empty">Agrega tus tarjetas en Opciones (⋮).</p>';

    var sel = $('card-filter'), cur = sel.value;
    sel.innerHTML = '<option value="">Todas las tarjetas</option>' + state.cards.map(function(c){
      return '<option value="' + c.id + '">' + esc(c.name) + '</option>';
    }).join('');
    sel.value = cardById(cur) ? cur : '';

    var shown = sel.value ? cardItems.filter(function(e){ return e.cardId === sel.value; }) : cardItems;
    $('card-list').innerHTML = listHTML(shown);
    $('card-empty').classList.toggle('hidden', shown.length > 0);
  }

  function renderGeneral(items){
    var q = $('search').value.trim().toLowerCase();
    var list = items.filter(function(e){ return !e.cardId; });
    if (q) list = list.filter(function(e){
      return (e.desc || '').toLowerCase().indexOf(q) >= 0 || e.cat.toLowerCase().indexOf(q) >= 0 ||
        (e.method || '').toLowerCase().indexOf(q) >= 0;
    });
    $('general-list').innerHTML = listHTML(list);
    $('general-empty').classList.toggle('hidden', list.length > 0);
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
      cols.push({ y: y, m: m, total: sums(state.expenses.filter(function(e){ return inMonth(e, y, m); })).total });
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

  function renderPayPicker(){
    var html = state.cards.map(function(c){
      var v = 'card:' + c.id;
      return '<button type="button" class="chip' + (selectedPay === v ? ' selected' : '') + '" data-pay="' + v + '">💳 ' + esc(c.name) + '</button>';
    }).join('');
    html += GENERAL_METHODS.map(function(m){
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
        var k = (e.desc || '').toLowerCase();
        if (!k || seen[k]) return false;
        seen[k] = 1; return true;
      })
      .slice(0, 40)
      .map(function(e){ return '<option value="' + esc(e.desc) + '">'; }).join('');
  }

  // prefill: { amount, currency, desc, date, cardId, method, cat, raw, note }
  function openExpense(id, prefill){
    editingId = id || null;
    var e = id ? state.expenses.find(function(x){ return x.id === id; }) : null;
    var p = prefill || {};
    pendingRaw = e ? null : (p.raw || null);

    $('dialog-title').textContent = e ? 'Editar pago' : 'Nuevo pago';
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
      else selectedPay = currentTab === 'general' ? 'gen:Efectivo'
        : 'card:' + (($('card-filter').value) || (state.cards[0] ? state.cards[0].id : ''));
      if (selectedPay === 'card:') selectedPay = 'gen:Efectivo';
      selectedCat = p.cat || guessCategory(p.desc) || state.categories[0].name;
    }

    var note = $('parsed-note');
    note.textContent = p.note || '';
    note.classList.toggle('hidden', !p.note);

    $('btn-delete').classList.toggle('hidden', !e);
    renderPayPicker();
    renderCatPicker();
    renderSuggestions();
    $('expense-dialog').showModal();
    if (!e && !p.amount) setTimeout(function(){ $('f-amount').focus(); }, 50);
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
    save();
    return e;
  }

  function goToMonthOf(dateISO){
    var d = parseISO(dateISO);
    viewYear = d.getFullYear(); viewMonth = d.getMonth();
  }

  function setTab(tab){
    currentTab = tab;
    document.querySelectorAll('.tab').forEach(function(b){ b.classList.toggle('active', b.dataset.tab === tab); });
    ['cards', 'general', 'stats'].forEach(function(t){ $('tab-' + t).classList.toggle('hidden', t !== tab); });
    render();
  }

  $('expense-form').addEventListener('submit', function(ev){
    ev.preventDefault();
    var amount = parseAmount($('f-amount').value);
    if (!amount) { toast('Escribe un monto válido'); $('f-amount').focus(); return; }
    var pay = readPay();
    var data = {
      amount: amount,
      currency: $('f-currency').value,
      cat: selectedCat || 'Otros',
      desc: $('f-desc').value.trim(),
      date: $('f-date').value || todayISO(),
      cardId: pay.cardId,
      method: pay.method,
      installments: Math.max(1, parseInt($('f-installments').value, 10) || 1)
    };
    if (editingId) {
      var e = state.expenses.find(function(x){ return x.id === editingId; });
      Object.assign(e, data);
      save();
      toast('Pago actualizado');
    } else {
      if (pendingRaw) data.raw = pendingRaw;
      addExpense(data);
      toast('Pago guardado');
    }
    $('expense-dialog').close();
    goToMonthOf(data.date);
    setTab(data.cardId ? 'cards' : 'general');
  });

  $('btn-cancel').addEventListener('click', function(){ $('expense-dialog').close(); });

  $('btn-delete').addEventListener('click', function(){
    if (!editingId || !confirm('¿Eliminar este pago?')) return;
    state.expenses = state.expenses.filter(function(x){ return x.id !== editingId; });
    save();
    $('expense-dialog').close();
    toast('Pago eliminado');
    render();
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
    if (r.cardId) found.push('💳 ' + cardById(r.cardId).name);
    if (r.merchant) found.push(r.merchant);
    return {
      result: r,
      prefill: {
        amount: r.amount,
        currency: r.currency,
        desc: r.merchant,
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

  // Evita guardar dos veces la misma notificación (MacroDroid puede dispararse repetido).
  function isDuplicate(raw){
    var limit = Date.now() - 10 * 60 * 1000;
    return state.expenses.some(function(e){ return e.raw === raw && (e.created || 0) > limit; });
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

    if (params.get('auto') === '1' && pf.amount) {
      if (isDuplicate(pf.raw)) { toast('Ese pago ya estaba anotado'); return; }
      var e = addExpense({
        amount: pf.amount, currency: pf.currency, cat: pf.cat || 'Otros', desc: pf.desc || '',
        date: pf.date, cardId: pf.cardId || null, method: pf.cardId ? null : (pf.method || 'Otro'),
        installments: 1, raw: pf.raw
      });
      goToMonthOf(e.date);
      setTab(e.cardId ? 'cards' : 'general');
      toast('Anotado automáticamente: ' + fmt(e.amount, e.currency) + (e.desc ? ' en ' + e.desc : ''));
      return;
    }
    openExpense(null, pf);
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
    save();
    renderCardsEditor();
  });

  $('btn-addcard').addEventListener('click', function(){
    readCardsEditor();
    state.cards.push({ id: uid(), name: 'Nueva tarjeta', last4: '', closingDay: '', keywords: '',
      color: CARD_COLORS[state.cards.length % CARD_COLORS.length] });
    save();
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
    save();
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
    save();
    $('s-newcat').value = '';
    toast('Categoría "' + name + '" agregada');
  });

  function download(filename, content, type){
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
      rows.push([e.date, e.cardId ? 'Tarjeta de crédito' : 'General', payLabel(e), e.cat, e.desc || '',
        e.currency || 'PEN', e.amount.toFixed(2), e.installments || 1]);
    });
    var csv = rows.map(function(r){
      return r.map(function(v){ return '"' + String(v).replace(/"/g, '""') + '"'; }).join(';');
    }).join('\r\n');
    download('gastos-' + todayISO() + '.csv', '﻿' + csv, 'text/csv;charset=utf-8');
  });

  $('btn-export-json').addEventListener('click', function(){
    download('gastos-backup-' + todayISO() + '.json', JSON.stringify(state, null, 1), 'application/json');
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
        localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
        state = load();
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

  $('fab').addEventListener('click', function(){ openExpense(null); });

  setTab('cards');
  handleIncoming();
})();
