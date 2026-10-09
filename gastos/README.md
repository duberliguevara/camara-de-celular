# Mis Gastos

App aparte (independiente de la app de clientes de streaming) para anotar
todos tus pagos desde el celular:

- **Tarjetas** — consumos con tus tarjetas de crédito (vienen SIP, iO y BCP
  Platinum; puedes agregar o quitar). Total del mes por tarjeta y, si
  pones el día de cierre, cuánto llevas en el ciclo de facturación actual.
- **Generales** — todo lo demás: efectivo, débito, Yape, Plin,
  transferencias.
- **Resumen** — en qué se va tu dinero por tarjeta, por categoría y en los
  últimos 6 meses.

Soles y dólares por separado (los totales convierten US$ a S/ con el tipo
de cambio que pongas en Opciones).

**Dónde se guardan los datos:** primero en el celular (así funciona sin
señal) y, apenas hay internet, se suben a **tu base de datos D1 de
Cloudflare**. Lo que anotes en un dispositivo aparece en los demás.

## Publicar en Cloudflare e instalar en el celular

Todo se hace desde el panel de Cloudflare (dash.cloudflare.com), con tu
cuenta. Es gratis.

1. **Workers & Pages → Create → Pages → Connect to Git.** Autoriza GitHub
   y elige el repositorio `camara-de-celular`.
2. Configuración del proyecto:
   - *Project name*: `mis-gastos` (será tu dirección:
     `mis-gastos.pages.dev`).
   - *Production branch*: la rama donde está esta carpeta
     (`claude/netflix-account-sales-app-3d2ndm` mientras no se junte con
     `main`).
   - *Framework preset*: **None**. *Build command*: vacío.
   - *Root directory* (en *Advanced*): **`gastos`**.
   - **Save and Deploy.**
3. En el proyecto → **Settings → Bindings → Add → D1 database**:
   - *Variable name*: **`DB`**
   - *D1 database*: elige una de tus bases. Las tablas se crean solas con
     el prefijo `gastos_`, así que no tocan lo que ya tengas ahí.
4. **Settings → Variables and Secrets → Add**: tipo **Secret**, nombre
   **`CLAVE`**, y como valor una clave larga que inventes (es la que te
   pedirá la app).
5. **Deployments → … → Retry deployment** para que tome la base y la clave.
6. En el celular abre `https://mis-gastos.pages.dev` en **Chrome** → menú ⋮
   → **Instalar app** (o *Agregar a pantalla principal*). En iPhone: Safari
   → Compartir → *Agregar a inicio*.
7. En la app: **Opciones (⋮) → Mi base de datos** → escribe tu clave →
   **Guardar y conectar**. Arriba debe decir "☁️ Guardado en Cloudflare".

Haz el paso 7 en cada celular o navegador donde la uses. Los gastos que ya
tenías en el celular se suben solos al conectar.

## Anotar desde las notificaciones

Una app web no puede leer las notificaciones del celular por sí sola (el
sistema no se lo permite). Hay tres formas, de más manual a 100 %
automática:

### 1. Pegar (Android y iPhone)

Copia el texto de la notificación, del SMS o del correo del banco, abre la
app y toca 📋. La app detecta el monto, la moneda (S/ o US$), el comercio,
la fecha y la tarjeta, y te muestra el formulario ya lleno para que solo
toques **Guardar**.

### 2. Compartir (Android)

Con la app instalada, aparece **Mis Gastos** en el menú *Compartir* de
Android. Selecciona el texto de un correo o SMS → Compartir → Mis Gastos.

### 3. Automático con MacroDroid (Android)

[MacroDroid](https://play.google.com/store/apps/details?id=com.arlosoft.macrodroid)
(gratis) puede leer las notificaciones y abrir la app con el texto. Funciona
igual con las notificaciones de la app del banco o con las de **Gmail**
cuando te llega el correo del consumo.

1. Instala MacroDroid y dale el permiso de **acceso a notificaciones**.
2. Nueva macro → **Disparador**: *Notificación → Notificación recibida*.
   - App: la del banco, o **Gmail** si el aviso te llega por correo.
   - Texto contiene: algo que solo traigan los avisos de consumo, por
     ejemplo `consumo` o `compra` (o el remitente del correo del banco).
3. **Acción**: *Abrir sitio web / URL*. Pega el enlace que aparece en la app
   en *Opciones → Registro automático* (termina en `?auto=1&text=`) y, al
   final, inserta con el botón de *texto mágico* el **título** y el
   **texto de la notificación**.
4. Guarda la macro.

Cada vez que llegue un aviso de consumo se anota solo y ves un mensaje
"Anotado automáticamente". Si la misma notificación llega dos veces en 10
minutos no se duplica. Si el aviso no trae el monto (algunos correos solo
muestran el asunto), la app se abre con el formulario a medio llenar para
que completes la cifra.

Para que reconozca bien cada tarjeta, en *Opciones → Mis tarjetas* pon sus
**últimos 4 dígitos** y las **palabras clave** que aparecen en los avisos
de ese banco.

Si no quieres usar texto libre, el enlace también acepta datos directos:
`?auto=1&monto=45.90&moneda=PEN&comercio=Wong&tarjeta=bcp`.

## Probar en la computadora

```bash
cd gastos
echo CLAVE=prueba123 > .dev.vars
npx wrangler pages dev . --d1 DB=gastos-prueba
# abre http://localhost:8788 y en Opciones usa la clave prueba123
```

## Archivos

- `index.html`, `style.css` — pantallas y estilos.
- `app.js` — lógica: guardar pagos, totales, tarjetas, opciones, copia de
  seguridad.
- `sync.js` — sube y baja los gastos de tu base de Cloudflare.
- `functions/api/[[route]].js` — la API que corre en Cloudflare y guarda
  en D1 (tablas `gastos_pagos` y `gastos_ajustes`).
- `parser.js` — lee el texto de una notificación y saca monto, moneda,
  comercio, fecha y tarjeta.
- `manifest.json`, `sw.js`, `icons/` — instalación como app y
  funcionamiento sin internet.
