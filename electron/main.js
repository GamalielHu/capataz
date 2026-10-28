// Proceso principal: ventana, bandeja del sistema, inicio con Windows, base SQLite, avisos nativos y llamadas a la API.
const { app, BrowserWindow, Tray, Menu, Notification, ipcMain, safeStorage, nativeImage, shell, globalShortcut } = require("electron");
const path = require("node:path");
const fs = require("node:fs");
const Database = require("better-sqlite3");
const { peticion, textoDe, codigoError, modelosA, reintentable, MODELOS_VOZ, peticionVoz, audioDe, proveedorDe } = require("./proveedores.js");

const APP_ID = "bo.capataz.app";
const ARRANQUE_OCULTO = "--oculto";
const ICONO = path.join(__dirname, "..", "recursos", "icono.png");

if (!app.requestSingleInstanceLock()) { app.quit(); process.exit(0); }
app.setAppUserModelId(APP_ID);

let ventana = null, bandeja = null, saliendo = false, db = null;

/* ---------- Base de datos (mismo esquema que Android) ---------- */
function abrirBase() {
  db = new Database(path.join(app.getPath("userData"), "capataz.db"));
  db.pragma("journal_mode = WAL");
  db.exec(`
    CREATE TABLE IF NOT EXISTS items (id TEXT PRIMARY KEY NOT NULL, data TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS perfil_conocimiento (
      clave TEXT PRIMARY KEY NOT NULL, categoria TEXT NOT NULL DEFAULT 'general', valor TEXT NOT NULL,
      frecuencia INTEGER NOT NULL DEFAULT 1, ultimo_acceso INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS avisos_notificados (id TEXT NOT NULL, cuando INTEGER NOT NULL, PRIMARY KEY (id, cuando));`);
}
const sinId = ({ id, ...resto }) => resto;
const OPS = {
  iniciar: () => true,
  listar: () => db.prepare("SELECT id, data FROM items").all().map(r => ({ id: r.id, ...JSON.parse(r.data) })),
  guardar: it => { db.prepare("INSERT OR REPLACE INTO items (id, data) VALUES (?, ?)").run(it.id, JSON.stringify(sinId(it))); },
  borrar: id => { db.prepare("DELETE FROM items WHERE id = ?").run(id); },
  listarPerfil: () => db.prepare("SELECT * FROM perfil_conocimiento").all(),
  guardarPerfil: f => { db.prepare("INSERT OR REPLACE INTO perfil_conocimiento (clave, categoria, valor, frecuencia, ultimo_acceso) VALUES (@clave, @categoria, @valor, @frecuencia, @ultimo_acceso)").run(f); },
  borrarPerfil: clave => { db.prepare("DELETE FROM perfil_conocimiento WHERE clave = ?").run(clave); }
};
ipcMain.handle("db", (_e, op, ...args) => {
  if (!Object.hasOwn(OPS, op)) throw new Error("operación no válida");
  return OPS[op](...args);
});

/* ---------- Avisos: revisión persistente en el hilo principal ---------- */
function revisarAvisos() {
  const ahora = Date.now();
  const due = db.prepare(`
    SELECT i.id, json_extract(i.data,'$.texto') AS texto, json_extract(i.data,'$.cuando') AS cuando
    FROM items i LEFT JOIN avisos_notificados n ON n.id = i.id AND n.cuando = json_extract(i.data,'$.cuando')
    WHERE json_extract(i.data,'$.tipo') = 'recordatorio' AND json_extract(i.data,'$.hecho') = 0
      AND json_extract(i.data,'$.cuando') <= ? AND json_extract(i.data,'$.cuando') > ? AND n.id IS NULL`)
    .all(ahora, ahora - 6 * 3600e3);
  const marcar = db.prepare("INSERT OR IGNORE INTO avisos_notificados (id, cuando) VALUES (?, ?)");
  for (const a of due) {
    marcar.run(a.id, a.cuando);
    const n = new Notification({ title: "Capataz", body: a.texto, silent: false, urgency: "critical", timeoutType: "never", icon: ICONO });
    n.on("click", () => { mostrar(); ventana.webContents.send("aviso:accion", "abrir", a.id); });
    n.show();
  }
  db.prepare("DELETE FROM avisos_notificados WHERE cuando < ?").run(ahora - 30 * 864e5);
}
ipcMain.on("avisos:cambiaron", () => revisarAvisos());

// Resumen de la mañana: una vez al día desde las 7:00.
function resumenDiario() {
  const ahora = new Date(), hoy = ahora.toDateString(), marca = path.join(app.getPath("userData"), ".resumen");
  if (ahora.getHours() < 7 || (fs.existsSync(marca) && fs.readFileSync(marca, "utf8") === hoy)) return;
  fs.writeFileSync(marca, hoy);
  const ini = new Date(ahora); ini.setHours(0, 0, 0, 0); const fin = ini.getTime() + 864e5;
  const avisos = db.prepare(`SELECT json_extract(data,'$.texto') AS texto FROM items WHERE json_extract(data,'$.tipo')='recordatorio'
    AND json_extract(data,'$.hecho')=0 AND json_extract(data,'$.cuando') >= ? AND json_extract(data,'$.cuando') < ? ORDER BY json_extract(data,'$.cuando')`).all(ini.getTime(), fin);
  const pend = db.prepare(`SELECT COUNT(*) AS n FROM items WHERE json_extract(data,'$.tipo')='tarea' AND json_extract(data,'$.hecho')=0`).get().n;
  if (!avisos.length && !pend) return;
  const partes = [];
  if (avisos.length) partes.push(`${avisos.length} ${avisos.length === 1 ? "aviso" : "avisos"} hoy (primero: ${avisos[0].texto})`);
  if (pend) partes.push(`${pend} ${pend === 1 ? "trabajo pendiente" : "trabajos pendientes"}`);
  const n = new Notification({ title: "Capataz · tu día", body: "Buenos días. Tienes " + partes.join(" y ") + ".", icon: ICONO });
  n.on("click", mostrar); n.show();
}

/* ---------- Clave de API: %APPDATA%/CapatazConfig/secrets.json, fuera de la carpeta del programa ---------- */
// Windows: cifrada con DPAPI del usuario (no depende de archivos de Capataz, sobrevive a desinstalar y reinstalar).
// Otros sistemas o si DPAPI falla: AES-GCM con una llave derivada del usuario y el equipo.
const crypto = require("node:crypto");
const os = require("node:os");
const { execFileSync } = require("node:child_process");
const dirConfig = () => path.join(app.getPath("appData"), "CapatazConfig");
const archivoSecretos = () => path.join(dirConfig(), "secrets.json");
const archivoClaveViejo = () => path.join(app.getPath("userData"), "clave.bin");

function dpapi(modo, entrada) {
  const ps = modo === "cifrar"
    ? "Add-Type -AssemblyName System.Security;[Convert]::ToBase64String([Security.Cryptography.ProtectedData]::Protect([Text.Encoding]::UTF8.GetBytes($env:CPZ_DATO),$null,'CurrentUser'))"
    : "Add-Type -AssemblyName System.Security;[Text.Encoding]::UTF8.GetString([Security.Cryptography.ProtectedData]::Unprotect([Convert]::FromBase64String($env:CPZ_DATO),$null,'CurrentUser'))";
  return execFileSync("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", ps],
    { env: { ...process.env, CPZ_DATO: entrada }, windowsHide: true, timeout: 15000 }).toString().trim();
}
const llaveLocal = sal => crypto.pbkdf2Sync(`capataz|${os.userInfo().username}|${os.hostname()}`, sal, 100000, 32, "sha256");
function aesCifrar(texto) {
  const sal = crypto.randomBytes(16), iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv("aes-256-gcm", llaveLocal(sal), iv);
  const ct = Buffer.concat([c.update(texto, "utf8"), c.final(), c.getAuthTag()]);
  return Buffer.concat([sal, iv, ct]).toString("base64");
}
function aesDescifrar(b64) {
  const b = Buffer.from(b64, "base64");
  const d = crypto.createDecipheriv("aes-256-gcm", llaveLocal(b.subarray(0, 16)), b.subarray(16, 28));
  d.setAuthTag(b.subarray(b.length - 16));
  return Buffer.concat([d.update(b.subarray(28, b.length - 16)), d.final()]).toString("utf8");
}

let claveCache;
function guardarSecreto(clave) {
  claveCache = clave || null;
  if (!clave) { fs.rmSync(archivoSecretos(), { force: true }); fs.rmSync(archivoClaveViejo(), { force: true }); return; }
  let registro;
  if (process.platform === "win32") try { registro = { cifrado: "dpapi", dato: dpapi("cifrar", clave) }; } catch {}
  registro ||= { cifrado: "aes", dato: aesCifrar(clave) };
  fs.mkdirSync(dirConfig(), { recursive: true });
  fs.writeFileSync(archivoSecretos(), JSON.stringify({ version: 1, api_key_ia: registro, guardado: new Date().toISOString() }, null, 2), { mode: 0o600 });
  fs.rmSync(archivoClaveViejo(), { force: true });
}
function leerClave() {
  if (claveCache !== undefined) return claveCache;
  try {
    const { api_key_ia: r } = JSON.parse(fs.readFileSync(archivoSecretos(), "utf8"));
    claveCache = r.cifrado === "dpapi" ? dpapi("descifrar", r.dato) : aesDescifrar(r.dato);
    return claveCache || null;
  } catch {}
  // Migración desde versiones anteriores (clave.bin en la carpeta de datos).
  try {
    const SIN_CIFRAR = Buffer.from("texto:"), b = fs.readFileSync(archivoClaveViejo());
    const vieja = b.subarray(0, SIN_CIFRAR.length).equals(SIN_CIFRAR) ? b.subarray(SIN_CIFRAR.length).toString() : safeStorage.decryptString(b);
    if (vieja) { guardarSecreto(vieja); return vieja; }
  } catch {}
  return null;
}
ipcMain.handle("save-key", (_e, clave) => guardarSecreto(String(clave || "").trim()));
ipcMain.handle("get-key", () => leerClave() || "");
ipcMain.handle("clave:guardar", (_e, clave) => guardarSecreto(String(clave || "").trim()));
ipcMain.handle("clave:hay", () => !!leerClave());
ipcMain.handle("clave:gemini", () => { const c = leerClave(); return c && proveedorDe(c) === "gemini" ? c : null; });

async function pedirIA(clave, pedido) {
  const { url, headers, body } = peticion(clave, pedido);
  let r, datos;
  try {
    r = await fetch(url, { method: "POST", headers, body: JSON.stringify(body), signal: AbortSignal.timeout(90000) });
    datos = await r.json();
  } catch { throw new Error("red"); }
  if (r.status !== 200) throw new Error(codigoError(r.status, datos));
  return textoDe(clave, datos);
}
ipcMain.handle("ia", async (_e, pedido) => {
  const clave = leerClave();
  if (!clave) throw new Error("sin_clave");
  let error;
  for (const modelo of modelosA(clave, pedido.modelo, pedido.potente)) {
    try { return await pedirIA(clave, { ...pedido, modelo }); }
    catch (e) { error = e; if (!reintentable(e.message)) throw e; }
  }
  throw error;
});

ipcMain.handle("voz", async (_e, texto, voz) => {
  const clave = leerClave();
  if (!clave || proveedorDe(clave) !== "gemini") throw new Error("sin_audio");
  let error;
  for (const modelo of MODELOS_VOZ) {
    const { url, headers, body } = peticionVoz(clave, texto, modelo, voz || undefined);
    try {
      const r = await fetch(url, { method: "POST", headers, body: JSON.stringify(body), signal: AbortSignal.timeout(30000) });
      const datos = await r.json();
      if (r.status !== 200) throw new Error(codigoError(r.status, datos));
      const audio = audioDe(datos); if (!audio) throw new Error("sin_audio");
      return audio;
    } catch (e) { error = e.name === "TimeoutError" || e.name === "TypeError" ? new Error("red") : e; if (!reintentable(error.message)) throw error; }
  }
  throw error;
});

/* ---------- Inicio con Windows ---------- */
ipcMain.handle("autoinicio", (_e, activar) => {
  if (typeof activar === "boolean") app.setLoginItemSettings({ openAtLogin: activar, args: [ARRANQUE_OCULTO] });
  return app.getLoginItemSettings({ args: [ARRANQUE_OCULTO] }).openAtLogin;
});

/* ---------- Ventana y bandeja ---------- */
function crearVentana() {
  ventana = new BrowserWindow({
    width: 460, height: 820, minWidth: 360, show: false, title: "Capataz", icon: ICONO, autoHideMenuBar: true,
    webPreferences: { preload: path.join(__dirname, "preload.js"), contextIsolation: true, sandbox: true, nodeIntegration: false }
  });
  ventana.loadFile(path.join(__dirname, "..", "www", "index.html"));
  ventana.once("ready-to-show", () => { if (!process.argv.includes(ARRANQUE_OCULTO)) ventana.show(); });
  // Cerrar = minimizar a la bandeja; los avisos siguen sonando.
  ventana.on("close", e => { if (!saliendo) { e.preventDefault(); ventana.hide(); } });
  ventana.webContents.setWindowOpenHandler(({ url }) => { shell.openExternal(url); return { action: "deny" }; });
}
// Acciones del asistente: abre enlaces con el programa del sistema (Spotify, WhatsApp, Maps, navegador, teléfono).
ipcMain.handle("abrir", async (_e, url) => {
  if (!/^(https?:|spotify:|tel:|mailto:)/i.test(String(url))) return false;
  try { await shell.openExternal(url); return true; } catch { return false; }
});
function hablar() { mostrar(); ventana.webContents.send("hablar"); }
function mostrar() { if (ventana.isMinimized()) ventana.restore(); ventana.show(); ventana.focus(); }
function crearBandeja() {
  bandeja = new Tray(nativeImage.createFromPath(ICONO).resize({ width: 16, height: 16 }));
  bandeja.setToolTip("Capataz");
  const menu = () => Menu.buildFromTemplate([
    { label: "Abrir Capataz", click: mostrar },
    { label: "Hablar con Capataz (Ctrl+Alt+Espacio)", click: hablar },
    { label: "Iniciar con Windows", type: "checkbox", checked: app.getLoginItemSettings({ args: [ARRANQUE_OCULTO] }).openAtLogin,
      click: i => app.setLoginItemSettings({ openAtLogin: i.checked, args: [ARRANQUE_OCULTO] }) },
    { type: "separator" },
    { label: "Salir", click: () => { saliendo = true; app.quit(); } }
  ]);
  bandeja.setContextMenu(menu());
  bandeja.on("right-click", () => bandeja.setContextMenu(menu()));
  bandeja.on("click", mostrar);
}

app.on("second-instance", () => mostrar());
app.on("before-quit", () => { saliendo = true; });
app.on("will-quit", () => globalShortcut.unregisterAll());
app.whenReady().then(() => {
  abrirBase();
  if (!app.getLoginItemSettings({ args: [ARRANQUE_OCULTO] }).openAtLogin && !fs.existsSync(path.join(app.getPath("userData"), ".instalado"))) {
    app.setLoginItemSettings({ openAtLogin: true, args: [ARRANQUE_OCULTO] });
    fs.writeFileSync(path.join(app.getPath("userData"), ".instalado"), "1");
  }
  crearVentana();
  crearBandeja();
  globalShortcut.register("CommandOrControl+Alt+Space", hablar);
  revisarAvisos();
  setInterval(() => { revisarAvisos(); resumenDiario(); }, 30000);
});
app.on("window-all-closed", e => e.preventDefault());
