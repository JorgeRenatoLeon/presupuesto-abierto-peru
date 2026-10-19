import Link from "next/link";

/** The route from the country to here, always visible: Perú › Cusco › Urubamba › Ollantaytambo. */
export function Migas({ pasos }: { pasos: { href: string; texto: string }[] }) {
  return (
    <nav aria-label="Ubicación" className="migas">
      <ol>
        <li><Link href="/">Perú</Link></li>
        {pasos.map((p, i) => (
          <li key={p.href}>
            {i === pasos.length - 1 ? <Link href={p.href} aria-current="page">{p.texto}</Link> : <Link href={p.href}>{p.texto}</Link>}
          </li>
        ))}
      </ol>
    </nav>
  );
}
