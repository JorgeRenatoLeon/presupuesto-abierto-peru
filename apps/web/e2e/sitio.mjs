// Browser checks on the built static site, at phone width (375 px), with real data.
// The refresh workflow runs them before every deploy: a failure blocks publishing.
//
//   npx playwright-core install chromium        # once
//   E2E_BASE=http://127.0.0.1:8767 node e2e/sitio.mjs   # E2E_BASE includes the base path, if any
//
// Data-dependent on purpose: Cusco (08), the province of Urubamba (0813, 7 districts), the
// municipalities of Ollantaytambo (300790) and Huaso (301160) exist in every MEF publication.
import { chromium } from "playwright-core";

const BASE = (process.env.E2E_BASE ?? "http://127.0.0.1:8767").replace(/\/$/, "");
const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 375, height: 812 }, locale: "es-PE", reducedMotion: "reduce" });
const page = await ctx.newPage();
const errores = [];
page.on("pageerror", (e) => errores.push(`pageerror ${page.url()}: ${e.message}`));
page.on("console", (m) => { if (m.type() === "error") errores.push(`console ${page.url()}: ${m.text()}`); });

let fallos = 0;
const check = (ok, msg) => { console.log(`${ok ? "PASS" : "FAIL"} ${msg}`); if (!ok) fallos++; };
const paso = async (nombre, fn) => {  // one failing step must not hide the others
  try { await fn(); } catch (e) { check(false, `${nombre}: ${e.message.split("\n")[0]}`); }
};
const sinScroll = async (nombre) => {
  const [sw, vw] = await page.evaluate(() => [document.documentElement.scrollWidth, window.innerWidth]);
  check(sw <= vw, `${nombre}: no horizontal scroll at 375px (${sw} <= ${vw})`);
};
const listo = () => page.waitForFunction(() => !document.body.innerText.includes("Cargando…"), null, { timeout: 15000 });

await paso("home", async () => {
  await page.goto(`${BASE}/`);
  check(await page.locator(".franja .franja-seg").count() >= 5, "home: budget split drawn as one ink band");
  const soles = await page.locator(".reparto-valor").allInnerTexts();
  check(soles.reduce((a, s) => a + Number(s.replace(/\D/g, "")), 0) === 100, `home: shares add up to exactly 100 (${soles.join(", ")})`);
  await sinScroll("home");
  await page.getByLabel("Busca tu municipalidad").fill("ollanta");
  await page.getByRole("link", { name: /Ollantaytambo/ }).first().click();
  await page.waitForURL(/entidad\/300790/);
  check(true, "finder: 'ollanta' -> municipality of Ollantaytambo");
});

await paso("municipality", async () => {
  check(await page.getByRole("navigation", { name: "Ubicación" }).getByText(/Urubamba/).first().isVisible(), "entity: breadcrumb shows the province");
  check(await page.getByText(/Puesto \d+ de \d+/).isVisible(), "entity: rank among the province's municipalities");
  await page.locator("details summary", { hasText: "Transporte" }).first().click();
  await page.getByText("En qué lo usa").first().waitFor();
  check(true, "entity: opening Transporte loads its activities and projects");
  await page.getByRole("button", { name: /Definición oficial/ }).first().click();
  await page.locator(".explica-oficial").first().waitFor();
  check(true, "entity: MEF's official definition loads");
  const fila = page.locator("details[open] .desglose-fila").first();
  check(await fila.getByText("Presupuesto", { exact: true }).isVisible() && await fila.getByText("Gastado", { exact: true }).isVisible(),
        "entity: función row labels its budget and what was spent");
  await page.getByRole("button", { name: "¿En qué exactamente?" }).first().click();
  const detalle = page.locator(".detalle-item").first();
  await detalle.waitFor();
  check(await detalle.locator("li").count() > 1 && await detalle.getByText("Qué se compra o se paga").isVisible(),
        "entity: an activity opens its metas, expense types and sources");
  check(await detalle.getByText("De dónde sale el dinero").isVisible(), "entity: the detail says where the money comes from");
  await sinScroll("entidad/300790 (detail open)");
  const nav = page.getByRole("navigation", { name: "Secciones de esta página" });
  await nav.getByRole("link", { name: "Obras" }).click();
  await page.waitForFunction(() => location.hash === "#obras");
  check(await page.locator("#obras h2").isVisible(), "entity: the section strip jumps to Obras");
  check(await nav.isVisible(), "entity: the section strip stays visible while scrolling");
});

await paso("contracts", async () => {
  await page.goto(`${BASE}/entidad/300790/#contratos`);
  const sec = page.locator("#contratos");
  check(await sec.locator("h2").isVisible(), "contracts: «¿A quién le contrata?» on a municipality");
  check(await page.getByRole("navigation", { name: "Secciones de esta página" }).getByRole("link", { name: "A quién contrata" }).count() === 1,
        "contracts: the section strip links to it");
  check(await sec.locator(".kpi").count() === 4 && await sec.getByText("Un solo postor", { exact: true }).first().isVisible(),
        "contracts: amount, suppliers, single bidder and no-competition figures");
  check(await sec.locator(".ct-top li").count() >= 1, "contracts: its largest suppliers are listed");
  const filas = sec.locator(".contratos .contrato");
  await filas.first().waitFor({ timeout: 15000 });
  check(await filas.count() >= 1, `contracts: the list loads (${await filas.count()} rows)`);
  const pdf = await sec.locator(".ct-docs a", { hasText: "Contrato firmado" }).first().getAttribute("href");
  check(/^https:\/\/prod4\.seace\.gob\.pe:9000\/api\/con\/documentos\/descargar\/\d+$/.test(pdf ?? ""),
        "contracts: the signed contract links to its PDF in SEACE");
  const proveedor = await sec.locator(".contratos .ct-quien b").first().innerText();
  const buscar = sec.getByLabel("Buscar en los contratos");
  await buscar.fill(proveedor);
  check(await filas.count() >= 1 && (await sec.locator(".contratos .ct-quien b").allInnerTexts()).every((t) => t === proveedor),
        `contracts: searching «${proveedor.slice(0, 30)}» keeps only that supplier`);
  await buscar.fill("zzzz sin coincidencias");
  check(await sec.getByText("Ningún contrato coincide").isVisible(), "contracts: a search with no match says so");
  await buscar.fill("");
  await sinScroll("entidad/300790#contratos");
  const boton = page.locator("#obras .ct-obra-boton").first();
  await boton.click();
  await page.locator("#obras .contratos.compacto .contrato").first().waitFor();
  check(await boton.getAttribute("aria-expanded") === "true", "contracts: a project opens the contracts that carry its CUI");
  await sinScroll("entidad/300790#obras (project contracts open)");
  await page.goto(`${BASE}/metodologia/#contratos`);
  check(await page.locator("#contratos h2").isVisible(), "metodologia: explains where contracts come from and their limits");
});

await paso("budget without description", async () => {
  await page.goto(`${BASE}/entidad/472/#en-que`);  // Fuerza Aérea del Perú: S/ 2,061 M under the generic code
  await page.locator("details summary", { hasText: /Defensa y seguridad/i }).first().click();
  await page.locator(".badge.sin-descripcion").first().waitFor();
  check(await page.getByText("Sin nombre en los datos del MEF").first().isVisible(), "FAP: the nameless project is labelled, not left blank");
  await page.getByRole("button", { name: "¿Qué se sabe de este presupuesto?" }).first().click();
  await page.locator(".aviso-sd").first().waitFor();
  check(await page.getByText(/transporte aéreo/i).first().isVisible(), "FAP: the detail shows what is public (expense types)");
  await page.goto(`${BASE}/auditar/`);
  check(await page.getByText("Presupuesto sin descripción").first().isVisible(), "auditar: budget without description is a signal");
});

await paso("province", async () => {
  await page.goto(`${BASE}/localidad/08/13/#d081306`);
  check(await page.locator("#d081306").isVisible(), "province: district anchor visible");
  check((await page.locator(".distritos > li").count()) === 7, "province: the 7 districts of Urubamba listed");
  await sinScroll("localidad/08/13");
});

await paso("region", async () => {
  await page.goto(`${BASE}/localidad/08/`);
  check(await page.getByRole("link", { name: /Urubamba/ }).first().isVisible(), "region: provinces listed");
  await page.getByRole("button", { name: "Seguir", exact: true }).first().click();
  check(await page.getByRole("button", { name: "Siguiendo", exact: true }).count() > 0, "region: Seguir toggles to Siguiendo");
  await page.getByPlaceholder("Busca tu distrito o municipalidad…").last().fill("urubamba");
  check(await page.locator("a.fila-lista:has-text('Urubamba')").count() > 0, "region: municipality search finds Urubamba");
  await sinScroll("localidad/08");
});

await paso("entity", async () => {
  await page.goto(`${BASE}/entidad/301160/`);
  check(await page.locator("#obras h2").count() === 1, "entity: projects section present");
  await page.getByRole("button", { name: "Seguir", exact: true }).click();
  await sinScroll("entidad/301160");
});

await paso("comparator", async () => {
  await page.goto(`${BASE}/comparar/funcion/`);
  const antes = await page.locator(".cmp-fila").count();
  await page.locator("button.cmp-toggle").first().click();
  check(await page.locator(".cmp-fila").count() > antes, "comparar: expanding a row shows its children");
  await page.locator("button.seguir-compacto").first().click();
  check(await page.locator("button.seguir-compacto.activo").count() === 1, "comparar: following a top-level función");
  await page.getByRole("button", { name: /Ver qué es Planeamiento/i }).first().click();
  await page.locator(".explica-oficial").first().waitFor();
  check(await page.getByText("¿En qué se usa este dinero?").first().isVisible(), "comparar: ? opens the definition and what it is spent on");
  await page.getByPlaceholder(/Buscar en/).fill("educacion basica");
  check(await page.locator(".cmp-fila:has-text('Educación básica')").count() > 0, "comparar: accent-insensitive search finds 'Educación básica'");
  await sinScroll("comparar/funcion");
});

await paso("watchlist", async () => {
  await page.goto(`${BASE}/seguimiento/`);
  await listo();
  const titulos = await page.locator("section.tarjeta h2").allInnerTexts();
  check(titulos.some((t) => t.toLowerCase() === "cusco") && titulos.length >= 4, `siguiendo: shows followed items (${titulos.join(" / ")})`);
  check(!(await page.locator("text=No encontramos datos").count()), "siguiendo: every followed item resolved its data file");
  await page.reload();
  await listo();
  check(await page.locator("text=Nada nuevo desde tu última visita").count() === 1, "siguiendo: 2nd visit says nothing new");
  await sinScroll("seguimiento");
});

await paso("alerts", async () => {
  await page.goto(`${BASE}/alertas/?dep=08`);
  await page.waitForFunction(() => /con este filtro/.test(document.body.innerText), null, { timeout: 15000 });
  check(await page.locator('select[aria-label="Filtrar por departamento"]').inputValue() === "08", "alertas: ?dep=08 selects Cusco");
  await page.getByRole("button", { name: /^Proyectos sin avance/ }).click();
  await page.waitForFunction(() => location.search.includes("regla=OBRA_SIN_AVANCE"));
  await page.waitForTimeout(500);
  const reglas = await page.locator("article.alerta h3").allInnerTexts();
  check(reglas.length > 0 && reglas.every((t) => t.startsWith("Proyecto de")), `alertas: rule tab filters within Cusco (${reglas.length})`);
  await sinScroll("alertas");
});

await paso("region picker", async () => {
  await page.goto(`${BASE}/`);
  await page.selectOption('select[aria-label="Elige tu departamento"]', "15");
  await page.waitForURL(/\/localidad\/15\//, { timeout: 10000 });
  check(true, "home: region picker navigates to Lima");
});

await paso("other pages", async () => {
  for (const p of ["/auditar/", "/localidad/", "/comparar/", "/metodologia/", "/glosario/", "/ingresos/"]) {
    await page.goto(`${BASE}${p}`);
    await sinScroll(p);
  }
  check(await page.goto(`${BASE}/glosario/`).then(() => page.getByText("Devengado (gastado)").isVisible()), "glosario: terms render");
  const r = await page.goto(`${BASE}/404.html`);
  check(!!r?.ok() && await page.getByLabel("Busca tu municipalidad").isVisible(), "404 page offers the municipality search");
});

check(errores.length === 0, errores.length ? `console/page errors:\n  ${errores.join("\n  ")}` : "no console/page errors");
await browser.close();
console.log(fallos ? `\n${fallos} check(s) failed` : "\nall checks passed");
process.exit(fallos ? 1 : 0);
