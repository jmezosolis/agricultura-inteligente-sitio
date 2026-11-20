// Consulta el pronóstico de Open-Meteo para los puntos de cada estado y guarda
// potreros/mapa-alertas/clima-estados.json. Lo ejecuta GitHub Actions cada hora.
import { readFile, writeFile } from 'node:fs/promises';

const PUNTOS = 'potreros/mapa-alertas/puntos-estados.json';
const SALIDA = 'potreros/mapa-alertas/clima-estados.json';
const LOTE = 42;               // puntos por petición
const PAUSA_MS = 20000;        // espera entre lotes (límite por minuto del servicio)
const REINTENTOS = 4;

const dormir = (ms) => new Promise((r) => setTimeout(r, ms));

async function pedirLote(lote) {
  const url = 'https://api.open-meteo.com/v1/forecast?latitude=' + lote.map((p) => p.lat).join(',') +
    '&longitude=' + lote.map((p) => p.lon).join(',') +
    '&daily=temperature_2m_max,temperature_2m_min,precipitation_sum,wind_speed_10m_max&timezone=auto&forecast_days=3';
  for (let intento = 0; intento <= REINTENTOS; intento++) {
    const r = await fetch(url);
    if (r.ok) {
      const datos = await r.json();
      return Array.isArray(datos) ? datos : [datos];
    }
    if (r.status !== 429 || intento === REINTENTOS) throw new Error('Open-Meteo respondió ' + r.status);
    await dormir(65000);
  }
}

const puntos = JSON.parse(await readFile(PUNTOS, 'utf8'));
const resultados = [];

for (let i = 0; i < puntos.length; i += LOTE) {
  if (i > 0) await dormir(PAUSA_MS);
  const lote = puntos.slice(i, i + LOTE);
  const lugares = await pedirLote(lote);
  lugares.forEach((lugar, k) => {
    const d = lugar.daily;
    const r = { estado: lote[k].estado, lat: lote[k].lat, lon: lote[k].lon, dias: [] };
    d.time.forEach((fecha, j) => r.dias.push({
      fecha,
      max: d.temperature_2m_max[j],
      min: d.temperature_2m_min[j],
      lluvia: d.precipitation_sum[j],
      viento: d.wind_speed_10m_max[j],
    }));
    resultados.push(r);
  });
}

const salida = { actualizado: new Date().toISOString(), fuente: 'Open-Meteo', puntos: resultados };
await writeFile(SALIDA, JSON.stringify(salida), 'utf8');
console.log('puntos guardados:', resultados.length, '->', SALIDA);
