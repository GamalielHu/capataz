// Empaqueta src/ en www/ (un solo bundle IIFE: sirve en navegador, Capacitor y Electron por file://)
import { build } from "esbuild";
import { cpSync, mkdirSync, rmSync, readFileSync, writeFileSync, readdirSync } from "node:fs";

rmSync("www", { recursive: true, force: true });
mkdirSync("www", { recursive: true });
await build({
  entryPoints: ["src/app.js"],
  bundle: true,
  format: "iife",
  target: ["chrome110", "safari15"],
  outfile: "www/app.js",
  minify: process.argv.includes("--min"),
  logLevel: "info"
});
cpSync("src/index.html", "www/index.html");
// estilos.css + los de src/ui/ en un solo archivo
writeFileSync("www/estilos.css", [readFileSync("src/estilos.css", "utf8"),
  ...readdirSync("src/ui").filter(f => f.endsWith(".css")).sort().map(f => readFileSync("src/ui/" + f, "utf8"))].join("\n"));
