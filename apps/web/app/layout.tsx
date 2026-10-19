import type { Metadata, Viewport } from "next";
import { Anton, Archivo } from "next/font/google";
import Link from "next/link";
import "./globals.css";
import { TopNav, BottomNav, EnlaceSiguiendo } from "@/components/Nav";
import { loadOptional, type ComparacionResumen } from "@/lib/data";
import { MESES } from "@/lib/types";

// self-hosted at build time (static export): no request to Google from the visitor's phone
const anton = Anton({ weight: "400", subsets: ["latin"], variable: "--font-anton", display: "swap" });
const archivo = Archivo({ subsets: ["latin"], variable: "--font-archivo", display: "swap" });

export const metadata: Metadata = {
  title: "Presupuesto Abierto Perú",
  description:
    "Explora en qué se gasta el presupuesto público del Perú: asignación, ejecución y alertas ciudadanas, con datos oficiales del MEF.",
};
export const viewport: Viewport = { themeColor: "#0e0e10", colorScheme: "dark" };

/** "al 17 oct": the date of the MEF file the whole site reflects, always in view. */
function corteCabecera(): string | null {
  const r = loadOptional<ComparacionResumen>("comparar/resumen.json");
  if (!r?.publicacion?.fecha) return null;
  const [, m, d] = r.publicacion.fecha.split("-").map(Number);
  return `al ${d} ${MESES[m].slice(0, 3).toLowerCase()}`;
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  const corte = corteCabecera();
  return (
    <html lang="es" className={`${anton.variable} ${archivo.variable}`}>
      <body>
        <header className="header">
          <div className="container header-inner">
            <Link href="/" className="brand" aria-label="Presupuesto Abierto Perú, inicio">
              <span className="brand-mark" aria-hidden>S/</span>
              <span className="brand-texto">Presupuesto <b>Abierto</b> Perú</span>
            </Link>
            <div className="header-derecha">
              {corte ? <span className="corte-cabecera" title="Fecha de los datos del MEF">{corte}</span> : null}
              <TopNav />
              <EnlaceSiguiendo />
            </div>
          </div>
        </header>
        <main className="container">{children}</main>
        <footer className="pie container">
          Proyecto ciudadano independiente con datos oficiales del{" "}
          <a href="https://datosabiertos.mef.gob.pe/dataset/presupuesto-y-ejecucion-de-gasto" target="_blank" rel="noopener">MEF — Portal de Datos Abiertos</a>
          {" · "}<Link href="/metodologia/">Metodología y fuentes</Link>{" · "}<Link href="/glosario/">Glosario</Link>
          {" · "}<Link href="/ingresos/">Ingresos del Estado</Link>{" · "}<Link href="/guia/">Guía</Link>
        </footer>
        <BottomNav />
      </body>
    </html>
  );
}
