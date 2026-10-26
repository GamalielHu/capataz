// Proceso principal: ventana, bandeja del sistema, inicio con Windows, base SQLite, avisos nativos y llamadas a la API.
const { app, BrowserWindow, Tray, Menu, Notification, ipcMain, safeStorage, nativeImage, shell } = require("electron");
const path = require("node:path");
const fs = require("node:fs");
const Database = require("better-sqlite3");
const { peticion, textoDe, codigoError, modelosA, reintentable } = require("./proveedores.js");

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

/* ---------- Clave de API (cifrada con DPAPI de Windows vía safeStorage) ---------- */
const archivoClave = () => path.join(app.getPath("userData"), "clave.bin");
function leerClave() {
  try { return safeStorage.decryptString(fs.readFileSync(archivoClave())); } catch { return null; }
}
ipcMain.handle("clave:guardar", (_e, clave) => {
  if (!clave) { fs.rmSync(archivoClave(), { force: true }); return; }
  if (!safeStorage.isEncryptionAvailable()) throw new Error("cifrado no disponible");
  fs.writeFileSync(archivoClave(), safeStorage.encryptString(clave));
});
ipcMain.handle("clave:hay", () => !!leerClave());

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
  for (const modelo of modelosA(clave, pedido.modelo)) {
    try { return await pedirIA(clave, { ...pedido, modelo }); }
    catch (e) { error = e; if (!reintentable(e.message)) throw e; }
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
function mostrar() { if (ventana.isMinimized()) ventana.restore(); ventana.show(); ventana.focus(); }
function crearBandeja() {
  bandeja = new Tray(nativeImage.createFromPath(ICONO).resize({ width: 16, height: 16 }));
  bandeja.setToolTip("Capataz");
  const menu = () => Menu.buildFromTemplate([
    { label: "Abrir Capataz", click: mostrar },
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
app.whenReady().then(() => {
  abrirBase();
  if (!app.getLoginItemSettings({ args: [ARRANQUE_OCULTO] }).openAtLogin && !fs.existsSync(path.join(app.getPath("userData"), ".instalado"))) {
    app.setLoginItemSettings({ openAtLogin: true, args: [ARRANQUE_OCULTO] });
    fs.writeFileSync(path.join(app.getPath("userData"), ".instalado"), "1");
  }
  crearVentana();
  crearBandeja();
  revisarAvisos();
  setInterval(revisarAvisos, 30000);
});
app.on("window-all-closed", e => e.preventDefault());
