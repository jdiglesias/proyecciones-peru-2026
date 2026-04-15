import { useEffect, useMemo, useState } from 'react'
import './App.css'

function toTitleCase(str) {
  return str.toLowerCase().split(' ').map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(' ')
}

// Returns { estimatedTotal, candidatos } for a source, falling back up the chain
// if the source has no counted actas.
function resolveContribucion(totales, candidatos, ...fallbacks) {
  if (totales?.pctActas > 0) {
    return { estimatedTotal: totales.votosValidos / (totales.pctActas / 100), candidatos }
  }
  if (!totales?.totalActas) return null
  // Source has actas but none counted — estimate from nearest parent with data
  for (const fb of fallbacks) {
    if (fb?.totales?.contabilizadas > 0) {
      const votesPerActa = fb.totales.votosValidos / fb.totales.contabilizadas
      return { estimatedTotal: totales.totalActas * votesPerActa, candidatos: fb.candidatos }
    }
  }
  return null
}

function proyectar(source, ...fallbacks) {
  const contrib = resolveContribucion(source.totales, source.candidatos, ...fallbacks)
  if (!contrib) return source.candidatos.map((c) => ({ ...c, proyeccion: null }))
  const { estimatedTotal, candidatos } = contrib
  return candidatos
    .map((c) => ({ ...c, proyeccion: c.pct != null ? Math.round((c.pct / 100) * estimatedTotal) : null }))
    .sort((a, b) => (b.proyeccion ?? 0) - (a.proyeccion ?? 0))
}

function buildNacionalData(data) {
  const byCode = {}

  for (const depto of Object.values(data.departamentos)) {
    for (const prov of Object.values(depto.provincias)) {
      for (const dist of Object.values(prov.distritos)) {
        const contrib = resolveContribucion(dist.totales, dist.candidatos, prov, depto)
        if (!contrib) continue
        const { estimatedTotal, candidatos } = contrib
        for (const c of candidatos) {
          if (!byCode[c.codigo]) byCode[c.codigo] = { ...c, votos: 0, proyeccionSum: 0 }
          // actual votes only from districts that have reported
          if (dist.totales?.pctActas > 0) byCode[c.codigo].votos += c.votos
          if (c.pct != null) byCode[c.codigo].proyeccionSum += (c.pct / 100) * estimatedTotal
        }
      }
    }
  }

  // Extranjeros
  const ext = data.extranjeros
  const extContrib = resolveContribucion(ext.totales, ext.candidatos)
  if (extContrib) {
    for (const c of extContrib.candidatos) {
      if (!byCode[c.codigo]) byCode[c.codigo] = { ...c, votos: 0, proyeccionSum: 0 }
      if (ext.totales?.pctActas > 0) byCode[c.codigo].votos += c.votos
      if (c.pct != null) byCode[c.codigo].proyeccionSum += (c.pct / 100) * extContrib.estimatedTotal
    }
  }

  const rows = Object.values(byCode)
  const totalVotos = rows.reduce((s, r) => s + r.votos, 0)
  const totalProy = rows.reduce((s, r) => s + r.proyeccionSum, 0)

  const actasTotals = Object.values(data.departamentos).reduce(
    (acc, d) => ({
      contabilizadas: acc.contabilizadas + (d.totales?.contabilizadas ?? 0),
      totalActas: acc.totalActas + (d.totales?.totalActas ?? 0),
    }),
    { contabilizadas: ext.totales?.contabilizadas ?? 0, totalActas: ext.totales?.totalActas ?? 0 },
  )

  return {
    candidatos: rows
      .map((r) => ({
        ...r,
        pct: totalVotos > 0 ? (r.votos / totalVotos) * 100 : null,
        proyeccion: Math.round(r.proyeccionSum),
        pctProyeccion: totalProy > 0 ? (r.proyeccionSum / totalProy) * 100 : null,
      }))
      .sort((a, b) => b.proyeccion - a.proyeccion),
    totales: {
      pctActas: actasTotals.totalActas > 0 ? (actasTotals.contabilizadas / actasTotals.totalActas) * 100 : 0,
      contabilizadas: actasTotals.contabilizadas,
      totalActas: actasTotals.totalActas,
    },
  }
}

function App() {
  const [data, setData] = useState(null)
  const [view, setView] = useState('totales')
  const [deptoKey, setDeptoKey] = useState('140000')
  const [provKey, setProvKey] = useState(null)
  const [distKey, setDistKey] = useState(null)

  useEffect(() => {
    fetch('/data.json').then((r) => r.json()).then(setData).catch(console.error)
  }, [])

  // Reset deeper selections when parent changes
  function selectDepto(k) { setDeptoKey(k); setProvKey(null); setDistKey(null) }
  function selectProv(k) { setProvKey(k); setDistKey(null) }

  const deptos = useMemo(() => {
    if (!data) return []
    return Object.entries(data.departamentos).map(([k, v]) => ({ key: k, nombre: v.nombre }))
  }, [data])

  const provs = useMemo(() => {
    if (!data || deptoKey === 'EXTRANJEROS') return []
    const depto = data.departamentos[deptoKey]
    if (!depto) return []
    return Object.entries(depto.provincias).map(([k, v]) => ({ key: k, nombre: v.nombre }))
  }, [data, deptoKey])

  const dists = useMemo(() => {
    if (!data || !provKey || deptoKey === 'EXTRANJEROS') return []
    const prov = data.departamentos[deptoKey]?.provincias[provKey]
    if (!prov) return []
    return Object.entries(prov.distritos).map(([k, v]) => ({ key: k, nombre: v.nombre }))
  }, [data, deptoKey, provKey])

  const { candidatos, totales, showPctProy } = useMemo(() => {
    if (!data) return { candidatos: [], totales: null, showPctProy: false }

    if (view === 'totales') {
      const { candidatos, totales } = buildNacionalData(data)
      return { candidatos, totales, showPctProy: true }
    }

    // Region view — pass fallbacks up the chain for unstarted sources
    if (deptoKey === 'EXTRANJEROS') {
      const source = data.extranjeros
      return { candidatos: proyectar(source), totales: source.totales, showPctProy: false }
    }

    const depto = data.departamentos[deptoKey]
    if (!provKey) {
      return { candidatos: proyectar(depto), totales: depto.totales, showPctProy: false }
    }

    const prov = depto.provincias[provKey]
    if (!distKey) {
      return { candidatos: proyectar(prov, depto), totales: prov.totales, showPctProy: false }
    }

    const dist = prov.distritos[distKey]
    return { candidatos: proyectar(dist, prov, depto), totales: dist.totales, showPctProy: false }
  }, [data, view, deptoKey, provKey, distKey])

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
        <div className="selectors">
          <select value={deptoKey} onChange={(e) => selectDepto(e.target.value)}>
            {deptos.map((d) => (
              <option key={d.key} value={d.key}>{toTitleCase(d.nombre)}</option>
            ))}
            <option value="EXTRANJEROS">Extranjeros</option>
          </select>

          {provs.length > 0 && (
            <select value={provKey ?? ''} onChange={(e) => selectProv(e.target.value || null)}>
              <option value="">— Departamento completo —</option>
              {provs.map((p) => (
                <option key={p.key} value={p.key}>{toTitleCase(p.nombre)}</option>
              ))}
            </select>
          )}

          {dists.length > 0 && (
            <select value={distKey ?? ''} onChange={(e) => setDistKey(e.target.value || null)}>
              <option value="">— Provincia completa —</option>
              {dists.map((d) => (
                <option key={d.key} value={d.key}>{toTitleCase(d.nombre)}</option>
              ))}
            </select>
          )}
        </div>
      )}

      {totales && (
        <p style={{ marginBottom: '10px' }}>
          Actas contabilizadas: {totales.pctActas.toFixed(1)}% ({totales.contabilizadas} de {totales.totalActas})
        </p>
      )}

      {!data && <p>Cargando...</p>}

      {candidatos.length > 0 && (
        <table>
          <thead>
            <tr>
              <th>Candidato</th>
              <th>Votos válidos</th>
              <th>% votos válidos</th>
              <th>Proyección final</th>
              {showPctProy && <th>% proyección</th>}
            </tr>
          </thead>
          <tbody>
            {candidatos.map((c) => (
              <tr key={c.codigo}>
                <td>{toTitleCase(c.nombre)}</td>
                <td>{c.votos.toLocaleString('es-PE')}</td>
                <td>{c.pct != null ? `${c.pct.toFixed(2)}%` : '—'}</td>
                <td>{c.proyeccion != null ? c.proyeccion.toLocaleString('es-PE') : '—'}</td>
                {showPctProy && (
                  <td>{c.pctProyeccion != null ? `${c.pctProyeccion.toFixed(2)}%` : '—'}</td>
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
