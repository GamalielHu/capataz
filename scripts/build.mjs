// Empaqueta src/ en www/ (un solo bundle IIFE: sirve en navegador, Capacitor y Electron por file://)
import { build } from "esbuild";
import { cpSync, mkdirSync, rmSync } from "node:fs";

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
cpSync("src/estilos.css", "www/estilos.css");
