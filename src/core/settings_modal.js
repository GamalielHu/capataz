// Ventana para ver, probar, editar y borrar la clave de IA.
import { $ } from "./util.js";
import { getApiKey, setApiKey, deleteApiKey, validateApiKey, maskKey, proveedor, importarRespaldo, puedeImportar, origenRecuperado } from "../adapters/secure_config.js";

export function iniciarModalClave({ alCambiar } = {}){
  const dlg = $("#dlg-clave"), entrada = $("#in-clave"), nota = $("#nota-clave"), ojo = $("#btn-ver-clave");
  const estado = (texto, tipo = "") => { nota.textContent = texto; nota.className = "nota clave-estado " + tipo; };
  const ocupado = v => dlg.querySelectorAll(".clave-acciones button").forEach(b => b.disabled = v);
  const ver = v => { entrada.type = v ? "text" : "password"; ojo.setAttribute("aria-pressed", String(v)); ojo.setAttribute("aria-label", v ? "Ocultar clave" : "Mostrar clave"); };

  async function resumen(){
    const clave = await getApiKey();
    $("#clave-resumen").textContent = clave ? `${proveedor(clave)} · ${maskKey(clave)}` : "Sin clave: Capataz funciona sin internet, pero no conversa libremente";
    return clave;
  }
  async function abrir(mensaje){
    const clave = await getApiKey();
    entrada.value = clave; ver(false);
    const rec = origenRecuperado();
    estado(mensaje || (clave ? (rec === "copia" ? "Clave recuperada de la copia de seguridad." : rec === "archivo" ? "Clave recuperada de Documentos/Capataz." : `Clave guardada (${proveedor(clave)}). Puedes verla con el ojo o cambiarla.`)
      : "No hay clave guardada. Sin clave, Capataz igual anota avisos y trabajos sin internet."), mensaje ? "error" : "");
    $("#fila-importar").hidden = !puedeImportar;
    dlg.showModal();
  }

  ojo.addEventListener("click", () => ver(entrada.type === "password"));
  $("#btn-probar-clave").addEventListener("click", async () => {
    ocupado(true); estado("Probando conexión…");
    const r = await validateApiKey(entrada.value); estado(r.mensaje, r.ok ? "ok" : "error"); ocupado(false);
  });
  $("#btn-guardar-clave").addEventListener("click", async () => {
    const clave = entrada.value.trim();
    if (!clave){ estado("Pega la clave primero.", "error"); return; }
    ocupado(true); estado("Probando conexión…");
    const r = await validateApiKey(clave);
    // Sin internet se guarda igual: se podrá usar cuando vuelva la conexión.
    if (!r.ok && !/Sin conexión/.test(r.mensaje)){ estado(r.mensaje + " No la guardé.", "error"); ocupado(false); return; }
    try { await setApiKey(clave); } catch { estado("No se pudo guardar la clave en este equipo.", "error"); ocupado(false); return; }
    await resumen(); alCambiar?.();
    estado(r.ok ? r.mensaje + " Clave guardada." : "Clave guardada (la probaré cuando haya internet).", "ok"); ocupado(false);
    setTimeout(() => dlg.open && dlg.close(), 1200);
  });
  $("#btn-borrar-clave").addEventListener("click", async () => {
    if (!confirm("¿Borrar la clave de IA de este equipo y de sus respaldos?")) return;
    await deleteApiKey(); entrada.value = ""; await resumen(); alCambiar?.();
    estado("Clave borrada.");
  });
  $("#in-respaldo").addEventListener("change", async e => {
    const f = e.target.files?.[0]; e.target.value = ""; if (!f) return;
    try { entrada.value = await importarRespaldo(await f.text()); await resumen(); alCambiar?.(); estado("Clave restaurada desde el archivo.", "ok"); }
    catch { estado("Ese archivo no es un respaldo de Capataz.", "error"); }
  });
  $("#btn-editar-clave").addEventListener("click", () => abrir());
  resumen();
  return { abrir, resumen };
}
