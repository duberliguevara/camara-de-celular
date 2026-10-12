// Conecta el bot a WhatsApp (tambien WhatsApp Business) escaneando un QR,
// igual que WhatsApp Web: en el celular ve a  ⋮ / Configuración → Dispositivos
// vinculados → Vincular un dispositivo, y escanea el QR que aparece aquí.

const fs = require('fs');
const path = require('path');
const { Client, LocalAuth } = require('whatsapp-web.js');
const qrTerminal = require('qrcode-terminal');
const QRCode = require('qrcode');
const { Motor } = require('./flujo');

const RAIZ = path.join(__dirname, '..');
const DATOS = path.join(RAIZ, 'datos');
const ARCHIVO_SESIONES = path.join(DATOS, 'sesiones.json');
const ARCHIVO_PEDIDOS = path.join(DATOS, 'pedidos.json');
const ARCHIVO_QR = path.join(RAIZ, 'qr.png');

fs.mkdirSync(DATOS, { recursive: true });

const config = JSON.parse(fs.readFileSync(path.join(RAIZ, 'negocios.json'), 'utf8'));
avisarSiFaltaEditar(config);

const motor = new Motor(config);
if (fs.existsSync(ARCHIVO_SESIONES)) {
  try {
    motor.importar(JSON.parse(fs.readFileSync(ARCHIVO_SESIONES, 'utf8')));
  } catch (e) {
    console.warn('No pude leer datos/sesiones.json, empiezo de cero:', e.message);
  }
}

let guardadoPendiente = null;
function guardarSesiones() {
  clearTimeout(guardadoPendiente);
  guardadoPendiente = setTimeout(() => {
    fs.writeFileSync(ARCHIVO_SESIONES, JSON.stringify(motor.exportar(), null, 2));
  }, 1000);
}

function guardarPedido(pedido) {
  const pedidos = fs.existsSync(ARCHIVO_PEDIDOS) ? JSON.parse(fs.readFileSync(ARCHIVO_PEDIDOS, 'utf8')) : [];
  pedidos.push(pedido);
  fs.writeFileSync(ARCHIVO_PEDIDOS, JSON.stringify(pedidos, null, 2));
}

const client = new Client({
  authStrategy: new LocalAuth({ dataPath: path.join(RAIZ, '.sesion-whatsapp') }),
  puppeteer: {
    headless: true,
    executablePath: process.env.CHROME_PATH || undefined,
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
  },
});

client.on('qr', async (qr) => {
  console.log('\n📱 Escanea este QR con el WhatsApp Business del negocio:');
  console.log('   ⋮ / Configuración → Dispositivos vinculados → Vincular un dispositivo\n');
  qrTerminal.generate(qr, { small: true });
  try {
    await QRCode.toFile(ARCHIVO_QR, qr, { width: 400 });
    console.log(`\n(Si el QR de arriba se ve mal, abre la imagen: ${ARCHIVO_QR})`);
  } catch (_) {
    // si no se pudo guardar la imagen, igual queda el QR de la consola
  }
});

client.on('authenticated', () => console.log('🔐 Sesión vinculada.'));
client.on('auth_failure', (m) => console.error('❌ Falló la vinculación:', m, '\nBorra la carpeta .sesion-whatsapp y vuelve a escanear.'));
client.on('ready', () => {
  if (fs.existsSync(ARCHIVO_QR)) fs.unlinkSync(ARCHIVO_QR);
  console.log('✅ Bot conectado y respondiendo mensajes. Deja esta ventana abierta.');
});
client.on('disconnected', (motivo) => {
  console.error('⚠️ WhatsApp se desconectó:', motivo, '— reintentando en 10 s...');
  setTimeout(() => client.initialize().catch((e) => console.error(e)), 10000);
});

// Textos que el bot mandó y aún no vio volver por 'message_create'. Sirve para
// distinguir los mensajes del bot de los que escribe una persona desde el celular.
const enviadosPorBot = new Map();

async function enviar(chatId, texto) {
  const pendientes = enviadosPorBot.get(chatId) || [];
  pendientes.push(texto);
  enviadosPorBot.set(chatId, pendientes);
  await client.sendMessage(chatId, texto);
}

function esChatIgnorado(chatId) {
  return !chatId || chatId.endsWith('@g.us') || chatId === 'status@broadcast' || chatId.endsWith('@newsletter') || chatId.endsWith('@broadcast');
}

// Cuando alguien del negocio responde a mano desde el celular, el bot se
// calla en ese chat por unas horas para no interrumpir. Escribiendo "#bot"
// en el chat se reactiva al toque.
client.on('message_create', async (msg) => {
  if (!msg.fromMe || esChatIgnorado(msg.to)) return;
  const pendientes = enviadosPorBot.get(msg.to);
  const i = pendientes ? pendientes.indexOf(msg.body) : -1;
  if (i !== -1) {
    pendientes.splice(i, 1);
    return;
  }
  const destino = msg.to;
  if (msg.body.trim().toLowerCase() === '#bot') {
    motor.reanudar(destino);
    console.log(`🤖 Bot reactivado en ${destino}`);
  } else if (!esNotificacion(destino)) {
    motor.pausar(destino);
    console.log(`👤 Respuesta manual en ${destino}: bot en pausa ${config.pausaAtencionHumanaHoras} h`);
  }
  guardarSesiones();
});

function esNotificacion(chatId) {
  return config.notificarPedidosA.some((n) => chatId === `${n}@c.us`);
}

client.on('message', async (msg) => {
  try {
    if (msg.fromMe || esChatIgnorado(msg.from) || esNotificacion(msg.from)) return;

    const contacto = await msg.getContact().catch(() => null);
    const mensaje = {
      tipo: tipoDeMensaje(msg),
      texto: msg.type === 'chat' ? msg.body : msg.body || '',
      nombrePerfil: contacto && (contacto.pushname || contacto.name),
      telefono: contacto && contacto.number,
    };
    if (msg.type === 'location' && msg.location) {
      mensaje.ubicacion = {
        lat: msg.location.latitude,
        lng: msg.location.longitude,
        descripcion: msg.location.description || msg.location.address || null,
      };
    }

    const r = motor.procesar(msg.from, mensaje);
    guardarSesiones();

    for (const texto of r.respuestas) await enviar(msg.from, texto);
    if (r.pedido) {
      guardarPedido(r.pedido);
      console.log(`🧾 Pedido #${r.pedido.numero} (${r.pedido.negocio}) de ${r.pedido.nombre}`);
    }
    if (r.notificacion) {
      for (const n of config.notificarPedidosA) {
        if (!/^\d{8,15}$/.test(n)) continue;
        await enviar(`${n}@c.us`, r.notificacion).catch((e) => console.error('No pude avisar a', n, e.message));
      }
    }
  } catch (e) {
    console.error('Error procesando mensaje:', e);
  }
});

function tipoDeMensaje(msg) {
  switch (msg.type) {
    case 'chat': return 'texto';
    case 'location': return 'ubicacion';
    case 'image': return 'imagen';
    case 'audio':
    case 'ptt': return 'audio';
    default: return 'otro';
  }
}

function avisarSiFaltaEditar(cfg) {
  const json = JSON.stringify(cfg.negocios) + JSON.stringify(cfg.notificarPedidosA);
  if (cfg.datosDeEjemplo || json.includes('EDITAR')) {
    console.warn('⚠️  OJO: negocios.json todavía tiene datos de EJEMPLO o campos "EDITAR".');
    console.warn('   Los clientes verán esos datos. Edita negocios.json antes de usarlo en serio.\n');
  }
}

process.on('SIGINT', async () => {
  fs.writeFileSync(ARCHIVO_SESIONES, JSON.stringify(motor.exportar(), null, 2));
  await client.destroy().catch(() => {});
  process.exit(0);
});

console.log('Iniciando WhatsApp... (la primera vez tarda un poco)');
client.initialize().catch((e) => {
  console.error('❌ No pude abrir WhatsApp Web:', e.message);
  console.error('   Revisa tu conexión a internet y vuelve a ejecutar el bot.');
  process.exit(1);
});
