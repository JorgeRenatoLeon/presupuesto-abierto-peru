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
page.on("console", (m) => {
  // an unknown supplier's file is a 404 by design: the page says so
  if (m.type() === "error" && !(page.url().includes("id=00000000000") && m.text().includes("404"))) errores.push(`console ${page.url()}: ${m.text()}`);
});

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
  const ruta = page.getByRole("navigation", { name: "De dónde a dónde va su presupuesto" });
  check(await ruta.getByRole("link").count() >= 4, "entity: the money map shows budget -> areas -> activities and works -> suppliers");
  check(await ruta.getByRole("link", { name: /Contrata a/ }).getAttribute("href") === "#contratos", "entity: each step of the map links to its section");
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
  check(await detalle.locator(".parte .parte-barra").count() > 1, "entity: each expense type shows its share of the activity");
  const proyecto = page.locator("details[open] .items li", { has: page.locator(".etiqueta-tipo.proyecto") }).first();
  check(await proyecto.count() === 1, "entity: Transporte lists its projects");
  if (!(await proyecto.locator(".detalle-item").count())) await proyecto.getByRole("button", { name: "¿En qué exactamente?" }).click();
  await proyecto.locator(".ct-del-proyecto").waitFor({ timeout: 15000 });
  check(true, "entity: a project's detail shows its own contracts (by CUI)");
  await proyecto.locator(".obra-entera").waitFor({ timeout: 15000 });
  check(await proyecto.locator(".obra-entera").getByText("Costo total").isVisible(),
        "entity: a project's detail shows the whole project (total cost, spent since it began), not just this year");
  await sinScroll("entidad/300790 (detail open)");
  await page.locator("details[open] .desglose-panel > .cerrar-panel", { hasText: "Cerrar «Transporte»" }).click();
  check(await page.locator("details[open] .desglose-panel").count() === 0, "entity: «Cerrar «Transporte»» closes the área's panel");
  const nav = page.getByRole("navigation", { name: "Secciones de esta página" });
  await nav.getByRole("link", { name: "Obras" }).click();
  await page.waitForFunction(() => location.hash === "#obras");
  check(await page.locator("#obras h2").isVisible(), "entity: the section strip jumps to Obras");
  check(await page.locator("#obras .obra-total").count() > 0, "entity: projects show their whole cost and progress, not just this year's budget");
  check(await nav.isVisible(), "entity: the section strip stays visible while scrolling");
});

await paso("contracts", async () => {
  await page.goto(`${BASE}/entidad/300790/#contratos`);
  const sec = page.locator("#contratos");
  check(await sec.locator("h2").isVisible(), "contracts: «¿A quién le contrata?» on a municipality");
  check(await page.getByRole("navigation", { name: "Secciones de esta página" }).getByRole("link", { name: "A quién contrata" }).count() === 1,
        "contracts: the section strip links to it");
  check(await sec.locator(".kpi").count() === 4 && await sec.getByText("Un solo participante", { exact: true }).first().isVisible(),
        "contracts: amount, suppliers, single bidder and no-competition figures");
  check(await sec.locator(".ct-top li").count() >= 1, "contracts: its largest suppliers are listed");
  const filas = sec.locator("#contratos-lista .contratos .contrato");
  await filas.first().waitFor({ timeout: 15000 });
  check(await filas.count() >= 1, `contracts: the list loads (${await filas.count()} rows)`);
  const pdf = await sec.locator(".ct-docs a", { hasText: "Contrato firmado" }).first().getAttribute("href");
  check(/^https:\/\/prod4\.seace\.gob\.pe:9000\/api\/con\/documentos\/descargar\/\d+$/.test(pdf ?? ""),
        "contracts: the signed contract links to its PDF in SEACE");
  const proveedor = await sec.locator("#contratos-lista .contratos .ct-quien b").first().innerText();
  const buscar = sec.getByLabel("Buscar en los contratos");
  await buscar.fill(proveedor);
  check(await filas.count() >= 1 && (await sec.locator("#contratos-lista .contratos .ct-quien b").allInnerTexts()).every((t) => t === proveedor),
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

await paso("what contracts buy, by expense type", async () => {
  await page.goto(`${BASE}/entidad/300790/#contratos`);
  const sec = page.locator("#contratos");
  await sec.locator("#contratos-lista .contratos .contrato").first().waitFor({ timeout: 15000 });
  check(await sec.locator(".ct-lineas").count() > 0, "contracts: rows say what was bought, line by line");
  check(await sec.locator(".ct-gasto").count() > 0, "contracts: rows carry the budget's expense type");
  const grupo = sec.locator("button.ct-gasto-fila").first();
  const nombre = (await grupo.locator(".ct-top-nombre").innerText()).trim();
  await grupo.click();
  check(await sec.getByLabel("Tipo de gasto").evaluate((s) => s.selectedOptions[0]?.textContent ?? "") === nombre,
        `contracts: «${nombre.slice(0, 30)}» filters the list to that expense type`);
  check(await sec.locator(".contratos .contrato").count() >= 1, "contracts: the filtered list is not empty");
  await page.goto(`${BASE}/entidad/300790/#tipo-de-gasto`);
  await page.locator("#tipo-de-gasto details summary", { hasText: /bienes y servicios/i }).first().click();
  await page.locator("#tipo-de-gasto details[open] .ct-de-gasto button.ct-gasto-fila").first().waitFor({ timeout: 15000 });
  check(true, "tipo de gasto: «Bienes y servicios» shows the unit's contracts of that type");
  await sinScroll("entidad/300790#tipo-de-gasto (contracts open)");
});

await paso("this month: spending and commitments", async () => {
  await page.goto(`${BASE}/entidad/1061/#este-mes`);  // Despacho Presidencial
  const sec = page.locator("#este-mes");
  if (!(await sec.count())) { check(true, "este mes: no monthly commitments in this data"); return; }
  await sec.locator(".cambios-resumen").waitFor({ timeout: 15000 });
  check(/gastó .* y registró compromisos anuales/.test(await sec.locator(".cambios-resumen").innerText()),
        "este mes: what it spent and committed in the month");
  check(/(Le falta pagar|No le queda|antes de fin de año)/.test(await sec.locator(".efecto").first().innerText()),
        "este mes: commitments in monthly terms (what is left to pay, per month until December)");
  const meses = sec.getByRole("group", { name: "Mes" }).getByRole("button");
  await meses.first().click();
  check(await meses.first().getAttribute("aria-pressed") === "true", "este mes: another month can be chosen");
  const ver = sec.getByRole("button", { name: "Ver mes a mes" }).first();
  await ver.click();
  check(await sec.locator(".tabla-meses tbody tr").count() >= 2, "este mes: a line opens its month-by-month figures, to check against MEF");
  await sinScroll("entidad/1061#este-mes");
});

await paso("purchases under way", async () => {
  const datos = await (await page.request.get(`${BASE}/data/contratos/301289.json`)).json();
  const p = datos.r.procesos ?? {};
  await page.goto(`${BASE}/entidad/301289/#contratos`);
  if (p.convocados || p.por_firmar) {
    await page.locator("#contratos .en-curso .contrato.proceso").first().waitFor({ timeout: 15000 });
    check(await page.locator("#contratos .en-curso .contrato.proceso").count() >= 1,
          `contracts: what it is buying now (${p.convocados ?? 0} called, ${p.por_firmar ?? 0} awarded and not signed)`);
    check(await page.locator("#contratos .en-curso .ct-docs a").count() >= 1, "contracts: a procedure under way links its bidding documents");
  } else check(true, "contracts: nothing under way at Surco this week");
  if (p.desiertos) check(await page.getByText(/quedó desierto|quedaron desiertos/).count() >= 1, "contracts: deserted procedures are counted");
});

await paso("purchase orders", async () => {
  await page.goto(`${BASE}/entidad/301289/#ordenes`);  // Surco
  const sec = page.locator("#ordenes");
  check(await sec.locator("h2").isVisible() && await sec.locator(".kpi").count() === 4,
        "orders: «¿Qué compra en el día a día?» with its figures");
  check(await page.getByRole("navigation", { name: "De dónde a dónde va su presupuesto" }).getByRole("link", { name: /Compra con órdenes/ }).count() === 1,
        "orders: the money map has a step for them");
  const filas = sec.locator(".contratos .contrato.orden");
  await sec.scrollIntoViewIfNeeded();  // the list loads when the section comes into view
  await filas.first().waitFor({ timeout: 30000 });
  check(await filas.count() >= 5 && await sec.locator(".ct-gastos .ct-gasto-fila").count() >= 2,
        `orders: how it buys, what, and its largest orders (${await filas.count()} rows)`);
  const grupo = sec.locator(".ct-gastos").nth(1).locator("button.ct-gasto-fila").first();
  const nombre = (await grupo.locator(".ct-top-nombre").innerText()).trim();
  await grupo.click();
  check(await sec.getByLabel("Tipo de gasto de la orden").evaluate((s) => s.selectedOptions[0]?.textContent ?? "") === nombre,
        `orders: «${nombre.slice(0, 30)}» filters the list`);
  await sec.getByLabel("Buscar en las órdenes").fill("zzzz sin coincidencias");
  check(await sec.getByText("Ninguna orden coincide").isVisible(), "orders: a search with no match says so");
  await page.goto(`${BASE}/entidad/301289/#en-que`);
  await page.locator("#en-que details summary", { hasText: "Ambiente" }).first().click();
  await page.getByRole("button", { name: "¿En qué exactamente?" }).first().click();
  const deTipo = page.locator(".detalle-item .ct-tipo button", { hasText: /órdenes? de este tipo/ }).first();
  await deTipo.waitFor({ timeout: 15000 });
  await deTipo.click();
  check(await page.locator(".detalle-item .contrato.orden").count() >= 1, "orders: an expense type of an activity opens the orders of that type");
  await sinScroll("entidad/301289#ordenes");
});

await paso("suppliers", async () => {
  await page.goto(`${BASE}/entidad/300790/#contratos`);
  const proveedor = page.locator("#contratos .ct-top a.ct-enlace-proveedor").first();
  const nombre = (await proveedor.innerText()).trim();
  await proveedor.click();
  await page.waitForURL(/proveedor\/\?id=/);
  await page.locator(".hero h1").waitFor({ timeout: 15000 });
  check((await page.locator(".hero h1").innerText()).trim() === nombre, `supplier: «${nombre.slice(0, 30)}» has its own page`);
  check(await page.locator("#entidades a[href*='/entidad/300790/']").count() === 1, "supplier: lists the entities it sold to, linked");
  check(await page.locator("#contratos .contratos .contrato").count() >= 1 && await page.locator(".kpi").count() === 4,
        "supplier: its contracts and figures");
  await sinScroll("proveedor");
  await page.goto(`${BASE}/proveedores/`);
  check(await page.locator(".ranking-prov li").count() > 5, "proveedores: the largest suppliers are ranked");
  await page.getByLabel(/Busca una empresa/).fill(nombre.split(" ")[0].toLowerCase());
  await page.locator(".busca-resultados a").first().waitFor({ timeout: 15000 });
  check(await page.locator(".busca-resultados a").count() >= 1, "proveedores: name search finds suppliers");
  const r = await page.goto(`${BASE}/proveedor/?id=00000000000`);
  await page.getByText("Proveedor no encontrado").waitFor({ timeout: 15000 });
  check(!!r?.ok(), "supplier: an unknown RUC says so");
  await sinScroll("proveedores");
});

await paso("every expense type, none hidden", async () => {
  await page.goto(`${BASE}/entidad/301289/#en-que`);  // Surco: its parks carry 50+ expense types
  await page.locator("#en-que details summary", { hasText: "Ambiente" }).first().click();
  await page.getByRole("button", { name: "¿En qué exactamente?" }).first().click();
  const resto = page.locator(".detalle-item .parte-abre").first();
  await resto.waitFor();
  const n = Number((await resto.locator(".parte-nombre").innerText()).match(/Otros ([\d.,]+)/)?.[1]?.replace(/\D/g, "") ?? 0);
  await resto.click();
  check(n > 6 && await page.locator(".partes-resto .parte").count() === n, `detail: «Otros ${n} tipos de gasto» opens all of them, by family`);
  check(await page.locator(".partes-resto h6").count() >= 1, "detail: the rest is grouped by family (bienes y servicios, personal…)");
  check(await page.locator(".detalle-item .generico").count() >= 1, "detail: catch-all expense types are flagged as such");
  await page.getByRole("tab", { name: "Por tipo de gasto" }).click();
  check(await page.locator("#tipo-de-gasto details").count() > 1 && await page.locator("#por-area").isHidden(),
        "entity: «Por tipo de gasto» shows the same budget by expense type");
  await sinScroll("entidad/301289 (all expense types open)");
});

await paso("budget without description", async () => {
  await page.goto(`${BASE}/entidad/472/#en-que`);  // Fuerza Aérea del Perú: S/ 2,061 M under the generic code
  await page.locator("details summary", { hasText: /Defensa y seguridad/i }).first().click();
  await page.locator(".badge.sin-descripcion").first().waitFor();
  // MEF's daily file leaves its name blank, the monthly-format file calls it "PROYECTOS": either way it is flagged
  const marcado = page.locator(".items li.sin-desc").first();
  check(await marcado.locator(".badge.sin-descripcion").isVisible() && (await marcado.locator(".item-nombre").innerText()).trim().length > 0,
        "FAP: the project with no description is flagged and labelled, not left blank");
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

await paso("product prices", async () => {
  await page.goto(`${BASE}/productos/`);
  check(await page.locator(".ranking-prov li").count() > 5, "precios: the most bought products are ranked");
  await page.getByLabel(/Busca un producto/).fill("diesel");
  await page.locator(".busca-resultados a").first().waitFor({ timeout: 15000 });
  check(await page.locator(".busca-resultados a").count() >= 1, "precios: search finds «diesel»");
  await page.locator(".busca-resultados a").first().click();
  await page.waitForURL(/producto\/\?id=/);
  await page.locator(".hero h1").waitFor({ timeout: 15000 });
  check(await page.locator(".grafico-precios svg circle.punto").count() > 3, "producto: each purchase on the price chart");
  check(await page.locator("#vendedores .ct-top li").count() >= 1 && await page.locator("#compradores .ct-top li").count() >= 1,
        "producto: who sells it and who buys it, at what price");
  await page.getByRole("button", { name: "Seguir", exact: true }).click();
  check(await page.getByRole("button", { name: "Siguiendo", exact: true }).count() === 1, "producto: can be followed");
  await sinScroll("producto");
  await page.goto(`${BASE}/entidad/301289/#contratos`);
  await page.locator("#contratos-lista .contrato").first().waitFor({ timeout: 15000 });
  await page.getByLabel("Buscar en los contratos").fill("concreto premezclado");
  const linea = page.locator("#contratos-lista .ct-lineas a.ct-linea-desc").first();
  await linea.waitFor({ timeout: 15000 });
  check(/producto\/\?id=\d+/.test(await linea.getAttribute("href") ?? ""), "contracts: a bought item links to its price page");
});

await paso("map of projects", async () => {
  await page.goto(`${BASE}/entidad/301289/#obras`);
  const enlace = page.locator("#obras a", { hasText: "Verlas en el mapa" });
  check(/mapa\/\?dep=15&sec=301289/.test(await enlace.getAttribute("href") ?? ""), "obras: the projects link to the map");
  await enlace.click();
  await page.waitForURL(/mapa\/\?/);
  await page.locator(".mapa-caja canvas").first().waitFor({ timeout: 20000 });
  await page.waitForFunction(() => /[1-9][\d.,]* obras? en el mapa/.test(document.querySelector(".mapa-obras .ct-cuenta")?.textContent ?? ""), null, { timeout: 20000 });
  check(true, `mapa: an entity's projects on the map (${(await page.locator(".mapa-obras .ct-cuenta").innerText()).slice(0, 80)})`);
  await page.getByLabel("Qué obras").selectOption("sin_gasto");
  check(/en el mapa/.test(await page.locator(".mapa-obras .ct-cuenta").innerText()), "mapa: filters projects with no spending this year");
  await sinScroll("mapa");
});

await paso("watchlist", async () => {
  await page.goto(`${BASE}/seguimiento/`);
  await listo();
  const titulos = await page.locator("section.tarjeta h2").allInnerTexts();
  check(titulos.some((t) => t.toLowerCase() === "cusco") && titulos.length >= 4, `siguiendo: shows followed items (${titulos.join(" / ")})`);
  check(!(await page.locator("text=No encontramos datos").count()), "siguiendo: every followed item resolved its data file");
  check(await page.getByRole("link", { name: /Ver el producto/ }).count() === 1, "siguiendo: a followed product shows its usual price");
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
