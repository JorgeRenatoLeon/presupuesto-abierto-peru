# Design notes — from paper wireframes to the web app

The scanned paper wireframes (in `Proyecto Sist Inf/`) were the starting point. What was kept, what changed, and why:

**Kept from the wireframes**

- Mobile-first with bottom navigation (the 3-phone sketches map to Inicio / Explorar / Alertas + Guía)
- Home = overview with chart + cards; detail screens as drill-down lists with chevrons
- The "guía" as a first-class section (the wireframes' step-by-step form idea became the step-by-step budget journey)

**Changed, and the reasoning**

1. **Every number gets an interpretation.** The benchmark's core finding: competitors show numbers citizens can't act on. Each KPI carries a plain-language note, and a colored "lectura" box answers "is this normal?" (ok/warn/bad against calendar pace).
2. **Reclamo flow deferred, alerts promoted.** The wireframes' multi-step reclamo form depends on Etapa 2 integrations (Contraloría/Defensoría). Instead, alerts are ready-to-share texts — the fastest control-social action available today (share/copy button on every card).
3. **Progress bars everywhere.** % ejecución as a bar against 100% makes pace visible without reading numbers; color encodes health.
4. **Search-first entity explorer.** "Busca tu municipalidad" is the emotional entry point (my district!), so entity search gets prominence over abstract classifier drill-downs.
5. **Plain-Spanish labels.** "¿A qué se destina?" instead of "Clasificación funcional"; "¿En qué tipo de gasto?" instead of "Genérica de gasto". Official terms appear in the guía with definitions.
6. **Visual language.** Peru red (#C8102E) as the single accent on warm neutrals; large rounded cards, system fonts, generous spacing — serious but approachable, works on cheap Android screens.

**Open items for hi-fi (Figma)**

- Department map view (choropleth) once ubigeo polygons are added
- Entity comparison (this year vs last, vs similar municipalities)
- Alert subscription (email/WhatsApp) UI
