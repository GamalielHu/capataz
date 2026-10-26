// Puente seguro: la ventana solo ve estas funciones (contextIsolation + sandbox, sin Node).
const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("capatazNativo", {
  db: (op, ...args) => ipcRenderer.invoke("db", op, ...args),
  ia: cuerpo => ipcRenderer.invoke("ia", cuerpo),
  guardarClave: clave => ipcRenderer.invoke("clave:guardar", clave),
  tieneClave: () => ipcRenderer.invoke("clave:hay"),
  autoinicio: activar => ipcRenderer.invoke("autoinicio", activar),
  avisosCambiaron: () => ipcRenderer.send("avisos:cambiaron"),
  alAccionar: cb => ipcRenderer.on("aviso:accion", (_e, accion, id) => cb(accion, id))
});
