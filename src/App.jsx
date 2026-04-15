import { useEffect, useMemo, useState } from 'react'
import './App.css'

function toTitleCase(str) {
  return str.toLowerCase().split(' ').map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(' ')
}

function proyectar(candidatos, totales) {
  if (!totales || totales.pctActas <= 0) return candidatos.map((c) => ({ ...c, proyeccion: null, pctProyeccion: null }))
  const estimatedTotal = totales.votosValidos / (totales.pctActas / 100)
  return candidatos
    .map((c) => ({
      ...c,
      proyeccion: c.pct != null ? Math.round((c.pct / 100) * estimatedTotal) : null,
    }))
    .sort((a, b) => (b.proyeccion ?? 0) - (a.proyeccion ?? 0))
}

function agregarFuentes(fuentes) {
  // fuentes: array of { candidatos, totales }
  const byCode = {}
  for (const { candidatos, totales } of fuentes) {
    if (!totales || totales.pctActas <= 0) continue
    const estimatedTotal = totales.votosValidos / (totales.pctActas / 100)
    for (const c of candidatos) {
      if (!byCode[c.codigo]) byCode[c.codigo] = { ...c, votos: 0, proyeccionSum: 0 }
      byCode[c.codigo].votos += c.votos
      if (c.pct != null) byCode[c.codigo].proyeccionSum += (c.pct / 100) * estimatedTotal
    }
  }
  const rows = Object.values(byCode)
  const totalVotos = rows.reduce((s, r) => s + r.votos, 0)
  const totalProy = rows.reduce((s, r) => s + r.proyeccionSum, 0)
  return rows
    .map((r) => ({
      ...r,
      pct: totalVotos > 0 ? (r.votos / totalVotos) * 100 : null,
      proyeccion: Math.round(r.proyeccionSum),
      pctProyeccion: totalProy > 0 ? (r.proyeccionSum / totalProy) * 100 : null,
    }))
    .sort((a, b) => b.proyeccion - a.proyeccion)
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
      const fuentes = [
        ...Object.values(data.departamentos),
        data.extranjeros,
      ]
      const totalActas = fuentes.reduce((acc, f) => ({
        contabilizadas: acc.contabilizadas + (f.totales?.contabilizadas ?? 0),
        totalActas: acc.totalActas + (f.totales?.totalActas ?? 0),
      }), { contabilizadas: 0, totalActas: 0 })
      return {
        candidatos: agregarFuentes(fuentes.map((f) => ({ candidatos: f.candidatos, totales: f.totales }))),
        totales: {
          pctActas: totalActas.totalActas > 0 ? (totalActas.contabilizadas / totalActas.totalActas) * 100 : 0,
          contabilizadas: totalActas.contabilizadas,
          totalActas: totalActas.totalActas,
        },
        showPctProy: true,
      }
    }

    // Region view
    let source
    if (deptoKey === 'EXTRANJEROS') {
      source = data.extranjeros
    } else {
      const depto = data.departamentos[deptoKey]
      if (provKey) {
        const prov = depto?.provincias[provKey]
        source = distKey ? prov?.distritos[distKey] : prov
      } else {
        source = depto
      }
    }

    if (!source) return { candidatos: [], totales: null, showPctProy: false }
    return {
      candidatos: proyectar(source.candidatos, source.totales),
      totales: source.totales,
      showPctProy: false,
    }
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
