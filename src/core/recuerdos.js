// Memoria de largo plazo de las conversaciones ("¿qué me dijo el ferretero el mes pasado?").
// Cada intercambio se guarda con su vector semántico (Gemini embeddings, gratis) en IndexedDB;
// al preguntar algo se traen los recuerdos más parecidos. Sin clave de Gemini se busca por palabras.
import { claveGemini } from "../adapters/llm.js";

const BD = "capataz-recuerdos", ALMACEN = "recuerdos", MAX = 5000, DIM = 256;
const URL_EMB = "https://generativelanguage.googleapis.com/v1beta/models/gemini-embedding-001:embedContent";

let bd = null;
function abrir(){
  if (bd) return bd;
  bd = new Promise((ok, mal) => {
    const p = indexedDB.open(BD, 1);
    p.onupgradeneeded = () => p.result.createObjectStore(ALMACEN, { keyPath:"id" });
    p.onsuccess = () => ok(p.result); p.onerror = () => mal(p.error);
  });
  return bd;
}
async function operar(modo, fn){
  const db = await abrir();
  return new Promise((ok, mal) => {
    const tx = db.transaction(ALMACEN, modo), r = fn(tx.objectStore(ALMACEN));
    tx.oncomplete = () => ok(r?.result); tx.onerror = () => mal(tx.error);
  });
}
const todos = () => operar("readonly", s => s.getAll());

async function vector(texto, tipo){
  const clave = await claveGemini(); if (!clave) return null;
  try {
    const r = await fetch(URL_EMB, { method:"POST", headers:{ "content-type":"application/json", "x-goog-api-key":clave }, signal:AbortSignal.timeout(8000),
      body:JSON.stringify({ content:{ parts:[{ text:texto.slice(0, 2000) }] }, outputDimensionality:DIM, taskType:tipo }) });
    if (!r.ok) return null;
    const v = (await r.json())?.embedding?.values;
    if (!v?.length) return null;
    const n = Math.hypot(...v) || 1;
    return v.map(x => +(x / n).toFixed(5));
  } catch { return null; }
}

const palabras = t => new Set(String(t).toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").match(/[a-z0-9ñ]{4,}/g) || []);

// Guarda un intercambio (en segundo plano; si falla no pasa nada).
export async function recordar(texto, chat = ""){
  texto = String(texto || "").trim(); if (texto.length < 12) return;
  try {
    const vec = await vector(texto, "RETRIEVAL_DOCUMENT");
    await operar("readwrite", s => s.put({ id: Date.now().toString(36) + Math.random().toString(36).slice(2, 5), fecha: Date.now(), chat, texto: texto.slice(0, 1200), vec }));
    const lista = await todos();
    if (lista.length > MAX){
      const viejos = lista.sort((a, b) => a.fecha - b.fecha).slice(0, lista.length - MAX);
      await operar("readwrite", s => viejos.forEach(v => s.delete(v.id)));
    }
  } catch {}
}

// Los recuerdos más parecidos a la consulta: [{texto, fecha, puntaje}]
export async function buscarRecuerdos(consulta, k = 6, excluirChat = ""){
  try {
    const lista = (await todos()).filter(r => !excluirChat || r.chat !== excluirChat || Date.now() - r.fecha > 864e5);
    if (!lista.length) return [];
    const q = await vector(consulta, "RETRIEVAL_QUERY");
    let puntuados;
    if (q) puntuados = lista.filter(r => r.vec).map(r => ({ r, p: r.vec.reduce((s, x, i) => s + x * q[i], 0) })).filter(x => x.p > 0.62);
    else {
      const qp = palabras(consulta); if (!qp.size) return [];
      puntuados = lista.map(r => { const rp = palabras(r.texto); let c = 0; qp.forEach(w => rp.has(w) && c++); return { r, p: c / qp.size }; }).filter(x => x.p >= 0.5);
    }
    return puntuados.sort((a, b) => b.p - a.p).slice(0, k).map(({ r, p }) => ({ texto:r.texto, fecha:r.fecha, puntaje:p }));
  } catch { return []; }
}

export function bloqueRecuerdos(lista){
  const fmt = new Intl.DateTimeFormat("es", { day:"numeric", month:"short", year:"numeric" });
  return lista.map(r => `- (${fmt.format(r.fecha)}) ${r.texto.replace(/\s+/g, " ")}`).join("\n");
}
