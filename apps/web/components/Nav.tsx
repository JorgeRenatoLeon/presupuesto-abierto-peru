"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { House, MapPin, ArrowLeftRight, Eye, TriangleAlert, Search, Star, type LucideIcon } from "lucide-react";

// the six that fit the mobile bottom bar; the rest live in the desktop top bar
const principales: { href: string; etiqueta: string; icono: LucideIcon }[] = [
  { href: "/", etiqueta: "Inicio", icono: House },
  { href: "/localidad/", etiqueta: "Mi municipio", icono: MapPin },
  { href: "/comparar/", etiqueta: "Qué cambió", icono: ArrowLeftRight },
  { href: "/auditar/", etiqueta: "Vigilar", icono: Eye },
  { href: "/alertas/", etiqueta: "Alertas", icono: TriangleAlert },
  { href: "/explorar/", etiqueta: "Explorar", icono: Search },
];
// Ingresos and Guía live in the footer and on the pages that need them
const secundarios = [{ href: "/glosario/", etiqueta: "Glosario" }];

function activo(pathname: string, href: string): boolean {
  if (href === "/") return pathname === "/";
  return pathname.startsWith(href.replace(/\/$/, ""));
}

export function TopNav() {
  const pathname = usePathname();
  return (
    <nav className="top-nav">
      {[...principales, ...secundarios].map((e) => (
        <Link key={e.href} href={e.href} className={activo(pathname, e.href) ? "activo" : ""}>
          {e.etiqueta}
        </Link>
      ))}
    </nav>
  );
}

/** Siguiendo: always one tap away (header), on mobile and desktop. */
export function EnlaceSiguiendo() {
  const pathname = usePathname();
  return (
    <Link href="/seguimiento/" className={`siguiendo-enlace ${activo(pathname, "/seguimiento/") ? "activo" : ""}`}>
      <Star className="icono-linea" aria-hidden fill={activo(pathname, "/seguimiento/") ? "currentColor" : "none"} />
      <span className="siguiendo-texto">Siguiendo</span>
    </Link>
  );
}

export function BottomNav() {
  const pathname = usePathname();
  return (
    <nav className="bottom-nav">
      {principales.map((e) => (
        <Link key={e.href} href={e.href} className={activo(pathname, e.href) ? "activo" : ""}>
          <e.icono className="icono" aria-hidden strokeWidth={2.2} />
          {e.etiqueta}
        </Link>
      ))}
    </nav>
  );
}
