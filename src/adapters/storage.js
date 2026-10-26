// Almacenamiento unificado offline-first.
// Android: SQLite nativo (@capacitor-community/sqlite) · Electron: better-sqlite3 en el proceso principal (vía IPC,
// así main.js puede leer los avisos con la ventana cerrada) · Web: IndexedDB.
// Interfaz: iniciar, listar, guardar(item), borrar(id), listarPerfil, guardarPerfil(fila), borrarPerfil(clave)
import { CapacitorSQLite, SQLiteConnection } from "@capacitor-community/sqlite";
import { plataforma, nativo } from "./plataforma.js";

export const ESQUEMA = `
CREATE TABLE IF NOT EXISTS items (id TEXT PRIMARY KEY NOT NULL, data TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS perfil_conocimiento (
  clave TEXT PRIMARY KEY NOT NULL,
  categoria TEXT NOT NULL DEFAULT 'general',
  valor TEXT NOT NULL,
  frecuencia INTEGER NOT NULL DEFAULT 1,
  ultimo_acceso INTEGER NOT NULL
);`;

const sinId = ({ id, ...resto }) => resto;

function sqliteAndroid(){
  let db;
  return {
    async iniciar(){
      const sqlite = new SQLiteConnection(CapacitorSQLite);
      db = (await sqlite.isConnection("capataz", false)).result
        ? await sqlite.retrieveConnection("capataz", false)
        : await sqlite.createConnection("capataz", false, "no-encryption", 1, false);
      await db.open();
      await db.execute(ESQUEMA);
    },
    async listar(){ return ((await db.query("SELECT id, data FROM items")).values || []).map(r => ({ id:r.id, ...JSON.parse(r.data) })); },
    guardar: it => db.run("INSERT OR REPLACE INTO items (id, data) VALUES (?, ?)", [it.id, JSON.stringify(sinId(it))]),
    borrar: id => db.run("DELETE FROM items WHERE id = ?", [id]),
    async listarPerfil(){ return (await db.query("SELECT * FROM perfil_conocimiento")).values || []; },
    guardarPerfil: f => db.run("INSERT OR REPLACE INTO perfil_conocimiento (clave, categoria, valor, frecuencia, ultimo_acceso) VALUES (?, ?, ?, ?, ?)",
      [f.clave, f.categoria, f.valor, f.frecuencia, f.ultimo_acceso]),
    borrarPerfil: clave => db.run("DELETE FROM perfil_conocimiento WHERE clave = ?", [clave])
  };
}

function sqliteElectron(){
  const q = (op, ...a) => nativo.db(op, ...a);
  return {
    iniciar: () => q("iniciar"),
    listar: () => q("listar"),
    guardar: it => q("guardar", it),
    borrar: id => q("borrar", id),
    listarPerfil: () => q("listarPerfil"),
    guardarPerfil: f => q("guardarPerfil", f),
    borrarPerfil: clave => q("borrarPerfil", clave)
  };
}

function indexedDB_(){
  let db;
  const tx = (store, modo, fn) => new Promise((ok, mal) => {
    const t = db.transaction(store, modo), r = fn(t.objectStore(store));
    t.oncomplete = () => ok(r?.result); t.onerror = () => mal(t.error);
  });
  return {
    iniciar: () => new Promise((ok, mal) => {
      const r = indexedDB.open("capataz", 1);
      r.onupgradeneeded = () => {
        r.result.createObjectStore("items", { keyPath:"id" });
        r.result.createObjectStore("perfil_conocimiento", { keyPath:"clave" });
      };
      r.onsuccess = () => { db = r.result; ok(); };
      r.onerror = () => mal(r.error);
    }),
    listar: () => tx("items", "readonly", s => s.getAll()),
    guardar: it => tx("items", "readwrite", s => s.put(it)),
    borrar: id => tx("items", "readwrite", s => s.delete(id)),
    listarPerfil: () => tx("perfil_conocimiento", "readonly", s => s.getAll()),
    guardarPerfil: f => tx("perfil_conocimiento", "readwrite", s => s.put(f)),
    borrarPerfil: clave => tx("perfil_conocimiento", "readwrite", s => s.delete(clave))
  };
}

export const storage = plataforma === "android" ? sqliteAndroid() : plataforma === "electron" ? sqliteElectron() : indexedDB_();
