# Mis Gastos para Android (APK)

App nativa que muestra la app web de `../gastos` y además **lee las
notificaciones del celular**: cuando llega un aviso de consumo del banco,
de Yape/Plin o un correo de Gmail con un monto, lo anota solo (y te avisa
con una notificación "Pago detectado").

## Instalar

1. Pasa `MisGastos.apk` al celular y ábrelo. Android pedirá permitir
   "instalar apps desconocidas" para el navegador o el gestor de archivos.
2. Abre Mis Gastos → **Opciones (⋮) → Leer notificaciones del banco y
   Gmail → Activar** y habilita **Mis Gastos** en "Acceso a
   notificaciones".
3. Para guardar en Cloudflare: en **Opciones → Mi base de datos** escribe la
   dirección de tu proyecto de Cloudflare Pages (ej.
   `https://mis-gastos.pages.dev`) y tu clave. Ver `../gastos/README.md`.

Qué se considera un pago: el texto trae un monto (S/, US$, $) y una palabra
de gasto (consumo, compra, cargo, yapeaste, tarjeta...). Se ignoran el
dinero que recibes, los códigos de verificación, las promociones y las apps
de chat (WhatsApp, Telegram, Messenger, Instagram...).

Si la app está cerrada, los pagos detectados esperan en una cola y se
anotan apenas la abres (o al tocar la notificación "Pago detectado").

## Compilar

No hace falta Android Studio: `build.sh` usa `aapt2`, `javac`, `dalvik-dx`
y firma con `tools/sign_apk.py` (firma v2). Las rutas de las herramientas y
de la llave van en variables de entorno (ver el inicio de `build.sh`).
Para que una versión nueva se instale encima de la anterior hay que firmarla
con la **misma llave** y subir `android:versionCode` en `AndroidManifest.xml`.
