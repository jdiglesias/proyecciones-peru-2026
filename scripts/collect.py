#!/usr/bin/env python3
import asyncio
import json
import time
from datetime import datetime, timezone
from pathlib import Path

import aiohttp

BASE = "https://resultadoelectoral.onpe.gob.pe/presentacion-backend"
HEADERS = {
    "Accept": "application/json, text/plain, */*",
    "X-Requested-With": "XMLHttpRequest",
    "Referer": "https://resultadoelectoral.onpe.gob.pe/",
    "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
    "sec-fetch-dest": "empty",
    "sec-fetch-mode": "cors",
    "sec-fetch-site": "same-origin",
}
CONCURRENCY = 20
RETRIES = 3


async def fetch(session, url, sem):
    async with sem:
        for attempt in range(RETRIES):
            try:
                async with session.get(url, headers=HEADERS, ssl=False) as resp:
                    text = await resp.text()
                    try:
                        data = json.loads(text)
                    except json.JSONDecodeError:
                        raise ValueError(f"Non-JSON (HTTP {resp.status}): {text[:300]}")
                    if data.get("success"):
                        return data["data"]
                    raise ValueError(f"API error: {data.get('message')}")
            except Exception as e:
                if attempt == RETRIES - 1:
                    print(f"  FAILED {url}: {e}")
                    return None
                await asyncio.sleep(0.5 * (attempt + 1))


def trim_candidatos(candidatos):
    if not candidatos:
        return []
    return [
        {
            "codigo": c["codigoAgrupacionPolitica"],
            "nombre": c.get("nombreCandidato") or c["nombreAgrupacionPolitica"],
            "votos": c["totalVotosValidos"],
            "pct": c.get("porcentajeVotosValidos"),
        }
        for c in candidatos
        if c["codigoAgrupacionPolitica"] not in ("80", "81")
    ]


def trim_totales(t):
    if not t:
        return None
    return {
        "pctActas": t["actasContabilizadas"],
        "contabilizadas": t["contabilizadas"],
        "totalActas": t["totalActas"],
        "votosValidos": t["totalVotosValidos"],
    }


async def fetch_departamentos(session, sem):
    return await fetch(session, f"{BASE}/ubigeos/departamentos?idEleccion=10&idAmbitoGeografico=1", sem)


async def fetch_provincias(session, sem, ubigeo_depto):
    return await fetch(session, f"{BASE}/ubigeos/provincias?idEleccion=10&idAmbitoGeografico=1&idUbigeoDepartamento={ubigeo_depto}", sem)


async def fetch_distritos(session, sem, ubigeo_prov):
    return await fetch(session, f"{BASE}/ubigeos/distritos?idEleccion=10&idAmbitoGeografico=1&idUbigeoProvincia={ubigeo_prov}", sem)


async def fetch_candidatos_depto(session, sem, u1):
    return await fetch(session, f"{BASE}/eleccion-presidencial/participantes-ubicacion-geografica-nombre?tipoFiltro=ubigeo_nivel_01&idAmbitoGeografico=1&ubigeoNivel1={u1}&listDistrito=&listContinentals=&listCountries=&idEleccion=10", sem)


async def fetch_totales_depto(session, sem, u1):
    return await fetch(session, f"{BASE}/resumen-general/totales?idAmbitoGeografico=1&idEleccion=10&tipoFiltro=ubigeo_nivel_01&idUbigeoDepartamento={u1}", sem)


async def fetch_candidatos_prov(session, sem, u1, u2):
    return await fetch(session, f"{BASE}/eleccion-presidencial/participantes-ubicacion-geografica-nombre?tipoFiltro=ubigeo_nivel_02&idAmbitoGeografico=1&ubigeoNivel1={u1}&ubigeoNivel2={u2}&listRegiones=TODOS,PER%C3%9A,EXTRANJERO&idEleccion=10", sem)


async def fetch_totales_prov(session, sem, u1, u2):
    return await fetch(session, f"{BASE}/resumen-general/totales?idAmbitoGeografico=1&idEleccion=10&tipoFiltro=ubigeo_nivel_02&idUbigeoDepartamento={u1}&idUbigeoProvincia={u2}", sem)


async def fetch_candidatos_dist(session, sem, u1, u2, u3):
    return await fetch(session, f"{BASE}/eleccion-presidencial/participantes-ubicacion-geografica-nombre?tipoFiltro=ubigeo_nivel_03&idAmbitoGeografico=1&ubigeoNivel1={u1}&ubigeoNivel2={u2}&ubigeoNivel3={u3}&listRegiones=TODOS,PER%C3%9A,EXTRANJERO&idEleccion=10", sem)


async def fetch_totales_dist(session, sem, u1, u2, u3):
    return await fetch(session, f"{BASE}/resumen-general/totales?idAmbitoGeografico=1&idEleccion=10&tipoFiltro=ubigeo_nivel_03&idUbigeoDepartamento={u1}&idUbigeoProvincia={u2}&idUbigeoDistrito={u3}", sem)


async def fetch_candidatos_extranjeros(session, sem):
    return await fetch(session, f"{BASE}/eleccion-presidencial/participantes-ubicacion-geografica-nombre?tipoFiltro=ambito_geografico&idAmbitoGeografico=2&listDepartamento=&listProvincia=&listDistrito=&listCountries=&idEleccion=10", sem)


async def fetch_totales_extranjeros(session, sem):
    return await fetch(session, f"{BASE}/resumen-general/totales?idAmbitoGeografico=2&idEleccion=10&tipoFiltro=ambito_geografico", sem)


async def process_distrito(session, sem, u1, u2, dist):
    u3 = dist["ubigeo"]
    candidatos, totales = await asyncio.gather(
        fetch_candidatos_dist(session, sem, u1, u2, u3),
        fetch_totales_dist(session, sem, u1, u2, u3),
    )
    return u3, {
        "nombre": dist["nombre"],
        "totales": trim_totales(totales),
        "candidatos": trim_candidatos(candidatos),
    }


async def process_provincia(session, sem, u1, prov):
    u2 = prov["ubigeo"]
    candidatos, totales, distritos_list = await asyncio.gather(
        fetch_candidatos_prov(session, sem, u1, u2),
        fetch_totales_prov(session, sem, u1, u2),
        fetch_distritos(session, sem, u2),
    )

    distrito_tasks = [
        process_distrito(session, sem, u1, u2, dist)
        for dist in (distritos_list or [])
    ]
    distrito_results = await asyncio.gather(*distrito_tasks)

    return u2, {
        "nombre": prov["nombre"],
        "totales": trim_totales(totales),
        "candidatos": trim_candidatos(candidatos),
        "distritos": dict(distrito_results),
    }


async def process_departamento(session, sem, depto):
    u1 = depto["ubigeo"]
    print(f"  {depto['nombre']} ({u1})...")

    candidatos, totales, provincias_list = await asyncio.gather(
        fetch_candidatos_depto(session, sem, u1),
        fetch_totales_depto(session, sem, u1),
        fetch_provincias(session, sem, u1),
    )

    provincia_tasks = [
        process_provincia(session, sem, u1, prov)
        for prov in (provincias_list or [])
    ]
    provincia_results = await asyncio.gather(*provincia_tasks)

    return u1, {
        "nombre": depto["nombre"],
        "totales": trim_totales(totales),
        "candidatos": trim_candidatos(candidatos),
        "provincias": dict(provincia_results),
    }


async def main():
    start = time.time()
    sem = asyncio.Semaphore(CONCURRENCY)

    connector = aiohttp.TCPConnector(ssl=False)
    async with aiohttp.ClientSession(connector=connector) as session:
        print("Fetching departments list...")
        departamentos = await fetch_departamentos(session, sem)
        print(f"Found {len(departamentos)} departments\n")

        print("Fetching extranjeros...")
        ext_candidatos, ext_totales = await asyncio.gather(
            fetch_candidatos_extranjeros(session, sem),
            fetch_totales_extranjeros(session, sem),
        )

        print("Fetching all departments, provinces, districts...\n")
        depto_tasks = [process_departamento(session, sem, d) for d in departamentos]
        depto_results = await asyncio.gather(*depto_tasks)

    result = {
        "lastUpdated": datetime.now(timezone.utc).isoformat(),
        "extranjeros": {
            "totales": trim_totales(ext_totales),
            "candidatos": trim_candidatos(ext_candidatos),
        },
        "departamentos": dict(depto_results),
    }

    out_path = Path(__file__).parent.parent / "public" / "data.json"
    out_path.write_text(json.dumps(result))
    elapsed = time.time() - start
    print(f"\nDone in {elapsed:.1f}s — saved to {out_path}")

    total_distritos = sum(
        len(d["provincias"][p]["distritos"])
        for d in result["departamentos"].values()
        for p in d["provincias"]
    )
    print(f"Departments: {len(result['departamentos'])}, Districts: {total_distritos}")


if __name__ == "__main__":
    asyncio.run(main())
