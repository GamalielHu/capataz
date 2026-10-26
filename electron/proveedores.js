// Proveedores de IA según la clave: "sk-ant-…" = Anthropic Claude; cualquier otra ("AIza…", "AQ.…") = Google Gemini (gratis).
// Módulo CommonJS compartido por la ventana (vía esbuild) y el proceso principal de Electron.
const MODELOS = { gemini: "gemini-flash-lite-latest", anthropic: "claude-sonnet-5-5" };
// Si un modelo de Gemini está saturado o no existe, se prueba el siguiente.
const RESPALDO_GEMINI = ["gemini-flash-lite-latest", "gemini-flash-latest", "gemini-3.5-flash"];

const proveedorDe = clave => /^sk-ant-/.test(clave) ? "anthropic" : "gemini";
const reintentable = codigo => codigo === "sobrecargado" || codigo === "rate_limited" || codigo === "api_404";

// Lista de pedidos a probar en orden.
function modelosA(clave, modelo){
  if (proveedorDe(clave) !== "gemini") return [modelo];
  return modelo && /^gemini/.test(modelo) ? [modelo, ...RESPALDO_GEMINI.filter(m => m !== modelo)] : RESPALDO_GEMINI;
}

// {system, messages:[{role:"user"|"assistant", content}], modelo?, maxTokens?} → {url, headers, body}
function peticion(clave, { system, messages, modelo, maxTokens = 4096 }, navegador = false){
  const p = proveedorDe(clave);
  const model = modelo && (p === "gemini") === /^gemini/.test(modelo) ? modelo : MODELOS[p];
  if (p === "gemini") return {
    url: `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`,
    headers: { "content-type": "application/json", "x-goog-api-key": clave },
    body: {
      systemInstruction: { parts: [{ text: system }] },
      contents: messages.map(m => ({ role: m.role === "assistant" ? "model" : "user", parts: [{ text: m.content }] })),
      generationConfig: { responseMimeType: "application/json", maxOutputTokens: maxTokens, temperature: 0.4 }
    }
  };
  return {
    url: "https://api.anthropic.com/v1/messages",
    headers: { "content-type": "application/json", "x-api-key": clave, "anthropic-version": "2023-06-01",
      ...(navegador ? { "anthropic-dangerous-direct-browser-access": "true" } : {}) },
    body: { model, max_tokens: maxTokens, system, messages }
  };
}

function textoDe(clave, datos){
  if (proveedorDe(clave) === "gemini")
    return (datos?.candidates?.[0]?.content?.parts || []).filter(p => !p.thought).map(p => p.text || "").join("");
  return (datos?.content || []).filter(b => b.type === "text").map(b => b.text).join("");
}

// Código de error para la interfaz.
function codigoError(estado, datos){
  const msg = JSON.stringify(datos || "");
  if (estado === 401 || estado === 403 || /API_KEY_INVALID|API key not valid/.test(msg)) return "clave_invalida";
  if (estado === 429) return "rate_limited";
  if (estado >= 500) return "sobrecargado";
  return "api_" + estado;
}

module.exports = { MODELOS, proveedorDe, peticion, textoDe, codigoError, modelosA, reintentable };
