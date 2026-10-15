import type { Metadata } from "next";
import Link from "next/link";
import "./globals.css";
import { TopNav, BottomNav } from "@/components/Nav";

export const metadata: Metadata = {
  title: "Presupuesto Abierto Perú",
  description:
    "Explora en qué se gasta el presupuesto público del Perú: asignación, ejecución y alertas ciudadanas, con datos oficiales del MEF.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="es">
      <body>
        <header className="header">
          <div className="container header-inner">
            <Link href="/" className="brand">
              <span className="brand-mark">S/</span>
              Presupuesto Abierto Perú
            </Link>
            <TopNav />
          </div>
        </header>
        <main className="container">{children}</main>
        <footer className="pie container">
          Datos oficiales del <a href="https://datosabiertos.mef.gob.pe/dataset/presupuesto-y-ejecucion-de-gasto" target="_blank" rel="noopener">MEF — Portal de Datos Abiertos</a>
          {" · "}<Link href="/metodologia/">Metodología y fuentes</Link>
        </footer>
        <BottomNav />
      </body>
    </html>
  );
}
