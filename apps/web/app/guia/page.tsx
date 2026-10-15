export const metadata = { title: "Guía del presupuesto — Presupuesto Abierto Perú" };

const PASOS = [
  {
    titulo: "El Congreso aprueba el presupuesto inicial (PIA)",
    texto:
      "Antes de empezar el año, cada entidad pública recibe un monto aprobado por ley: el Presupuesto Institucional de Apertura. Es el plan original.",
  },
  {
    titulo: "El presupuesto cambia durante el año (PIM)",
    texto:
      "Con transferencias, créditos y recortes, el monto se va modificando. El Presupuesto Institucional Modificado es lo que la entidad realmente puede gastar hoy. Comparar PIA vs PIM te dice cuánto cambió el plan.",
  },
  {
    titulo: "La entidad reserva y compromete el dinero",
    texto:
      "Antes de gastar, la entidad certifica que hay fondos y firma contratos u órdenes (compromiso). Es dinero 'apalabrado' pero aún no gastado.",
  },
  {
    titulo: "El gasto real: devengado",
    texto:
      "Cuando la obra avanza o el servicio se entrega, el gasto se 'devenga'. Este es el número que usamos como ejecución real: bienes y servicios efectivamente recibidos.",
  },
  {
    titulo: "El pago sale del banco (girado)",
    texto: "Finalmente el Estado transfiere el dinero al proveedor o trabajador. Suele ir poco detrás del devengado.",
  },
];

const FAQ = [
  {
    q: "¿De dónde sale el dinero que gasta el Estado?",
    a: "Principalmente de impuestos nacionales que recauda la SUNAT (los 'Recursos Ordinarios' del tesoro), y además de ingresos que cada entidad registra: canon por recursos naturales, impuestos municipales, tasas y ventas de servicios, transferencias y endeudamiento. La sección Ingresos muestra esta segunda parte — la que las entidades registran directamente; los Recursos Ordinarios se ven del lado del gasto, como fuente de financiamiento.",
  },
  {
    q: "¿Qué porcentaje de ejecución es 'bueno'?",
    a: "Como regla simple, el avance debería parecerse al avance del calendario: a junio (mitad de año) se esperaría alrededor de 50%. Quedarse muy por debajo sugiere lentitud; también importa el tipo de gasto: las obras suelen concentrarse a fin de año.",
  },
  {
    q: "¿Un presupuesto que crece es bueno o malo?",
    a: "Depende. Puede significar nuevas obras financiadas (bueno) o incapacidad de planificar (malo). Lo importante es preguntar: ¿de dónde vino el dinero y a qué se destinará?",
  },
  {
    q: "¿Por qué una entidad puede gastar poco y no pasar nada?",
    a: "El dinero no usado del año generalmente regresa al tesoro público. La entidad 'devuelve' presupuesto: servicios u obras que la población esperaba y no llegaron. Por eso la ejecución lenta es una señal de alerta ciudadana.",
  },
  {
    q: "¿De dónde salen estos datos?",
    a: "Del portal oficial de Datos Abiertos del Ministerio de Economía y Finanzas (MEF), los mismos datos de la Consulta Amigable. No modificamos las cifras; solo las organizamos e interpretamos.",
  },
];

export default function GuiaPage() {
  return (
    <div className="pagina">
      <section className="hero">
        <h1>Guía del presupuesto en 3 minutos</h1>
        <p>Cómo fluye el dinero público, en lenguaje claro. Sin tecnicismos innecesarios.</p>
      </section>

      <section className="tarjeta seccion">
        <h2>El viaje del dinero público</h2>
        <div style={{ display: "grid", gap: 0, marginTop: 12 }}>
          {PASOS.map((p, i) => (
            <div key={i}>
              <div className="paso">
                <div className="paso-num">{i + 1}</div>
                <div>
                  <h3>{p.titulo}</h3>
                  <p>{p.texto}</p>
                </div>
              </div>
              {i < PASOS.length - 1 ? <div className="flecha-paso" /> : null}
            </div>
          ))}
        </div>
      </section>

      <section className="tarjeta seccion">
        <h2>Los 3 números que más importan</h2>
        <table className="tabla-simple">
          <thead>
            <tr><th>Número</th><th>Qué es</th><th>Pregunta ciudadana</th></tr>
          </thead>
          <tbody>
            <tr>
              <td><strong>PIM</strong></td>
              <td>Lo que la entidad puede gastar este año</td>
              <td>¿Cuánto dinero maneja mi municipalidad?</td>
            </tr>
            <tr>
              <td><strong>Devengado</strong></td>
              <td>Lo efectivamente ejecutado</td>
              <td>¿Lo está usando?</td>
            </tr>
            <tr>
              <td><strong>% Avance</strong></td>
              <td>Devengado ÷ PIM</td>
              <td>¿Va al ritmo del año?</td>
            </tr>
          </tbody>
        </table>
      </section>

      <section className="tarjeta seccion">
        <h2>Preguntas frecuentes</h2>
        <div style={{ display: "grid", gap: 14, marginTop: 6 }}>
          {FAQ.map((f, i) => (
            <div key={i}>
              <h3 style={{ fontSize: 15, color: "var(--tinta)" }}>{f.q}</h3>
              <p style={{ fontSize: 13.5 }}>{f.a}</p>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
