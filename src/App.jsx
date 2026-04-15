import { useEffect, useState } from 'react'
import './App.css'

const HEADERS = {
  Accept: 'application/json, text/plain, */*',
  'X-Requested-With': 'XMLHttpRequest',
}

function fetchCandidatos(ubigeo) {
  return fetch(
    `/api/presentacion-backend/eleccion-presidencial/participantes-ubicacion-geografica-nombre?tipoFiltro=ubigeo_nivel_01&idAmbitoGeografico=1&ubigeoNivel1=${ubigeo}&listDistrito=&listContinentals=&listCountries=&idEleccion=10`,
    { headers: HEADERS },
  ).then((r) => r.json())
}

function fetchTotales(ubigeo) {
  return fetch(
    `/api/presentacion-backend/resumen-general/totales?idAmbitoGeografico=1&idEleccion=10&tipoFiltro=ubigeo_nivel_01&idUbigeoDepartamento=${ubigeo}`,
    { headers: HEADERS },
  ).then((r) => r.json())
}

function fetchExtranjerosCandidatos() {
  return fetch(
    `/api/presentacion-backend/eleccion-presidencial/participantes-ubicacion-geografica-nombre?tipoFiltro=ambito_geografico&idAmbitoGeografico=2&listDepartamento=&listProvincia=&listDistrito=&listCountries=&idEleccion=10`,
    { headers: HEADERS },
  ).then((r) => r.json())
}

function fetchExtranjerosTotales() {
  return fetch(
    `/api/presentacion-backend/resumen-general/totales?idAmbitoGeografico=2&idEleccion=10&tipoFiltro=ambito_geografico`,
    { headers: HEADERS },
  ).then((r) => r.json())
}

function computeProyeccion(candidatos, totales) {
  const estimatedTotal =
    totales.actasContabilizadas > 0
      ? totales.totalVotosValidos / (totales.actasContabilizadas / 100)
      : null

  return { candidatos, totales, estimatedTotal }
}

const VOTOS_ESPECIALES = ['80', '81'] // blancos y nulos

function agregaTodo(resultadosPorDepto) {
  const byCode = {}

  for (const { candidatos, estimatedTotal } of resultadosPorDepto) {
    for (const c of candidatos.filter(
      (c) => !VOTOS_ESPECIALES.includes(c.codigoAgrupacionPolitica),
    )) {
      if (!byCode[c.codigoAgrupacionPolitica]) {
        byCode[c.codigoAgrupacionPolitica] = {
          codigoAgrupacionPolitica: c.codigoAgrupacionPolitica,
          nombreAgrupacionPolitica: c.nombreAgrupacionPolitica,
          nombreCandidato: c.nombreCandidato,
          totalVotosValidos: 0,
          proyeccionSum: 0,
        }
      }
      const entry = byCode[c.codigoAgrupacionPolitica]
      entry.totalVotosValidos += c.totalVotosValidos

      if (estimatedTotal != null && c.porcentajeVotosValidos != null) {
        entry.proyeccionSum += (c.porcentajeVotosValidos / 100) * estimatedTotal
      }
    }
  }

  const rows = Object.values(byCode)
  const totalVotos = rows.reduce((s, x) => s + x.totalVotosValidos, 0)
  const totalProyeccion = rows.reduce((s, r) => s + r.proyeccionSum, 0)

  return rows
    .map((r) => ({
      ...r,
      porcentajeVotosValidos: totalVotos > 0 ? (r.totalVotosValidos / totalVotos) * 100 : null,
      proyeccion: Math.round(r.proyeccionSum),
      porcentajeProyeccion: totalProyeccion > 0 ? (r.proyeccionSum / totalProyeccion) * 100 : null,
    }))
    .sort((a, b) => b.proyeccion - a.proyeccion)
}

function fetchRegion(ubigeo) {
  if (ubigeo === 'EXTRANJEROS') {
    return Promise.all([fetchExtranjerosCandidatos(), fetchExtranjerosTotales()])
  }
  return Promise.all([fetchCandidatos(ubigeo), fetchTotales(ubigeo)])
}

function toTitleCase(str) {
  return str.toLowerCase().split(' ').map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(' ')
}

function App() {
  const [departamentos, setDepartamentos] = useState([])
  const [view, setView] = useState('totales') // 'totales' | 'region'
  const [ubigeo, setUbigeo] = useState('140000')
  const [candidatos, setCandidatos] = useState([])
  const [totales, setTotales] = useState(null)
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    fetch(
      '/api/presentacion-backend/ubigeos/departamentos?idEleccion=10&idAmbitoGeografico=1',
      { headers: HEADERS },
    )
      .then((res) => res.json())
      .then((json) => setDepartamentos(json.data))
      .catch(console.error)
  }, [])

  useEffect(() => {
    setCandidatos([])
    setTotales(null)
    setLoading(true)

    if (view === 'totales') {
      Promise.all([
        ...departamentos.map((d) =>
          Promise.all([fetchCandidatos(d.ubigeo), fetchTotales(d.ubigeo)]).then(
            ([cJson, tJson]) => computeProyeccion(cJson.data, tJson.data),
          ),
        ),
        Promise.all([fetchExtranjerosCandidatos(), fetchExtranjerosTotales()]).then(
          ([cJson, tJson]) => computeProyeccion(cJson.data, tJson.data),
        ),
      ])
        .then((resultados) => {
          setCandidatos(agregaTodo(resultados))
          const totalActas = resultados.reduce(
            (acc, { totales: t }) => ({
              contabilizadas: acc.contabilizadas + t.contabilizadas,
              totalActas: acc.totalActas + t.totalActas,
            }),
            { contabilizadas: 0, totalActas: 0 },
          )
          setTotales({
            actasContabilizadas: (totalActas.contabilizadas / totalActas.totalActas) * 100,
            contabilizadas: totalActas.contabilizadas,
            totalActas: totalActas.totalActas,
          })
        })
        .catch(console.error)
        .finally(() => setLoading(false))
    } else {
      fetchRegion(ubigeo)
        .then(([cJson, tJson]) => {
          const estimatedTotal =
            tJson.data.actasContabilizadas > 0
              ? tJson.data.totalVotosValidos / (tJson.data.actasContabilizadas / 100)
              : null
          setCandidatos(
            cJson.data
              .filter((c) => !VOTOS_ESPECIALES.includes(c.codigoAgrupacionPolitica))
              .map((c) => ({
                ...c,
                proyeccion:
                  estimatedTotal != null && c.porcentajeVotosValidos != null
                    ? Math.round((c.porcentajeVotosValidos / 100) * estimatedTotal)
                    : null,
                porcentajeProyeccion: c.porcentajeVotosValidos,
              })),
          )
          setTotales(tJson.data)
        })
        .catch(console.error)
        .finally(() => setLoading(false))
    }
  }, [view, ubigeo, departamentos])

  return (
    <div>
      <div className="view-switch">
        <label>
          <input type="radio" name="view" value="totales" checked={view === 'totales'} onChange={() => setView('totales')} />
          Totales
        </label>
        <label>
          <input type="radio" name="view" value="region" checked={view === 'region'} onChange={() => setView('region')} />
          Regiones
        </label>
      </div>
      <h1>Elecciones Presidenciales Perú 2026</h1>
      <p className="subheader">
        Proyección basada en los resultados parciales de la ONPE. Para cada región, se extrapola el total de votos válidos según el porcentaje de actas contabilizadas, manteniendo constante la distribución actual entre candidatos.
      </p>

      {view === 'region' && (
        <select value={ubigeo} onChange={(e) => setUbigeo(e.target.value)}>
          {departamentos.map((d) => (
            <option key={d.ubigeo} value={d.ubigeo}>
              {toTitleCase(d.nombre)}
            </option>
          ))}
          <option value="EXTRANJEROS">Extranjeros</option>
        </select>
      )}

      {totales && (
        <p style={{ marginBottom: '10px' }}>
          Actas contabilizadas: {totales.actasContabilizadas.toFixed(1)}% ({totales.contabilizadas}{' '}
          de {totales.totalActas})
        </p>
      )}

      {loading && <p>Cargando...</p>}

      {!loading && candidatos.length > 0 && (
        <table>
          <thead>
            <tr>
              <th>Candidato</th>
              <th>Votos válidos</th>
              <th>% votos válidos</th>
              <th>Proyección final</th>
              {view === 'totales' && <th>% proyección</th>}
            </tr>
          </thead>
          <tbody>
            {candidatos.map((c) => (
              <tr key={c.codigoAgrupacionPolitica}>
                <td>{toTitleCase(c.nombreCandidato || c.nombreAgrupacionPolitica)}</td>
                <td>{c.totalVotosValidos.toLocaleString('es-PE')}</td>
                <td>
                  {c.porcentajeVotosValidos != null
                    ? `${c.porcentajeVotosValidos.toFixed(2)}%`
                    : '—'}
                </td>
                <td>{c.proyeccion != null ? c.proyeccion.toLocaleString('es-PE') : '—'}</td>
                {view === 'totales' && (
                  <td>
                    {c.porcentajeProyeccion != null
                      ? `${c.porcentajeProyeccion.toFixed(2)}%`
                      : '—'}
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  )
}

export default App
