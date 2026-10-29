
import {
  ResponsiveContainer,
  LineChart,
  Line,
  CartesianGrid,
  XAxis,
  YAxis,
  Tooltip,
} from 'recharts';
import type { EventItem } from '../../types';

interface EstimatesPageProps {
  events: EventItem[];
  series: Array<Record<string, unknown>>;
}

export default function EstimatesPage({
  events,
  series,
}: EstimatesPageProps) {
  // Detecta automáticamente un campo numérico para graficar.
  const firstPoint = series.find(
    (point) => point && typeof point === 'object',
  );

  const fields = firstPoint ? Object.keys(firstPoint) : [];

  const numericField =
    fields.find((key) =>
      series.some(
        (point) =>
          typeof point[key] === 'number' &&
          Number.isFinite(point[key]),
      ),
    ) ?? '';

  const dateField =
    fields.find((key) =>
      /fecha|date|time|tiempo|period|dia|day/i.test(key),
    ) ?? fields.find((key) => key !== numericField) ?? '';

  const chartData = series
    .filter((point) => point && typeof point === 'object')
    .map((point, index) => ({
      ...point,
      __index: index + 1,
      __value: Number(point[numericField]),
      __label: dateField
        ? String(point[dateField] ?? index + 1)
        : String(index + 1),
    }))
    .filter((point) => Number.isFinite(point.__value));

  return (
    <div className="page-content">
      <h1>Estimaciones experimentales</h1>
      <p>
        Análisis exploratorio de datos sísmicos observados.
        No representa una predicción confirmada de terremotos.
      </p>

      <div className="stats-grid">
        <article className="stat-card">
          <h3>Eventos observados</h3>
          <p>{events.length}</p>
        </article>

        <article className="stat-card">
          <h3>Puntos disponibles</h3>
          <p>{series.length}</p>
        </article>
      </div>

      <section className="panel">
        <h2>Serie temporal disponible</h2>

        {chartData.length > 0 ? (
          <div style={{ width: '100%', height: 360 }}>
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={chartData}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="__label" />
                <YAxis />
                <Tooltip />
                <Line
                  type="monotone"
                  dataKey="__value"
                  name={numericField || 'Valor'}
                  stroke="#0891b2"
                  strokeWidth={3}
                  dot={{ r: 4 }}
                  connectNulls
                />
              </LineChart>
            </ResponsiveContainer>
          </div>
        ) : (
          <p>
            No se encontraron valores numéricos graficables
            en la serie recibida.
          </p>
        )}
      </section>

      <section className="panel">
        <h2>Datos disponibles para análisis</h2>
        <p>Eventos recibidos: {events.length}</p>
        <p>Puntos recibidos: {series.length}</p>

        {firstPoint ? (
          <p>
            Campos detectados: {fields.join(', ')}
          </p>
        ) : (
          <p>La serie no contiene puntos para analizar.</p>
        )}
      </section>
    </div>
  );
}
