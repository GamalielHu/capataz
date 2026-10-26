# Capataz

Core web único (`src/`) empaquetado con esbuild en `www/`, envuelto en Capacitor 7 (Android) y Electron 31 (Windows).

```
src/app.js                 UI (misma de la versión artifact)
src/core/                  util, datos (trabajos/avisos), memoria (perfil_conocimiento), ia, alarmas
src/adapters/              plataforma, storage, notifications, voice, llm
electron/main.js           ventana, bandeja, inicio con Windows, SQLite, avisos cada 30 s, llamadas a la API
electron/preload.js        contextBridge → window.capatazNativo
android/                   proyecto Capacitor (permisos vía scripts/android-permisos.mjs)
.github/workflows/         APK + .exe + release en cada push a main
```

```
npm install
npm run electron        # probar en PC
npm run electron:exe    # instalador Windows (dist/)
npm run android:apk     # APK debug (requiere Android SDK + JDK 21)
```

La clave de API de Anthropic se pone en Ajustes (engranaje). Se guarda cifrada (Keystore en Android, DPAPI en Windows).
