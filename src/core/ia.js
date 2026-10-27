// Loop de conversación: system = reglas + perfil aprendido + estado; respuesta JSON con mutaciones de estado.
import { enviar as llamarLLM, tieneClave } from "../adapters/llm.js";
import { interpretar, AYUDA } from "./interprete.js";
import { items, tareas, avisos, agregarTarea, agregarAviso, actualizar } from "./datos.js";
import { bloquePerfil, aprender, listarPerfil } from "./memoria.js";
import { cuandoTexto, localISO, ls } from "./util.js";

export const PERSONA = `Eres Capataz, el asistente personal de una persona que lleva proyectos de construcción en Bolivia. No eres un robot de respuestas: eres como un amigo de confianza y mano derecha en la obra, con criterio propio. Hablas español latinoamericano con naturalidad (puedes usar alguna expresión boliviana con moderación), cálido, directo y con buen humor cuando cabe. Le llamas por su nombre si lo sabes. Muestras interés real: preguntas cómo le fue, te acuerdas de lo que te contó antes y le das seguimiento ("¿y al final llegó el fierro?"). Si algo no cuadra, se lo dices con respeto; si no sabes algo, lo admites.
Eres un asistente completo, como ChatGPT: conversas de cualquier tema, explicas, calculas (materiales, dosificaciones, metrados, costos), redactas mensajes y das ideas. Además llevas su agenda: anotas trabajos, programas recordatorios con fecha y hora, marcas cosas como hechas y le dices qué tiene pendiente. Respuestas breves por defecto (1 a 4 frases); más largas solo si lo pide o el tema lo necesita. Usa lo que sabes de la persona para personalizar sin repetirlo a cada rato.`;
const APRENDER = `Aprendizaje continuo: en CADA mensaje fíjate si la persona revela algo nuevo y útil a futuro y guárdalo en nuevos_aprendizajes: quién es, su familia y equipo, obras (nombre, ubicación, cliente, avance), proveedores, precios que paga, teléfonos, cuadrillas, horarios, gustos, forma de hablar, metas, problemas recurrentes y cómo los resolvió. También aprende de cómo te corrige ("no, a las 8 no, siempre a las 7" = preferencia). Reutiliza la misma clave para actualizar un dato; valor "" para olvidarlo si te lo piden. No repitas lo que ya está igual en el perfil ni guardes datos de un solo uso.`;

const REGLAS = `${PERSONA}

Si te manda una FOTO (plano, factura, proforma, material, avance de obra, fisura, etc.), analízala con ojo de constructor: describe lo importante, calcula o extrae datos (cantidades, montos, medidas) y da recomendaciones; si sirve, anota trabajos o avisos a partir de ella.

Responde SIEMPRE con un único objeto JSON, sin texto fuera de él:
{"respuesta":"lo que le dices",
 "nuevas_tareas":[{"texto":"...","proyecto":"nombre o vacío"}],
 "nuevos_recordatorios":[{"texto":"...","cuando":"AAAA-MM-DDTHH:MM"}],
 "completar":["id exacto de la lista"],
 "nuevos_aprendizajes":[{"clave":"identificador_corto","categoria":"persona|proyecto|proveedor|contacto|preferencia|rutina|general","valor":"dato en una frase"}]}
Usa [] en lo que no aplique. "cuando" va en hora local de la persona.
Reglas: si piden recordar algo sin hora, pregunta la hora y no crees el recordatorio aún. "Mañana" sin hora: pregunta, salvo que el perfil diga su hora habitual. Si dicen "en 20 minutos", calcula desde la hora actual. Varias cosas en un mensaje = varias entradas. Confirma en "respuesta" lo que hiciste con la fecha en palabras. Nunca inventes ids.
${APRENDER}`;

const MAX_TURNOS = 16;
// Cada chat guarda su propia conversación; la memoria, los trabajos y los avisos son comunes a todos.
let chatId = "general", turnos = [], otrosChats = "";
const claveTurnos = id => "capataz-turnos:" + id;
export function usarChat(id, otros = []){
  chatId = id; turnos = ls.get(claveTurnos(id), []);
  otrosChats = otros.length ? otros.map(c => "- " + c).join("\n") : "";
}
const guardarTurnos = () => { turnos = turnos.slice(-MAX_TURNOS); ls.set(claveTurnos(chatId), turnos); };
export function borrarHistorial(id = chatId){ if (id === chatId) turnos = []; ls.del(claveTurnos(id)); }

function contexto(){
  const ahora=new Date();
  const fecha = new Intl.DateTimeFormat("es",{weekday:"long",day:"numeric",month:"long",year:"numeric",hour:"2-digit",minute:"2-digit"}).format(ahora);
  const pend = tareas().filter(t=>!t.hecho).slice(0,60).map(t=>`- [${t.id}] ${t.texto}${t.proyecto?" (proyecto: "+t.proyecto+")":""}`).join("\n") || "(ninguno)";
  const avs = avisos().filter(a=>!a.hecho).sort((a,b)=>a.cuando-b.cuando).slice(0,40).map(a=>`- [${a.id}] ${localISO(new Date(a.cuando))} ${a.texto}`).join("\n") || "(ninguno)";
  return `Ahora es ${fecha} (${localISO(ahora)}).${otrosChats ? "\nOtros chats que tiene contigo (temas aparte; lo importante de ellos está en el perfil):\n" + otrosChats : ""}\nTrabajos pendientes:\n${pend}\nRecordatorios pendientes:\n${avs}`;
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
// Sin clave (o sin internet) responde el intérprete propio; con clave conversa la IA.
async function sinIA(texto){
  const estado = {
    tareas: tareas().filter(t=>!t.hecho).sort((a,b)=>b.creado-a.creado),
    avisos: avisos().filter(a=>!a.hecho).sort((a,b)=>a.cuando-b.cuando),
    perfil: listarPerfil(),
    proyectos: [...new Set(tareas().map(t=>t.proyecto).filter(Boolean))]
  };
  const r = interpretar(texto, estado) || { respuesta: "No te entendí. " + AYUDA };
  const hechos = (await aplicar(r)).filter(h => !/^Aprendí|^Olvidé/.test(h));
  return { respuesta: r.respuesta, hechos };
}

const VOZ = "\n\nAhora conversan por VOZ: responde como se habla, en frases cortas, sin listas, viñetas, emojis ni símbolos; di las fechas y horas en palabras.";

export async function conversar(texto, modelo, { voz = false, imagen = null } = {}){
  if (!(await tieneClave())){
    if (imagen) return { respuesta:"Para mirar fotos necesito una clave de IA. Ponla gratis en Ajustes (la de Gemini).", hechos:[] };
    return sinIA(texto);
  }
  try { return await conIA(texto, modelo, voz, imagen); }
  catch(e){ if (e?.code === "red") return sinIA(texto); throw e; }
}

async function conIA(texto, modelo, voz, imagen){
  if (imagen && !texto) texto = "Mira esta foto y dime qué ves y qué me recomiendas.";
  const primero = !turnos.length;
  const system = `${REGLAS}${primero ? '\nEs el primer mensaje de este chat: agrega también "titulo" con 2 a 5 palabras que nombren el tema (ej. "Obra Achumani", "Cálculo de losa").' : ""}${voz ? VOZ : ""}\n\n## Lo que sabes de la persona\n${await bloquePerfil()}\n\n## Estado actual\n${contexto()}`;
  const messages = [...turnos.slice(-MAX_TURNOS), { role:"user", content:texto }];
  const r = parsear(await llamarLLM({ system, messages, modelo, imagen }));
  const respuesta = typeof r?.respuesta==="string" && r.respuesta.trim() ? r.respuesta.trim() : "Listo.";
  const hechos = await aplicar(r);
  turnos.push({role:"user",content:(imagen ? "[envió una foto] " : "") + texto},{role:"assistant",content:JSON.stringify({respuesta, aplicado:hechos})});
  guardarTurnos();
  const titulo = primero && typeof r?.titulo === "string" ? r.titulo.trim().slice(0, 40) : "";
  return { respuesta, hechos, titulo };
}

export function agregarTurno(usuario, respuesta){
  turnos.push({role:"user",content:usuario},{role:"assistant",content:JSON.stringify({respuesta, aplicado:[]})});
  guardarTurnos();
}

/* ---------- Voz en tiempo real (Gemini Live): herramientas en vez de JSON ---------- */
export async function sistemaViva(){
  const previos = turnos.slice(-8).map(t => (t.role === "user" ? "Persona: " + t.content : "Tú: " + (()=>{ try { return JSON.parse(t.content).respuesta; } catch { return t.content; } })())).join("\n");
  return `${PERSONA}

Ahora están conversando POR VOZ en tiempo real, como una llamada. Habla como una persona: frases cortas y naturales, con pausas, sin listas ni símbolos; di fechas y horas en palabras. Si te interrumpe, deja lo que estabas diciendo y escúchale. Saluda brevemente al empezar, por su nombre si lo sabes, y si tiene algo vencido o importante hoy, menciónalo.
HERRAMIENTAS (obligatorio): cuando pida anotar algo, llama a crear_trabajo; cuando pida que le recuerdes o avises algo con hora, llama a crear_recordatorio (si no dijo la hora, pregúntala primero); cuando diga que terminó algo, llama a marcar_hecho con el id exacto de la lista; cuando te cuente un dato útil de sí mismo, su obra o su gente, llama a aprender_dato. NUNCA digas que anotaste, agendaste o recordarás algo sin haber llamado antes a la herramienta. Después de usarla, confírmalo en una frase. Para datos actuales (precios, clima, noticias, horarios) busca en Google.
${APRENDER.replace("guárdalo en nuevos_aprendizajes", "guárdalo con aprender_dato")}

## Lo que sabes de la persona
${await bloquePerfil()}

## Estado actual
${contexto()}
${previos ? "\n## Lo último que hablaron por escrito\n" + previos : ""}`;
}

export const HERRAMIENTAS = [
  { name:"crear_trabajo", description:"Anota un trabajo/tarea pendiente.", parameters:{ type:"OBJECT", properties:{
    texto:{ type:"STRING" }, proyecto:{ type:"STRING", description:"obra o proyecto; vacío si no aplica" } }, required:["texto"] } },
  { name:"crear_recordatorio", description:"Programa un aviso que suena en el celular a la fecha y hora indicadas.", parameters:{ type:"OBJECT", properties:{
    texto:{ type:"STRING" }, cuando:{ type:"STRING", description:"AAAA-MM-DDTHH:MM en hora local de la persona" } }, required:["texto","cuando"] } },
  { name:"marcar_hecho", description:"Marca como hecho un trabajo o aviso de la lista.", parameters:{ type:"OBJECT", properties:{
    id:{ type:"STRING", description:"id exacto de la lista de pendientes" } }, required:["id"] } },
  { name:"aprender_dato", description:"Guarda en la memoria a largo plazo un dato útil sobre la persona, su trabajo o sus preferencias.", parameters:{ type:"OBJECT", properties:{
    clave:{ type:"STRING", description:"identificador corto, igual para actualizar" },
    categoria:{ type:"STRING", enum:["persona","proyecto","proveedor","contacto","preferencia","rutina","general"] },
    valor:{ type:"STRING", description:"el dato en una frase; vacío para olvidarlo" } }, required:["clave","valor"] } }
];

// Ejecuta una herramienta pedida por la IA. Devuelve {resultado (para la IA), hechos (para mostrar)}.
export async function ejecutarHerramienta(nombre, a = {}){
  const r = {
    crear_trabajo: { nuevas_tareas:[{ texto:a.texto, proyecto:a.proyecto }] },
    crear_recordatorio: { nuevos_recordatorios:[{ texto:a.texto, cuando:a.cuando }] },
    marcar_hecho: { completar:[a.id] },
    aprender_dato: { nuevos_aprendizajes:[{ clave:a.clave, categoria:a.categoria, valor:a.valor }] }
  }[nombre];
  if (!r) return { resultado:"herramienta desconocida", hechos:[] };
  const hechos = await aplicar(r);
  return { resultado: hechos.length ? "Hecho: " + hechos.join("; ") : "No se pudo (revisa los datos o el id).", hechos };
}
