// Chatea con el bot en la consola, sin WhatsApp, para probar respuestas y
// ver como queda el catalogo. Escribe "/ubicacion" para simular que mandas
// tu ubicacion, "/foto" para una imagen y "/salir" para terminar.

const fs = require('fs');
const path = require('path');
const readline = require('readline');
const { Motor } = require('../src/flujo');

const config = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'negocios.json'), 'utf8'));
const motor = new Motor(config);
const chat = '51999999999@c.us';
const rl = readline.createInterface({ input: process.stdin, output: process.stdout });

console.log('Simulador del bot. Escribe como si fueras un cliente (ej: "hola").\n');
rl.setPrompt('Tú> ');
rl.prompt();
rl.on('line', (linea) => {
  if (linea.trim() === '/salir') return rl.close();
  let mensaje = { tipo: 'texto', texto: linea, nombrePerfil: 'Cliente de prueba', telefono: '51999999999' };
  if (linea.trim() === '/ubicacion') mensaje = { tipo: 'ubicacion', ubicacion: { lat: -6.4878, lng: -76.3601, descripcion: 'Plaza de Armas de Tarapoto' } };
  if (linea.trim() === '/foto') mensaje = { tipo: 'imagen', texto: '' };
  const r = motor.procesar(chat, mensaje);
  for (const t of r.respuestas) console.log(`\nBot> ${t}\n`);
  if (r.notificacion) console.log(`\n[Aviso al dueño]\n${r.notificacion}\n`);
  if (!r.respuestas.length && !r.notificacion) console.log('(el bot no responde: está en pausa o esperando a una persona)\n');
  rl.prompt();
});
