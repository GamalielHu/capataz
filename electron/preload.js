// Puente seguro: la ventana solo ve estas funciones (contextIsolation + sandbox, sin Node).
const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("capatazNativo", {
  db: (op, ...args) => ipcRenderer.invoke("db", op, ...args),
  ia: cuerpo => ipcRenderer.invoke("ia", cuerpo),
  voz: (texto, voz) => ipcRenderer.invoke("voz", texto, voz),
  guardarClave: clave => ipcRenderer.invoke("clave:guardar", clave),
  tieneClave: () => ipcRenderer.invoke("clave:hay"),
  claveGemini: () => ipcRenderer.invoke("clave:gemini"),
  autoinicio: activar => ipcRenderer.invoke("autoinicio", activar),
  abrir: url => ipcRenderer.invoke("abrir", url),
  alHablar: cb => ipcRenderer.on("hablar", () => cb()),
  avisosCambiaron: () => ipcRenderer.send("avisos:cambiaron"),
  alAccionar: cb => ipcRenderer.on("aviso:accion", (_e, accion, id) => cb(accion, id))
});
