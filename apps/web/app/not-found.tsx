import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { Bandas } from "@/components/Bandas";
import { BuscaMunicipalidad } from "@/components/BuscaMunicipalidad";

export const metadata = { title: "Página no encontrada — Presupuesto Abierto Perú" };

/** GitHub Pages serves this (out/404.html) for any address that does not exist, e.g. an old link
 *  to an entity that no longer has budget. */
export default function NoEncontrada() {
  return (
    <div className="pagina">
      <section className="hero">
        <Bandas etiqueta="Esta página no existe" bandas={[
          { texto: "Esta página", color: "fucsia", chica: true },
          { texto: "no existe", color: "amarillo" },
        ]} />
        <p>
          Puede que el enlace esté incompleto o que la entidad ya no tenga presupuesto este año. Busca tu
          municipalidad o vuelve al inicio.
        </p>
      </section>
      <section className="seccion tarjeta">
        <BuscaMunicipalidad />
      </section>
      <div className="tabs">
        <Link className="tab activo" href="/">Ir al inicio <ArrowRight className="icono-linea" aria-hidden /></Link>
        <Link className="tab" href="/explorar/">Buscar una entidad <ArrowRight className="icono-linea" aria-hidden /></Link>
      </div>
    </div>
  );
}
