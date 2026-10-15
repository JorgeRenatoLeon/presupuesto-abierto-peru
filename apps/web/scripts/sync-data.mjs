// Copies pipeline JSON outputs into public/data before build.
import { cpSync, existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const src = join(here, "..", "..", "..", "data", "serving", "json");
const dest = join(here, "..", "public", "data");

mkdirSync(dest, { recursive: true });
if (existsSync(src)) {
  cpSync(src, dest, { recursive: true });
  console.log(`sync-data: copied ${src} -> public/data`);
} else {
  console.warn(`sync-data: ${src} not found — keeping existing public/data`);
}

// Ensure required files exist so the build never breaks on missing data
const required = [
  "resumen_anual.json", "serie_nacional.json", "por_funcion.json",
  "por_departamento.json", "top_entidades.json", "alertas.json", "meta.json",
  "ingreso_resumen_anual.json", "ingreso_por_fuente.json", "ingreso_por_generica.json",
  "ingreso_por_nivel.json", "serie_ingreso_nacional.json", "contraste_mensual.json",
  "comparar/resumen.json",
];
const objectFiles = new Set(["meta.json", "comparar/resumen.json"]);
for (const f of required) {
  const p = join(dest, f);
  mkdirSync(dirname(p), { recursive: true });
  if (!existsSync(p)) writeFileSync(p, objectFiles.has(f) ? "{}" : "[]");
}
