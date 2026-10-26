// Trabajos y avisos. Mismo modelo de datos que la versión artifact:
// tarea {tipo:"tarea", texto, proyecto, hecho, creado, terminado?} id "t…"
// aviso {tipo:"recordatorio", texto, cuando(ms), hecho, creado, terminado?} id "r…"
import { storage } from "../adapters/storage.js";
import { sincronizar } from "../adapters/notifications.js";
import { nuevoId } from "./util.js";

export let items = [];
const oyentes = new Set();
export const alCambiar = fn => oyentes.add(fn);

export const tareas = () => items.filter(x=>x.tipo==="tarea");
export const avisos = () => items.filter(x=>x.tipo==="recordatorio");

function cambio(tocaAvisos){
  oyentes.forEach(fn => fn());
  if (tocaAvisos) sincronizar(avisos());
}

export async function cargar(){
  await storage.iniciar();
  items = await storage.listar();
  cambio(true);
}

async function agregar(o){
  await storage.guardar(o);
  items.push(o);
  cambio(o.tipo==="recordatorio");
  return o;
}
export function agregarTarea(texto, proyecto){
  texto = String(texto||"").trim(); if(!texto) return null;
  return agregar({ id:nuevoId("t"), tipo:"tarea", texto, proyecto:String(proyecto||"").trim(), hecho:false, creado:Date.now() });
}
export function agregarAviso(texto, cuando){
  texto = String(texto||"").trim(); const t = typeof cuando==="number" ? cuando : new Date(cuando).getTime();
  if(!texto || !isFinite(t)) return null;
  return agregar({ id:nuevoId("r"), tipo:"recordatorio", texto, cuando:t, hecho:false, creado:Date.now() });
}
export async function actualizar(id, p){
  const it = items.find(x=>x.id===id); if(!it) return;
  const nuevo = { ...it, ...p };
  await storage.guardar(nuevo);
  Object.assign(it, p);
  cambio(it.tipo==="recordatorio");
}
export async function borrar(id){
  const it = items.find(x=>x.id===id);
  await storage.borrar(id);
  items = items.filter(x=>x.id!==id);
  cambio(it?.tipo==="recordatorio");
}
export const alternarHecho = it => actualizar(it.id, { hecho:!it.hecho, terminado: it.hecho?null:Date.now() });
export const posponer = (id, min=10) => actualizar(id, { cuando:Date.now()+min*60e3, hecho:false });

// Recarga desde la base (Electron: el proceso principal puede marcar avisos desde la notificación).
export async function recargar(){ items = await storage.listar(); cambio(false); }
