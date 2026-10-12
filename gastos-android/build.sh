#!/usr/bin/env bash
# Compila Mis Gastos (APK) sin Android Studio. Necesita:
#   ANDROID_JAR  android.jar de la plataforma 33 (SDK de Android)
#   AAPT2        binario aapt2
#   DX_JAR       dalvik-dx (com.jakewharton.android.repackaged:dalvik-dx:16.0.1)
#   KEYSTORE     llave .p12 y KEYSTORE_PASS su contraseña
#   PYTHON       python con el paquete "cryptography"
# Uso: ./build.sh  -> build/MisGastos.apk
set -euo pipefail
cd "$(dirname "$0")"
: "${ANDROID_JAR:?}" "${AAPT2:?}" "${DX_JAR:?}" "${KEYSTORE:?}" "${KEYSTORE_PASS:?}"
PYTHON="${PYTHON:-python3}"

rm -rf build && mkdir -p build/res build/gen build/classes build/www

# Recursos y manifiesto
"$AAPT2" compile --dir res -o build/res/
"$AAPT2" link -o build/base.apk -I "$ANDROID_JAR" --manifest AndroidManifest.xml \
  --java build/gen --min-sdk-version 24 --target-sdk-version 33 build/res/*.flat

# Código Java -> DEX
javac -source 8 -target 8 -encoding UTF-8 -Xlint:-options \
  -bootclasspath "$ANDROID_JAR" -d build/classes \
  $(find src build/gen -name '*.java')
java -cp "$DX_JAR" com.android.dx.command.Main --dex --min-sdk-version=24 --output=build/classes.dex build/classes

# App web (la misma de ../gastos, sin la API de Cloudflare ni el service worker)
(cd ../gastos && cp -r index.html style.css app.js parser.js sync.js manifest.json icons ../gastos-android/build/www/)

"$PYTHON" tools/sign_apk.py build/MisGastos.apk "$KEYSTORE" "$KEYSTORE_PASS" build/base.apk build/classes.dex build/www
