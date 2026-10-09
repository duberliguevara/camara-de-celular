// Lee el texto de una notificación / SMS / correo del banco y extrae
// monto, moneda, comercio, fecha y la tarjeta usada.
(function(root){

  // "1,234.56" -> 1234.56 ; "1.234,56" -> 1234.56 ; "45,90" -> 45.9 ; "1,234" -> 1234
  function parseNumber(raw){
    var s = String(raw).replace(/\s/g, '');
    var lastDot = s.lastIndexOf('.'), lastComma = s.lastIndexOf(',');
    if (lastDot >= 0 && lastComma >= 0) {
      if (lastComma > lastDot) s = s.replace(/\./g, '').replace(',', '.');
      else s = s.replace(/,/g, '');
    } else if (lastComma >= 0) {
      var dec = s.length - lastComma - 1;
      s = (dec === 3 && s.indexOf(',') === lastComma) ? s.replace(',', '') : s.replace(/,/g, '.');
      // varias comas = miles
      if ((s.match(/\./g) || []).length > 1) s = s.replace(/\./g, '');
    } else if (lastDot >= 0 && (s.match(/\./g) || []).length > 1) {
      s = s.replace(/\./g, '');
    }
    var n = parseFloat(s);
    return isFinite(n) ? n : null;
  }

  var AMOUNT_RE = /(S\/\.?|PEN|US\$|USD|\$)\s*([0-9][0-9.,]*[0-9]|[0-9])/i;
  var AMOUNT_AFTER_RE = /([0-9][0-9.,]*[0-9]|[0-9])\s*(soles|d[oó]lares|PEN|USD)\b/i;

  function findAmount(text){
    var m = text.match(AMOUNT_RE);
    if (m) {
      var sym = m[1].toUpperCase();
      return { amount: parseNumber(m[2]), currency: (sym.indexOf('S/') === 0 || sym === 'PEN') ? 'PEN' : 'USD' };
    }
    m = text.match(AMOUNT_AFTER_RE);
    if (m) {
      var w = m[2].toLowerCase();
      return { amount: parseNumber(m[1]), currency: (w === 'soles' || w === 'pen') ? 'PEN' : 'USD' };
    }
    return null;
  }

  // Comercio: lo que viene después de " en " / " a " / "comercio:" hasta un corte natural.
  function findMerchant(text){
    var patterns = [
      /comercio\s*:?\s*([^\n.;|]{2,50})/i,
      /establecimiento\s*:?\s*([^\n.;|]{2,50})/i,
      /\ben\s+(?!(?:tu|su|la|el|l[ao]s)\s+tarjeta)([A-Z0-9][^\n;|]{1,50})/,
      /\ben\s+([^\n;|]{2,50})/i,
      /(?:S\/\.?|US\$|\$)\s*[0-9][0-9.,]*\s+a\s+([^\n;|]{2,50})/i
    ];
    for (var i = 0; i < patterns.length; i++) {
      var m = text.match(patterns[i]);
      if (!m) continue;
      var s = m[1]
        .split(/\s+(?:el\s+d[ií]a|el\s+\d|con\s+tu|con\s+su|con\s+la|por\s+(?:S\/|US\$|\$)|a\s+las|fecha|hora|monto|tarjeta|operaci[oó]n|si\s+no)\b/i)[0]
        .split(/\s+\d{1,2}[\/-]\d{1,2}([\/-]\d{2,4})?/)[0]
        .replace(/[.,:\s]+$/, '')
        .replace(/\s+(el|del|de|a|en|con|por)$/i, '')
        .trim();
      if (s.length >= 2 && !/^(S\/|US\$|\$)/.test(s)) return s;
    }
    return '';
  }

  // Fecha dd/mm(/aaaa) dentro del texto; si no hay, null (se usa hoy).
  function findDate(text, now){
    var m = text.match(/\b(\d{1,2})[\/-](\d{1,2})(?:[\/-](\d{2,4}))?\b/);
    if (!m) return null;
    var d = +m[1], mo = +m[2], y = m[3] ? +m[3] : now.getFullYear();
    if (y < 100) y += 2000;
    if (d < 1 || d > 31 || mo < 1 || mo > 12) return null;
    var date = new Date(y, mo - 1, d);
    // sin año y quedó en el futuro -> era del año pasado
    if (!m[3] && date > now) date.setFullYear(y - 1);
    return date;
  }

  function normalize(s){
    return String(s).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
  }

  // Devuelve el id de la tarjeta cuya palabra clave / últimos 4 dígitos
  // aparece en el texto. Gana la que más coincidencias tiene.
  function findCard(text, cards){
    var t = normalize(text);
    var best = null, bestScore = 0;
    (cards || []).forEach(function(card){
      var score = 0;
      if (card.last4 && new RegExp('\\b' + card.last4 + '\\b').test(text)) score += 5;
      var words = String(card.keywords || card.name || '').split(',');
      words.forEach(function(w){
        w = normalize(w).trim();
        if (!w) return;
        var re = new RegExp('(^|[^a-z0-9])' + w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '($|[^a-z0-9])');
        if (re.test(t)) score += w.length >= 3 ? 2 : 1;
      });
      if (score > bestScore) { bestScore = score; best = card.id; }
    });
    return best;
  }

  function looksLikeCredit(text){
    return /cr[eé]dito|tarjeta|visa|mastercard|amex|consumo|compra/i.test(text);
  }

  function parseNotification(text, cards, now){
    now = now || new Date();
    text = String(text || '').replace(/\s+/g, ' ').trim();
    var amt = findAmount(text);
    return {
      amount: amt ? amt.amount : null,
      currency: amt ? amt.currency : 'PEN',
      merchant: findMerchant(text),
      date: findDate(text, now),
      cardId: findCard(text, cards),
      isCredit: looksLikeCredit(text),
      raw: text
    };
  }

  var api = { parseNotification: parseNotification, parseNumber: parseNumber };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.GastosParser = api;
})(this);
