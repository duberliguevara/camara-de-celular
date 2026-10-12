// Logica de la conversacion. No sabe nada de WhatsApp: recibe un mensaje
// (texto, ubicacion, imagen...) de un chat y devuelve que responder, si hay
// que avisarle al dueño y si se genero un pedido. Asi se puede probar en la
// consola con `npm run simular` sin conectar ningun celular.

const { estaAbierto, horarioDeHoy, textoHorario } = require('./horario');

const PALABRAS_HUMANO = ['asesor', 'humano', 'persona', 'operador', 'encargado', 'hablar con alguien'];
const PALABRAS_MENU = ['menu', 'inicio', 'empezar', 'reiniciar'];

function normalizar(texto) {
  return (texto || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[¡!¿?.]/g, '')
    .trim();
}

function soles(monto) {
  return `S/ ${monto.toFixed(2)}`;
}

function contiene(texto, palabras) {
  return palabras.some((p) => texto === p || texto.includes(p));
}

class Motor {
  constructor(config, opciones = {}) {
    this.config = config;
    this.ahora = opciones.ahora || (() => new Date());
    this.sesiones = {};
    this.contadorPedidos = 0;
    // Catalogo aplanado con numeracion global (1..n) por negocio.
    this.productos = {};
    for (const negocio of config.negocios) {
      const lista = [];
      for (const cat of negocio.catalogo) {
        for (const p of cat.productos) lista.push({ ...p, categoria: cat.categoria });
      }
      this.productos[negocio.id] = lista;
    }
  }

  // ---------- Estado persistente ----------

  exportar() {
    return { sesiones: this.sesiones, contadorPedidos: this.contadorPedidos };
  }

  importar(datos) {
    if (!datos) return;
    this.sesiones = datos.sesiones || {};
    this.contadorPedidos = datos.contadorPedidos || 0;
  }

  sesion(chatId) {
    if (!this.sesiones[chatId]) {
      this.sesiones[chatId] = {
        estado: 'inicio',
        negocioId: null,
        carritos: {},
        pedido: {},
        nombre: null,
        telefono: null,
        ultimaActividad: 0,
        pausadoHasta: 0,
      };
    }
    return this.sesiones[chatId];
  }

  // ---------- Atencion humana ----------

  pausar(chatId, horas = this.config.pausaAtencionHumanaHoras) {
    this.sesion(chatId).pausadoHasta = this.ahora().getTime() + horas * 3600 * 1000;
  }

  reanudar(chatId) {
    const s = this.sesion(chatId);
    s.pausadoHasta = 0;
    s.estado = 'inicio';
  }

  estaPausado(chatId) {
    const s = this.sesiones[chatId];
    return !!s && s.pausadoHasta > this.ahora().getTime();
  }

  // ---------- Entrada principal ----------

  // mensaje: { tipo: 'texto'|'ubicacion'|'imagen'|'audio'|'otro', texto, ubicacion: {lat, lng, descripcion}, nombrePerfil, telefono }
  // Devuelve { respuestas: string[], notificacion: string|null, pedido: object|null }
  procesar(chatId, mensaje) {
    const r = { respuestas: [], notificacion: null, pedido: null };
    const texto = normalizar(mensaje.texto);
    if (this.estaPausado(chatId)) {
      // Mientras atiende una persona el bot calla, salvo que el cliente pida el menu.
      if (!PALABRAS_MENU.includes(texto)) return r;
      this.reanudar(chatId);
    }

    const s = this.sesion(chatId);
    const ahora = this.ahora().getTime();
    const expira = (this.config.reiniciarConversacionTrasMinutos || 120) * 60 * 1000;
    if (s.ultimaActividad && ahora - s.ultimaActividad > expira) {
      s.estado = 'inicio';
      s.carritos = {};
      s.pedido = {};
    }
    s.ultimaActividad = ahora;
    if (mensaje.telefono) s.telefono = mensaje.telefono;
    if (mensaje.nombrePerfil && !s.nombrePerfil) s.nombrePerfil = mensaje.nombrePerfil;

    // Despues de confirmar un pedido el bot se queda tranquilo: el cliente
    // suele mandar la captura del Yape o preguntar algo que responde el dueño.
    if (s.estado === 'pedido_hecho') {
      if (contiene(texto, PALABRAS_MENU)) return this.bienvenida(s, r);
      if (mensaje.tipo === 'imagen') {
        r.respuestas.push('¡Gracias! 🙌 Recibimos tu imagen. Si es tu comprobante de pago lo revisamos y te confirmamos en breve.');
        r.notificacion = `🧾 El cliente del pedido *#${s.ultimoPedido}* (${this.contacto(s, chatId)}) envió una imagen (¿comprobante de pago?). Revisa el chat.`;
        return r;
      }
      if (!s.avisoPostPedido) {
        s.avisoPostPedido = true;
        r.respuestas.push(`Tu pedido *#${s.ultimoPedido}* ya está en proceso 🛵. En un momento te responde una persona del equipo.\n\nSi quieres hacer *otro pedido*, escribe *menu*.`);
      }
      return r;
    }

    if (mensaje.tipo === 'audio') {
      r.respuestas.push('Por ahora no puedo escuchar audios 🙏. Escríbeme por favor, o escribe *asesor* para hablar con una persona.');
      return r;
    }

    // En los pasos de texto libre (nombre, direccion, notas) solo se toman las
    // palabras exactas, para que "para una persona" no cuente como pedir asesor.
    const textoLibre = ['nombre', 'direccion', 'notas'].includes(s.estado);
    if (textoLibre ? PALABRAS_HUMANO.includes(texto) : contiene(texto, PALABRAS_HUMANO)) return this.pasarAHumano(chatId, s, r);
    if (textoLibre ? PALABRAS_MENU.includes(texto) : contiene(texto, PALABRAS_MENU)) return this.bienvenida(s, r);

    switch (s.estado) {
      case 'inicio':
        return this.bienvenida(s, r, texto);
      case 'elegir_negocio':
        return this.elegirNegocio(chatId, s, r, texto);
      case 'menu_negocio':
        return this.menuNegocio(chatId, s, r, texto);
      case 'pidiendo':
        return this.pidiendo(s, r, texto);
      case 'nombre':
        return this.pedirNombre(s, r, mensaje);
      case 'direccion':
        return this.pedirDireccion(s, r, mensaje);
      case 'zona':
        return this.pedirZona(s, r, texto);
      case 'pago':
        return this.pedirPago(s, r, texto);
      case 'notas':
        return this.pedirNotas(s, r, mensaje);
      case 'confirmar':
        return this.confirmar(chatId, s, r, texto);
      default:
        return this.bienvenida(s, r);
    }
  }

  // ---------- Pasos ----------

  bienvenida(s, r, texto = '') {
    // Si el primer mensaje ya menciona el negocio, saltamos directo a su menu.
    const directo = this.detectarNegocio(texto);
    if (directo) {
      s.negocioId = directo.id;
      s.estado = 'menu_negocio';
      r.respuestas.push(this.textoMenuNegocio(directo));
      return r;
    }
    const nombre = s.nombre || s.nombrePerfil;
    const lineas = this.config.negocios.map((n, i) => `*${i + 1}.* ${n.emoji} ${n.nombre}`);
    lineas.push(`*${this.config.negocios.length + 1}.* 👤 Hablar con una persona`);
    s.estado = 'elegir_negocio';
    r.respuestas.push(
      `¡Hola${nombre ? ` ${nombre}` : ''}! 👋 Bienvenido(a).\n` +
      `Somos ${this.config.negocios.map((n) => `*${n.nombre}*`).join(' y ')} en Tarapoto, con *delivery* a tu puerta 🛵\n\n` +
      `¿Dónde quieres pedir hoy? Responde con el número:\n${lineas.join('\n')}`
    );
    return r;
  }

  detectarNegocio(texto) {
    if (!texto) return null;
    if (contiene(texto, ['pucacha', 'market', 'tienda', 'abarrote', 'minimarket'])) {
      return this.config.negocios.find((n) => n.id === 'pucacha');
    }
    if (contiene(texto, ['adita', 'helad', 'corazon', 'cremolada'])) {
      return this.config.negocios.find((n) => n.id === 'adita');
    }
    return null;
  }

  elegirNegocio(chatId, s, r, texto) {
    const n = parseInt(texto, 10);
    let negocio = null;
    if (n >= 1 && n <= this.config.negocios.length) negocio = this.config.negocios[n - 1];
    else if (n === this.config.negocios.length + 1) return this.pasarAHumano(chatId, s, r);
    else negocio = this.detectarNegocio(texto);

    if (!negocio) {
      r.respuestas.push(`No te entendí 😅. Responde solo con el número, por ejemplo *1*.\n\n` + this.config.negocios.map((x, i) => `*${i + 1}.* ${x.emoji} ${x.nombre}`).join('\n') + `\n*${this.config.negocios.length + 1}.* 👤 Hablar con una persona`);
      return r;
    }
    s.negocioId = negocio.id;
    s.estado = 'menu_negocio';
    r.respuestas.push(this.textoMenuNegocio(negocio));
    return r;
  }

  negocio(s) {
    return this.config.negocios.find((n) => n.id === s.negocioId);
  }

  textoAbierto(negocio) {
    const fecha = this.ahora();
    return estaAbierto(negocio.horario, fecha, this.config.zonaHoraria)
      ? `🟢 *Abierto ahora* (hoy de ${horarioDeHoy(negocio.horario, fecha, this.config.zonaHoraria)})`
      : `🔴 *Cerrado ahora* (hoy: ${horarioDeHoy(negocio.horario, fecha, this.config.zonaHoraria)}). Puedes dejar tu pedido y lo atendemos apenas abramos.`;
  }

  textoMenuNegocio(negocio) {
    return (
      `${negocio.emoji} *${negocio.nombre}*\n${negocio.descripcion}\n${this.textoAbierto(negocio)}\n\n` +
      `¿Qué deseas? Responde con el número:\n` +
      `*1.* 🧾 Ver productos y hacer pedido\n` +
      `*2.* 🕒 Horario y ubicación\n` +
      `*3.* 🛵 Zonas y costo de delivery\n` +
      `*4.* 💳 Formas de pago\n` +
      `*5.* 👤 Hablar con una persona\n` +
      `*0.* ↩️ Volver al inicio`
    );
  }

  menuNegocio(chatId, s, r, texto) {
    const negocio = this.negocio(s);
    let opcion = texto;
    if (contiene(texto, ['catalogo', 'carta', 'producto', 'pedir', 'pedido', 'precio', 'comprar', 'sabores'])) opcion = '1';
    else if (contiene(texto, ['horario', 'hora', 'ubicacion', 'direccion', 'donde', 'abierto'])) opcion = '2';
    else if (contiene(texto, ['delivery', 'zona', 'envio', 'costo'])) opcion = '3';
    else if (contiene(texto, ['pago', 'yape', 'plin', 'tarjeta', 'efectivo'])) opcion = '4';

    switch (opcion) {
      case '1':
        s.estado = 'pidiendo';
        r.respuestas.push(this.textoCatalogo(negocio));
        if (this.carrito(s).length) r.respuestas.push(this.textoCarrito(s));
        return r;
      case '2':
        r.respuestas.push(
          `🕒 *Horario de ${negocio.nombre}*\n${textoHorario(negocio.horario)}\n\n` +
          `📍 *Dirección:* ${negocio.direccion}\n🗺️ ${negocio.linkMapa}\n\n` + this.pieMenu()
        );
        return r;
      case '3':
        r.respuestas.push(this.textoDelivery(negocio) + '\n\n' + this.pieMenu());
        return r;
      case '4':
        r.respuestas.push(`💳 *Formas de pago*\n${this.metodosPago(negocio).map((m) => `• ${m.etiqueta}${m.detalle ? `: ${m.detalle}` : ''}`).join('\n')}\n\n` + this.pieMenu());
        return r;
      case '5':
        return this.pasarAHumano(chatId, s, r);
      case '0':
        return this.bienvenida(s, r);
      default:
        r.respuestas.push('No te entendí 😅. Responde con un número del menú:\n\n' + this.textoMenuNegocio(negocio));
        return r;
    }
  }

  pieMenu() {
    return 'Escribe *1* para ver productos y pedir, o *0* para volver al inicio.';
  }

  textoDelivery(negocio) {
    const d = negocio.delivery;
    const zonas = d.zonas.map((z) => `• ${z.nombre}: ${z.costo == null ? 'a consultar' : soles(z.costo)}`).join('\n');
    return `🛵 *Delivery de ${negocio.nombre}*\n${zonas}\n\n⏱️ Tiempo estimado: ${d.tiempoEstimado}\n🧺 Pedido mínimo: ${soles(d.pedidoMinimo)}`;
  }

  metodosPago(negocio) {
    const p = negocio.pagos;
    const lista = [];
    if (p.efectivo) lista.push({ id: 'efectivo', etiqueta: '💵 Efectivo', detalle: 'contra entrega (dinos con cuánto pagas si necesitas vuelto)' });
    if (p.yape) lista.push({ id: 'yape', etiqueta: '📱 Yape', detalle: p.yape });
    if (p.plin) lista.push({ id: 'plin', etiqueta: '📱 Plin', detalle: p.plin });
    if (p.tarjeta) lista.push({ id: 'tarjeta', etiqueta: '💳 Tarjeta', detalle: p.tarjeta });
    return lista;
  }

  textoCatalogo(negocio) {
    let i = 0;
    const bloques = negocio.catalogo.map((cat) => {
      const items = cat.productos.map((p) => `*${++i}.* ${p.nombre} — ${soles(p.precio)}`).join('\n');
      return `*${cat.categoria}*\n${items}`;
    });
    const sabores = negocio.sabores ? `\n\n🍨 *Sabores:* ${negocio.sabores.join(', ')}\n(Los sabores nos los indicas al final del pedido)` : '';
    return (
      `${negocio.emoji} *Productos de ${negocio.nombre}*\n\n${bloques.join('\n\n')}${sabores}\n\n` +
      `✍️ *Para pedir* escribe el número del producto y la cantidad. Ejemplo: *3 x2* (dos del producto 3).\n` +
      `Puedes pedir varios a la vez: *1 x2, 5, 7 x3*\n\n` +
      `*listo* = terminar pedido · *carrito* = ver tu pedido · *quitar 3* = quitar el producto 3 · *borrar* = vaciar · *0* = volver`
    );
  }

  carrito(s) {
    if (!s.carritos[s.negocioId]) s.carritos[s.negocioId] = [];
    return s.carritos[s.negocioId];
  }

  subtotal(s) {
    const productos = this.productos[s.negocioId];
    return this.carrito(s).reduce((t, it) => t + productos[it.indice].precio * it.cantidad, 0);
  }

  lineasCarrito(s) {
    const productos = this.productos[s.negocioId];
    return this.carrito(s)
      .map((it) => `• ${it.cantidad} x ${productos[it.indice].nombre} — ${soles(productos[it.indice].precio * it.cantidad)}`)
      .join('\n');
  }

  textoCarrito(s) {
    if (!this.carrito(s).length) return '🧺 Tu carrito está vacío. Escribe el número del producto que quieres, por ejemplo *2*.';
    return `🧺 *Tu pedido:*\n${this.lineasCarrito(s)}\n*Subtotal: ${soles(this.subtotal(s))}*\n\nSigue agregando o escribe *listo* para terminar.`;
  }

  pidiendo(s, r, texto) {
    const negocio = this.negocio(s);
    const productos = this.productos[negocio.id];

    if (texto === '0' || texto === 'volver') {
      s.estado = 'menu_negocio';
      r.respuestas.push(this.textoMenuNegocio(negocio));
      return r;
    }
    if (contiene(texto, ['carrito', 'ver pedido', 'mi pedido'])) {
      r.respuestas.push(this.textoCarrito(s));
      return r;
    }
    if (contiene(texto, ['catalogo', 'productos', 'carta', 'lista'])) {
      r.respuestas.push(this.textoCatalogo(negocio));
      return r;
    }
    if (texto === 'borrar' || texto === 'vaciar') {
      s.carritos[negocio.id] = [];
      r.respuestas.push('🗑️ Listo, vacié tu carrito. Escribe el número del producto que quieres.');
      return r;
    }
    const quitar = texto.match(/^(?:quitar|eliminar|sacar)\s+(\d+)$/);
    if (quitar) {
      const indice = Number(quitar[1]) - 1;
      s.carritos[negocio.id] = this.carrito(s).filter((it) => it.indice !== indice);
      r.respuestas.push(this.textoCarrito(s));
      return r;
    }
    if (contiene(texto, ['listo', 'eso es todo', 'nada mas', 'terminar', 'finalizar', 'ya esta'])) {
      return this.terminarCarrito(s, r);
    }

    // Formatos aceptados por item: "3", "3x2", "3 x 2", "3*2", "3 por 2". Items separados por coma, ";", "y" o salto de linea.
    const partes = texto.split(/[,;\n]|\sy\s/).map((p) => p.trim()).filter(Boolean);
    const agregados = [];
    const errores = [];
    for (const parte of partes) {
      const m = parte.match(/^(\d+)\s*(?:(?:x|\*|por)\s*(\d+)\s*(?:unidades|unid|und|u)?)?$/);
      if (!m) {
        errores.push(parte);
        continue;
      }
      const indice = Number(m[1]) - 1;
      const cantidad = m[2] ? Number(m[2]) : 1;
      if (!productos[indice] || cantidad < 1 || cantidad > 99) {
        errores.push(parte);
        continue;
      }
      const existente = this.carrito(s).find((it) => it.indice === indice);
      if (existente) existente.cantidad += cantidad;
      else this.carrito(s).push({ indice, cantidad });
      agregados.push(`${cantidad} x ${productos[indice].nombre}`);
    }

    if (!agregados.length) {
      r.respuestas.push(
        `No te entendí 😅. Escribe el *número* del producto (del 1 al ${productos.length}) y, si quieres, la cantidad: por ejemplo *3 x2*.\n` +
        `Escribe *listo* para terminar, *catalogo* para ver la lista otra vez o *asesor* para hablar con una persona.`
      );
      return r;
    }
    let msg = `✅ Agregado: ${agregados.join(', ')}`;
    if (errores.length) msg += `\n⚠️ No reconocí: ${errores.join(', ')}`;
    r.respuestas.push(`${msg}\n\n${this.textoCarrito(s)}`);
    return r;
  }

  terminarCarrito(s, r) {
    const negocio = this.negocio(s);
    if (!this.carrito(s).length) {
      r.respuestas.push('🧺 Tu carrito está vacío. Escribe el número del producto que quieres, por ejemplo *2*.');
      return r;
    }
    const minimo = negocio.delivery.pedidoMinimo || 0;
    if (this.subtotal(s) < minimo) {
      r.respuestas.push(`El pedido mínimo para delivery es *${soles(minimo)}* y llevas *${soles(this.subtotal(s))}*. Agrega algo más 🙏`);
      return r;
    }
    s.pedido = {};
    s.estado = 'nombre';
    r.respuestas.push(
      s.nombre
        ? `¡Perfecto! 🙌 ¿El pedido va a nombre de *${s.nombre}*? Responde *si* o escribe otro nombre.`
        : '¡Perfecto! 🙌 ¿A nombre de quién va el pedido?'
    );
    return r;
  }

  pedirNombre(s, r, mensaje) {
    const texto = (mensaje.texto || '').trim();
    const t = normalizar(texto);
    if (s.nombre && ['si', 'ok', 'yes', 'dale', 'correcto', 'claro'].includes(t)) {
      s.pedido.nombre = s.nombre;
    } else if (texto.length >= 2 && texto.length <= 60) {
      s.pedido.nombre = texto;
      s.nombre = texto;
    } else {
      r.respuestas.push('Escríbeme tu nombre por favor 🙂');
      return r;
    }
    s.estado = 'direccion';
    r.respuestas.push('📍 ¿A dónde te lo llevamos?\nEscribe tu *dirección con una referencia* (ej: Jr. Lima 123, frente al parque) o comparte tu *ubicación* desde WhatsApp (📎 → Ubicación).');
    return r;
  }

  pedirDireccion(s, r, mensaje) {
    if (mensaje.tipo === 'ubicacion' && mensaje.ubicacion) {
      s.pedido.ubicacion = mensaje.ubicacion;
      s.pedido.direccion = mensaje.ubicacion.descripcion || s.pedido.direccion || null;
    } else {
      const texto = (mensaje.texto || '').trim();
      if (texto.length < 5) {
        r.respuestas.push('Necesito tu dirección con una referencia 🙏 (o comparte tu ubicación desde WhatsApp: 📎 → Ubicación).');
        return r;
      }
      s.pedido.direccion = texto;
    }
    s.estado = 'zona';
    const negocio = this.negocio(s);
    const zonas = negocio.delivery.zonas.map((z, i) => `*${i + 1}.* ${z.nombre} — ${z.costo == null ? 'a consultar' : soles(z.costo)}`).join('\n');
    r.respuestas.push(`🛵 ¿En qué zona estás? Responde con el número:\n${zonas}`);
    return r;
  }

  pedirZona(s, r, texto) {
    const negocio = this.negocio(s);
    const zonas = negocio.delivery.zonas;
    const n = parseInt(texto, 10);
    let zona = n >= 1 && n <= zonas.length ? zonas[n - 1] : zonas.find((z) => normalizar(z.nombre).includes(texto) && texto.length >= 4);
    if (!zona) {
      r.respuestas.push(`Responde con el número de tu zona (del 1 al ${zonas.length}) 🙏`);
      return r;
    }
    s.pedido.zona = zona;
    s.estado = 'pago';
    const metodos = this.metodosPago(negocio);
    r.respuestas.push(`💳 ¿Cómo vas a pagar? Responde con el número:\n${metodos.map((m, i) => `*${i + 1}.* ${m.etiqueta}`).join('\n')}`);
    return r;
  }

  pedirPago(s, r, texto) {
    const negocio = this.negocio(s);
    const metodos = this.metodosPago(negocio);
    const n = parseInt(texto, 10);
    const metodo = n >= 1 && n <= metodos.length ? metodos[n - 1] : metodos.find((m) => texto.includes(m.id));
    if (!metodo) {
      r.respuestas.push(`Responde con el número de la forma de pago (del 1 al ${metodos.length}) 🙏`);
      return r;
    }
    s.pedido.pago = metodo;
    s.estado = 'notas';
    let pregunta = '📝 ¿Alguna indicación para tu pedido?';
    if (negocio.sabores) pregunta += `\n🍨 *Dinos los sabores* de tus helados. Disponibles: ${negocio.sabores.join(', ')}.`;
    if (metodo.id === 'efectivo') pregunta += '\n💵 Si necesitas vuelto, dinos con cuánto vas a pagar.';
    pregunta += '\n\nSi no tienes indicaciones escribe *no*.';
    r.respuestas.push(pregunta);
    return r;
  }

  pedirNotas(s, r, mensaje) {
    const texto = (mensaje.texto || '').trim();
    const t = normalizar(texto);
    s.pedido.notas = !texto || ['no', 'ninguna', 'nada', 'ninguno', 'no gracias'].includes(t) ? '' : texto;
    s.estado = 'confirmar';
    r.respuestas.push(this.resumen(s) + '\n\n¿Está todo bien?\n*1.* ✅ Confirmar pedido\n*2.* ✏️ Cambiar productos\n*3.* ❌ Cancelar');
    return r;
  }

  resumen(s, paraDueno = false) {
    const negocio = this.negocio(s);
    const p = s.pedido;
    const sub = this.subtotal(s);
    const costo = p.zona.costo;
    const total = costo == null ? `${soles(sub)} + delivery (te confirmamos el costo)` : soles(sub + costo);
    const lineas = [
      `${negocio.emoji} *${negocio.nombre}*`,
      '',
      this.lineasCarrito(s),
      '',
      `Subtotal: ${soles(sub)}`,
      `Delivery (${p.zona.nombre}): ${costo == null ? 'a consultar' : soles(costo)}`,
      `*Total: ${total}*`,
      '',
      `👤 ${p.nombre}`,
    ];
    if (p.direccion) lineas.push(`📍 ${p.direccion}`);
    if (p.ubicacion) lineas.push(`🗺️ https://maps.google.com/?q=${p.ubicacion.lat},${p.ubicacion.lng}`);
    lineas.push(`💳 ${p.pago.etiqueta.replace(/^\S+\s/, '')}`);
    if (p.notas) lineas.push(`📝 ${p.notas}`);
    if (paraDueno) lineas.unshift('');
    return lineas.join('\n');
  }

  confirmar(chatId, s, r, texto) {
    const negocio = this.negocio(s);
    if (texto === '2' || contiene(texto, ['cambiar', 'modificar', 'editar'])) {
      s.estado = 'pidiendo';
      r.respuestas.push(this.textoCarrito(s) + '\n\nPuedes agregar más (ej: *3 x2*), quitar (ej: *quitar 3*) o escribir *listo*.');
      return r;
    }
    if (texto === '3' || contiene(texto, ['cancelar', 'anular'])) {
      s.carritos[negocio.id] = [];
      s.pedido = {};
      s.estado = 'inicio';
      r.respuestas.push('❌ Pedido cancelado. Cuando quieras escríbenos de nuevo 😊');
      return r;
    }
    if (!(texto === '1' || contiene(texto, ['confirmar', 'confirmo']) || ['si', 'ok', 'dale', 'correcto', 'si confirmo'].includes(texto))) {
      r.respuestas.push('Responde *1* para confirmar, *2* para cambiar productos o *3* para cancelar.');
      return r;
    }

    const numero = ++this.contadorPedidos;
    const fecha = this.ahora();
    const abierto = estaAbierto(negocio.horario, fecha, this.config.zonaHoraria);
    const productos = this.productos[negocio.id];
    r.pedido = {
      numero,
      fecha: fecha.toISOString(),
      negocio: negocio.nombre,
      chatId,
      telefono: s.telefono,
      nombre: s.pedido.nombre,
      direccion: s.pedido.direccion || null,
      ubicacion: s.pedido.ubicacion || null,
      zona: s.pedido.zona.nombre,
      costoDelivery: s.pedido.zona.costo,
      pago: s.pedido.pago.id,
      notas: s.pedido.notas,
      items: this.carrito(s).map((it) => ({ producto: productos[it.indice].nombre, precio: productos[it.indice].precio, cantidad: it.cantidad })),
      subtotal: this.subtotal(s),
      total: s.pedido.zona.costo == null ? null : this.subtotal(s) + s.pedido.zona.costo,
      fueraDeHorario: !abierto,
    };
    r.notificacion =
      `🔔 *NUEVO PEDIDO #${numero}*${abierto ? '' : ' (llegó FUERA DE HORARIO)'}\n` +
      `📞 ${this.contacto(s, chatId)}\n` +
      this.resumen(s, true);

    let respuesta = `🎉 ¡Gracias ${s.pedido.nombre}! Tu pedido *#${numero}* fue recibido.\n`;
    respuesta += abierto
      ? `⏱️ Llega en aprox. *${negocio.delivery.tiempoEstimado}*.`
      : `🕒 Ahora estamos cerrados; lo preparamos apenas abramos (hoy: ${horarioDeHoy(negocio.horario, fecha, this.config.zonaHoraria)}).`;
    if (s.pedido.pago.id === 'yape' || s.pedido.pago.id === 'plin') {
      respuesta += `\n\n📱 Puedes pagar por ${s.pedido.pago.etiqueta.replace(/^\S+\s/, '')} al *${s.pedido.pago.detalle}* y enviarnos aquí la *captura* 🙏`;
    }
    if (s.pedido.zona.costo == null) respuesta += '\n\n🛵 En breve te confirmamos el costo del delivery a tu zona.';
    respuesta += '\n\nCualquier consulta escríbenos por aquí. ¡Gracias por tu preferencia! 💛';
    r.respuestas.push(respuesta);

    s.carritos[negocio.id] = [];
    s.ultimoPedido = numero;
    s.avisoPostPedido = false;
    s.estado = 'pedido_hecho';
    return r;
  }

  contacto(s, chatId) {
    if (s.telefono) return `+${s.telefono} (wa.me/${s.telefono})`;
    return chatId;
  }

  pasarAHumano(chatId, s, r) {
    const negocio = this.negocio(s);
    r.respuestas.push('👤 ¡Claro! Te comunico con una persona del equipo, en un momento te responde. 🙌\n(Si quieres volver al menú automático escribe *menu* más tarde.)');
    r.notificacion = `🙋 Un cliente pide hablar con una persona${negocio ? ` (${negocio.nombre})` : ''}: ${this.contacto(s, chatId)}${s.nombrePerfil ? ` — ${s.nombrePerfil}` : ''}`;
    s.estado = 'inicio';
    this.pausar(chatId);
    return r;
  }
}

module.exports = { Motor, normalizar };
