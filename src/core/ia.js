// Loop de conversación: system = reglas + perfil aprendido + estado; respuesta JSON con mutaciones de estado.
import { enviar as llamarLLM } from "../adapters/llm.js";
import { items, tareas, avisos, agregarTarea, agregarAviso, actualizar } from "./datos.js";
import { bloquePerfil, aprender } from "./memoria.js";
import { cuandoTexto, localISO, ls } from "./util.js";

const REGLAS = `Eres Capataz, el asistente personal de una persona que lleva proyectos de construcción en Bolivia. Hablas español latinoamericano, claro, breve y amable (1 a 3 frases normalmente). Tu trabajo: anotar trabajos (tareas), programar recordatorios con fecha y hora, marcar cosas como hechas, responder qué tiene pendiente y recordar lo que aprendes de la persona. También puedes conversar de cualquier tema útil.

Responde SIEMPRE con un único objeto JSON, sin texto fuera de él:
{"respuesta":"lo que le dices",
 "nuevas_tareas":[{"texto":"...","proyecto":"nombre o vacío"}],
 "nuevos_recordatorios":[{"texto":"...","cuando":"AAAA-MM-DDTHH:MM"}],
 "completar":["id exacto de la lista"],
 "nuevos_aprendizajes":[{"clave":"identificador_corto","categoria":"persona|proyecto|proveedor|contacto|preferencia|rutina|general","valor":"dato en una frase"}]}
Usa [] en lo que no aplique. "cuando" va en hora local de la persona.
Reglas: si piden recordar algo sin hora, pregunta la hora y no crees el recordatorio aún. "Mañana" sin hora: pregunta, salvo que el perfil diga su hora habitual. Si dicen "en 20 minutos", calcula desde la hora actual. Varias cosas en un mensaje = varias entradas. Confirma en "respuesta" lo que hiciste con la fecha en palabras. Nunca inventes ids.
Aprendizaje: guarda solo datos estables y útiles a futuro (nombres de obras y su ubicación, proveedores y teléfonos, cuadrillas, horarios, preferencias, materiales habituales). Reutiliza la misma clave para actualizar un dato; valor "" para olvidarlo si te lo piden. No guardes lo que ya está en el perfil sin cambios ni datos de un solo uso.`;

const MAX_TURNOS = 16;
let turnos = ls.get("capataz-turnos", []);
export function borrarHistorial(){ turnos = []; ls.set("capataz-turnos", turnos); }

function contexto(){
  const ahora=new Date();
  const fecha = new Intl.DateTimeFormat("es",{weekday:"long",day:"numeric",month:"long",year:"numeric",hour:"2-digit",minute:"2-digit"}).format(ahora);
  const pend = tareas().filter(t=>!t.hecho).slice(0,60).map(t=>`- [${t.id}] ${t.texto}${t.proyecto?" (proyecto: "+t.proyecto+")":""}`).join("\n") || "(ninguno)";
  const avs = avisos().filter(a=>!a.hecho).sort((a,b)=>a.cuando-b.cuando).slice(0,40).map(a=>`- [${a.id}] ${localISO(new Date(a.cuando))} ${a.texto}`).join("\n") || "(ninguno)";
  return `Ahora es ${fecha} (${localISO(ahora)}).\nTrabajos pendientes:\n${pend}\nRecordatorios pendientes:\n${avs}`;
}

function parsear(texto){
  const i = texto.indexOf("{"), j = texto.lastIndexOf("}");
  try { return JSON.parse(texto.slice(i, j+1)); } catch { throw { code:"invalid_json" }; }
}
const lista = v => Array.isArray(v) ? v : [];

async function aplicar(r){
  const hechos=[];
  for (const t of lista(r.nuevas_tareas)) try { const o=await agregarTarea(t?.texto, t?.proyecto); if(o) hechos.push("Trabajo anotado: "+o.texto); } catch {}
  for (const a of lista(r.nuevos_recordatorios)) try { const o=await agregarAviso(a?.texto, a?.cuando); if(o) hechos.push("Aviso: "+o.texto+" · "+cuandoTexto(o.cuando)); } catch {}
  for (const id of lista(r.completar)) try {
    const it=items.find(x=>x.id===String(id?.id ?? id));
    if(it && !it.hecho){ await actualizar(it.id,{hecho:true,terminado:Date.now()}); hechos.push("Marcado como hecho: "+it.texto); }
  } catch {}
  try { hechos.push(...await aprender(r.nuevos_aprendizajes)); } catch {}
  return hechos;
}

// Devuelve {respuesta, hechos}. Lanza {code} si falla.
export async function conversar(texto, modelo){
  const system = `${REGLAS}\n\n## Lo que sabes de la persona\n${await bloquePerfil()}\n\n## Estado actual\n${contexto()}`;
  const messages = [...turnos.slice(-MAX_TURNOS), { role:"user", content:texto }];
  const r = parsear(await llamarLLM({ system, messages, modelo }));
  const respuesta = typeof r?.respuesta==="string" && r.respuesta.trim() ? r.respuesta.trim() : "Listo.";
  const hechos = await aplicar(r);
  turnos.push({role:"user",content:texto},{role:"assistant",content:JSON.stringify({respuesta, aplicado:hechos})});
  turnos = turnos.slice(-MAX_TURNOS);
  ls.set("capataz-turnos", turnos);
  return { respuesta, hechos };
}
