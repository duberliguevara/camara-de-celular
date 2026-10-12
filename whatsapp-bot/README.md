# Bot de WhatsApp — Pucacha Finest Market y Adita Corazón Heladería

Bot que responde automáticamente los mensajes de WhatsApp del número que
comparten los dos negocios en Tarapoto y toma **pedidos de delivery**. Se
conecta escaneando un **QR**, igual que WhatsApp Web, así que funciona con
**WhatsApp Business** sin pagar la API oficial.

## Qué hace

- Saluda y pregunta si el cliente quiere pedir en **🛒 Pucacha** o en **🍦 Adita**
  (si el primer mensaje ya dice "helado" o "pucacha", entra directo).
- Muestra el **catálogo con precios**, el **horario y ubicación**, las
  **zonas y costos de delivery** y las **formas de pago** (efectivo, Yape, Plin, tarjeta).
- Toma el pedido: el cliente escribe `3 x2, 5` para agregar productos,
  `quitar 3`, `carrito`, `borrar`, `listo`.
- Pide nombre, dirección (o **ubicación compartida** de WhatsApp), zona,
  forma de pago e indicaciones (en Adita pide los **sabores**), muestra el
  resumen con el total y pide confirmación.
- Al confirmar te **avisa por WhatsApp** a tu número personal con todo el
  pedido (incluido el link de Google Maps) y lo guarda en `datos/pedidos.json`.
- Si el cliente manda la **captura del Yape** después del pedido, te avisa.
- Avisa si el negocio está **cerrado** según el horario (hora de Perú), pero
  igual deja pedir para atenderlo al abrir.
- Si el cliente escribe **asesor** / **persona**, el bot te avisa y se calla
  en ese chat.
- **Si tú respondes a mano** desde el celular en un chat, el bot se calla ahí
  por 2 horas para no interrumpir. Escribe `#bot` en ese chat para reactivarlo.
- No responde en grupos, estados ni canales. No entiende audios (pide que escriban).

## Instalación (Windows)

1. Instala **Node.js** (versión LTS) desde <https://nodejs.org>.
2. Edita **`negocios.json`** con los datos reales (ver abajo).
3. Doble clic en **`iniciar-bot.bat`**. La primera vez instala todo (tarda unos minutos).
4. Aparece un **QR** en la ventana (y también se guarda como `qr.png`).
5. En el celular con WhatsApp Business: **⋮ → Dispositivos vinculados →
   Vincular un dispositivo** y escanea el QR.
6. Cuando diga `✅ Bot conectado`, ya está respondiendo. **Deja la ventana
   abierta** (y la PC prendida y con internet). La sesión queda guardada en
   `.sesion-whatsapp/`, así que la próxima vez no pide QR.

En Mac/Linux: `npm install` y luego `npm start`.

> El celular puede seguir usándose normalmente; el bot funciona como un
> "dispositivo vinculado" más. Si WhatsApp desvincula la sesión, borra la
> carpeta `.sesion-whatsapp` y escanea de nuevo.

## Configurar `negocios.json`

Todo lo que dice **`EDITAR`** y todos los productos/precios son de
**ejemplo** — no encontré catálogo ni datos públicos de los negocios en
internet, así que tienes que ponerlos tú. Al arrancar, el bot avisa si quedan
datos de ejemplo.

| Campo | Qué poner |
|---|---|
| `notificarPedidosA` | Tu número **personal** con código de país, sin `+` ni espacios (ej. `"51987654321"`). Ahí llegan los pedidos. Puedes poner varios. No pongas el mismo número del bot. |
| `pausaAtencionHumanaHoras` | Horas que el bot se calla en un chat cuando tú respondes a mano. |
| `reiniciarConversacionTrasMinutos` | Si el cliente no escribe en este tiempo, la próxima vez empieza desde el saludo. |
| `direccion`, `linkMapa` | Dirección de cada local y link de Google Maps. |
| `horario` | Hora de apertura y cierre por día (`"lun": ["08:00", "22:00"]`). Pon `null` si ese día cierran. Puede cruzar medianoche (`["18:00", "02:00"]`). |
| `delivery` | Pedido mínimo, tiempo estimado y zonas con su costo (`null` = "a consultar"). |
| `pagos` | Número y titular de Yape/Plin. Pon `null` o `false` en lo que no aceptes. |
| `catalogo` | Categorías y productos con su precio en soles. |
| `sabores` | (Solo heladería) sabores disponibles. |

Cuando termines, cambia `"datosDeEjemplo": true` a `false`. Después de editar,
cierra y vuelve a abrir el bot para que tome los cambios.

## Probar sin celular

```bash
npm run simular   # chateas con el bot en la consola (/ubicacion, /foto, /salir)
npm test          # pruebas automáticas del flujo
```

## Archivos

- `src/flujo.js` — la conversación (menús, carrito, pedido). Los textos que
  ve el cliente están aquí.
- `src/horario.js` — abierto/cerrado según hora de Perú.
- `src/index.js` — conexión con WhatsApp por QR (librería
  [whatsapp-web.js](https://wwebjs.dev)).
- `datos/pedidos.json` — historial de pedidos (se crea solo).

## Importante

Este método (WhatsApp Web automatizado) **no es oficial** de WhatsApp. Es lo
que usan la mayoría de bots pequeños y funciona bien con volumen normal de un
negocio, pero WhatsApp podría restringir números que mandan mensajes masivos
o spam. El bot **solo responde** a quien le escribe, que es el uso de menor
riesgo. Si en el futuro el volumen crece mucho, conviene migrar a la API
oficial de WhatsApp Business (Meta), que es de pago.
