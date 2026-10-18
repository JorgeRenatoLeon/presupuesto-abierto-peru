"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

// the six that fit the mobile bottom bar; the rest live in the desktop top bar
const principales = [
  { href: "/", etiqueta: "Inicio", icono: "◉" },
  { href: "/localidad/", etiqueta: "Tu región", icono: "⌂" },
  { href: "/comparar/", etiqueta: "Comparar", icono: "⇄" },
  { href: "/auditar/", etiqueta: "Vigilar", icono: "◎" },
  { href: "/alertas/", etiqueta: "Alertas", icono: "▲" },
  { href: "/explorar/", etiqueta: "Explorar", icono: "☰" },
];
const secundarios = [
  { href: "/ingresos/", etiqueta: "Ingresos" },
  { href: "/guia/", etiqueta: "Guía" },
];

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

/** ★ Siguiendo: always one tap away (header), on mobile and desktop. */
export function EnlaceSiguiendo() {
  const pathname = usePathname();
  return (
    <Link href="/seguimiento/" className={`siguiendo-enlace ${activo(pathname, "/seguimiento/") ? "activo" : ""}`}>
      ★ <span>Siguiendo</span>
    </Link>
  );
}

export function BottomNav() {
  const pathname = usePathname();
  return (
    <nav className="bottom-nav">
      {principales.map((e) => (
        <Link key={e.href} href={e.href} className={activo(pathname, e.href) ? "activo" : ""}>
          <span className="icono" aria-hidden>{e.icono}</span>
          {e.etiqueta}
        </Link>
      ))}
    </nav>
  );
}
