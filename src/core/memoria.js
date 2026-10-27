// Memoria a largo plazo: almacén perfil_conocimiento (clave, categoria, valor, frecuencia, ultimo_acceso).
// Lo que se repite o se usa sube de prioridad; al prompt van las entradas mejor puntuadas.
import { storage } from "../adapters/storage.js";

const MAX_EN_PROMPT = 80;
export const CATEGORIAS = ["persona", "proyecto", "proveedor", "contacto", "preferencia", "rutina", "general"];
let perfil = [];

export async function cargarPerfil(){ perfil = await storage.listarPerfil(); return perfil; }
export const listarPerfil = () => [...perfil].sort((a,b) => a.categoria.localeCompare(b.categoria) || a.clave.localeCompare(b.clave));

const normalizar = s => String(s||"").trim().toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g,"").replace(/[^a-z0-9]+/g,"_").replace(/^_|_$/g,"").slice(0,60);
const dias = ms => (Date.now() - ms) / 864e5;
const puntaje = f => f.frecuencia / (1 + dias(f.ultimo_acceso) / 30);

// Bloque para el system prompt; marca como accedidas las entradas enviadas.
export async function bloquePerfil(){
  const top = [...perfil].sort((a,b) => puntaje(b) - puntaje(a)).slice(0, MAX_EN_PROMPT);
  if (!top.length) return "(todavía no sabes nada de la persona)";
  const ahora = Date.now();
  await Promise.all(top.map(f => { f.ultimo_acceso = ahora; return storage.guardarPerfil(f); }));
  return top.map(f => `- [${f.categoria}] ${f.clave}: ${f.valor}`).join("\n");
}

// aprendizajes: [{clave, categoria, valor}] ; valor vacío = olvidar.
export async function aprender(aprendizajes){
  const hechos = [];
  for (const a of Array.isArray(aprendizajes) ? aprendizajes : []){
    const clave = normalizar(a?.clave); if (!clave) continue;
    const valor = String(a?.valor ?? "").trim().slice(0, 400);
    const previo = perfil.find(f => f.clave === clave);
    if (!valor){ if (previo){ await olvidar(clave); hechos.push("Olvidé: " + clave); } continue; }
    const categoria = CATEGORIAS.includes(a?.categoria) ? a.categoria : (previo?.categoria || "general");
    const fila = { clave, categoria, valor, frecuencia:(previo?.frecuencia || 0) + 1, ultimo_acceso:Date.now() };
    const nuevo = !previo || previo.valor !== valor;
    await storage.guardarPerfil(fila);
    if (previo) Object.assign(previo, fila); else perfil.push(fila);
    if (nuevo) hechos.push("Aprendí: " + valor);
  }
  return hechos;
}

export async function olvidar(clave){
  await storage.borrarPerfil(clave);
  perfil = perfil.filter(f => f.clave !== clave);
}
