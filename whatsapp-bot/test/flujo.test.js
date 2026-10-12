const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { Motor } = require('../src/flujo');
const { estaAbierto } = require('../src/horario');

const config = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'negocios.json'), 'utf8'));
config.notificarPedidosA = ['51900000000'];
// Martes 14 de octubre de 2025, 15:00 hora de Lima (20:00 UTC): ambos abiertos.
let reloj = new Date('2025-10-14T20:00:00Z');
const nuevoMotor = () => new Motor(config, { ahora: () => reloj });
const t = (texto) => ({ tipo: 'texto', texto, telefono: '51911111111' });
let ok = 0;
function prueba(nombre, fn) {
  fn();
  ok++;
  console.log('✔', nombre);
}

prueba('saludo muestra los dos negocios', () => {
  const m = nuevoMotor();
  const r = m.procesar('a', t('Hola'));
  assert.match(r.respuestas[0], /Pucacha Finest Market/);
  assert.match(r.respuestas[0], /Adita Corazón Heladería/);
});

prueba('pedido completo en Adita con ubicación y Yape', () => {
  const m = nuevoMotor();
  m.procesar('a', t('hola'));
  assert.match(m.procesar('a', t('2')).respuestas[0], /Abierto ahora/);
  assert.match(m.procesar('a', t('1')).respuestas[0], /Copa 1 sabor/);
  const r = m.procesar('a', t('2 x2, 7'));
  assert.match(r.respuestas[0], /2 x Copa 2 sabores/);
  assert.match(r.respuestas[0], /Subtotal: S\/ 26\.00/);
  assert.match(m.procesar('a', t('listo')).respuestas[0], /A nombre de quién/);
  m.procesar('a', t('María'));
  assert.match(m.procesar('a', { tipo: 'ubicacion', ubicacion: { lat: -6.48, lng: -76.36 } }).respuestas[0], /zona/);
  m.procesar('a', t('2'));
  assert.match(m.procesar('a', t('yape')).respuestas[0], /sabores/);
  const res = m.procesar('a', t('aguaje y camu camu'));
  assert.match(res.respuestas[0], /Total: S\/ 31\.00/);
  const fin = m.procesar('a', t('1'));
  assert.strictEqual(fin.pedido.numero, 1);
  assert.strictEqual(fin.pedido.total, 31);
  assert.match(fin.notificacion, /NUEVO PEDIDO #1/);
  assert.match(fin.notificacion, /maps\.google\.com\/\?q=-6\.48,-76\.36/);
  assert.match(fin.respuestas[0], /captura/);
  // Despues del pedido una imagen se toma como comprobante
  assert.match(m.procesar('a', { tipo: 'imagen' }).notificacion, /comprobante/);
});

prueba('pedido mínimo se respeta', () => {
  const m = nuevoMotor();
  m.procesar('b', t('quiero de pucacha'));
  m.procesar('b', t('1'));
  m.procesar('b', t('1'));
  assert.match(m.procesar('b', t('listo')).respuestas[0], /pedido mínimo/);
});

prueba('quitar y borrar productos', () => {
  const m = nuevoMotor();
  m.procesar('c', t('pucacha'));
  m.procesar('c', t('1'));
  m.procesar('c', t('2 x3, 5'));
  assert.doesNotMatch(m.procesar('c', t('quitar 2')).respuestas[0], /Coca-Cola/);
  assert.match(m.procesar('c', t('borrar')).respuestas[0], /vacié/);
});

prueba('pedir asesor pausa el bot y "menu" lo reactiva', () => {
  const m = nuevoMotor();
  m.procesar('d', t('hola'));
  const r = m.procesar('d', t('quiero hablar con un asesor'));
  assert.match(r.notificacion, /hablar con una persona/);
  assert.deepStrictEqual(m.procesar('d', t('hola?')).respuestas, []);
  assert.match(m.procesar('d', t('menu')).respuestas[0], /Bienvenido/);
});

prueba('"para una persona" en las notas no llama al asesor', () => {
  const m = nuevoMotor();
  m.procesar('e', t('heladeria'));
  m.procesar('e', t('1'));
  m.procesar('e', t('3'));
  m.procesar('e', t('listo'));
  m.procesar('e', t('Luis'));
  m.procesar('e', t('Jr. Lima 123, frente al parque'));
  m.procesar('e', t('1'));
  m.procesar('e', t('1'));
  assert.match(m.procesar('e', t('fresa, es para una persona')).respuestas[0], /Total/);
});

prueba('fuera de horario avisa que está cerrado', () => {
  const m = nuevoMotor();
  reloj = new Date('2025-10-14T08:00:00Z'); // 03:00 en Lima
  assert.match(m.procesar('f', t('pucacha')).respuestas[0], /Cerrado ahora/);
  reloj = new Date('2025-10-14T20:00:00Z');
});

prueba('horario que cruza la medianoche', () => {
  const h = { lun: ['18:00', '02:00'] };
  assert.ok(estaAbierto(h, new Date('2025-10-14T06:00:00Z'), 'America/Lima')); // martes 01:00 Lima
  assert.ok(!estaAbierto(h, new Date('2025-10-14T08:00:00Z'), 'America/Lima')); // martes 03:00 Lima
});

prueba('la conversación se reinicia tras inactividad', () => {
  const m = nuevoMotor();
  m.procesar('g', t('pucacha'));
  reloj = new Date(reloj.getTime() + 3 * 3600 * 1000);
  assert.match(m.procesar('g', t('3')).respuestas[0], /Bienvenido/);
  reloj = new Date('2025-10-14T20:00:00Z');
});

console.log(`\n${ok} pruebas OK`);
