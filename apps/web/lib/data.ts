import { readFileSync, existsSync, statSync } from "node:fs";
import { join } from "node:path";

export * from "./types";

/** Data directory resolution (first hit wins):
 *  1. PRESUPUESTO_DATA_DIR env var
 *  2. apps/web/public/data (synced copy — used by builds)
 *  3. ../../data/serving/json (pipeline output at repo root — dev fallback,
 *     so `next dev` shows data even if sync-data never ran)
 */
function hasRealData(dir: string): boolean {
  const probe = join(dir, "resumen_anual.json");
  // > 50 bytes distinguishes real data from the "[]" placeholders sync-data creates
  return existsSync(probe) && statSync(probe).size > 50;
}

function resolveDataDir(): string {
  if (process.env.PRESUPUESTO_DATA_DIR) return process.env.PRESUPUESTO_DATA_DIR;
  const publicData = join(process.cwd(), "public", "data");
  if (hasRealData(publicData)) return publicData;
  const pipelineOut = join(process.cwd(), "..", "..", "data", "serving", "json");
  if (hasRealData(pipelineOut)) return pipelineOut;
  return publicData;
}

export const DATA_DIR = resolveDataDir();

// mtime-aware memo: avoids re-parsing big JSONs (entidades, alertas) on every
// render/page during builds, while staying fresh in dev.
const cache = new Map<string, { mtime: number; value: unknown }>();

export function load<T>(name: string): T {
  const p = join(DATA_DIR, name);
  if (!existsSync(p)) return (name === "meta.json" ? {} : []) as T;
  const mtime = statSync(p).mtimeMs;
  const hit = cache.get(p);
  if (hit && hit.mtime === mtime) return hit.value as T;
  const value = JSON.parse(readFileSync(p, "utf-8"));
  cache.set(p, { mtime, value });
  return value as T;
}

/** An object-shaped file that may not exist yet (e.g. comparar/resumen.json before the
 *  pipeline's first `compare` run): null when missing or an empty placeholder. */
export function loadOptional<T extends object>(name: string): T | null {
  const v = load<unknown>(name);
  return v && typeof v === "object" && !Array.isArray(v) && Object.keys(v).length ? (v as T) : null;
}
