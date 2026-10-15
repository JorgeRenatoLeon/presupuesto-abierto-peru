"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const enlaces = [
  { href: "/", etiqueta: "Inicio", icono: "◉" },
  { href: "/explorar/", etiqueta: "Explorar", icono: "☰" },
  { href: "/comparar/", etiqueta: "Comparar", icono: "⇄" },
  { href: "/ingresos/", etiqueta: "Ingresos", icono: "↓" },
  { href: "/alertas/", etiqueta: "Alertas", icono: "▲" },
  { href: "/guia/", etiqueta: "Guía", icono: "?" },
];

function activo(pathname: string, href: string): boolean {
  if (href === "/") return pathname === "/";
  return pathname.startsWith(href.replace(/\/$/, ""));
}

export function TopNav() {
  const pathname = usePathname();
  return (
    <nav className="top-nav">
      {enlaces.map((e) => (
        <Link key={e.href} href={e.href} className={activo(pathname, e.href) ? "activo" : ""}>
          {e.etiqueta}
        </Link>
      ))}
    </nav>
  );
}

export function BottomNav() {
  const pathname = usePathname();
  return (
    <nav className="bottom-nav">
      {enlaces.map((e) => (
        <Link key={e.href} href={e.href} className={activo(pathname, e.href) ? "activo" : ""}>
          <span className="icono" aria-hidden>{e.icono}</span>
          {e.etiqueta}
        </Link>
      ))}
    </nav>
  );
}
