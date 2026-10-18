import Link from "next/link";
import { urlDatos } from "@/lib/data";
import { Seguimiento } from "@/components/Seguimiento";

export const metadata = { title: "Siguiendo — Presupuesto Abierto Perú" };

export default function SeguimientoPage() {
  return (
    <div className="pagina">
      <section className="hero">
        <h1>Lo que sigues</h1>
        <p>
          Tus regiones, entidades y temas, con lo que cambió en la última actualización del MEF. Se guarda solo en
          este navegador: no necesitas cuenta.
        </p>
      </section>
      <Seguimiento />
      <section className="tarjeta seccion">
        <h2>¿Prefieres que te avisen?</h2>
        <p style={{ fontSize: 14 }}>
          Suscríbete con un lector de RSS (o un servicio que envía RSS por correo):{" "}
          <a style={{ color: "var(--rojo)", fontWeight: 600 }} href={urlDatos("feeds/alertas.xml")}>alertas de prioridad alta</a>,{" "}
          <a style={{ color: "var(--rojo)", fontWeight: 600 }} href={urlDatos("feeds/cambios.xml")}>cambios por tema</a> o el
          canal de tu departamento en su página de <Link href="/localidad/" style={{ color: "var(--rojo)", fontWeight: 600 }}>Tu región</Link>.
        </p>
      </section>
    </div>
  );
}
