// Edge Function "indices-lote": calcula NDVI, NDMI y NDRE promedio por semana
// dentro del polígono de un lote (Sentinel-2 vía Copernicus Statistical API) y
// guarda el historial en la tabla indices_lote. Respeta RLS: solo trabaja con
// los lotes del usuario que llama.
//
// Secretos necesarios (ya configurados para la función "satelite"):
//   CDSE_CLIENT_ID, CDSE_CLIENT_SECRET
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

const TOKEN_URL = "https://identity.dataspace.copernicus.eu/auth/realms/CDSE/protocol/openid-connect/token";
const STATS_URL = "https://sh.dataspace.copernicus.eu/api/v1/statistics";

const EVALSCRIPT = `//VERSION=3
function setup() {
  return {
    input: [{ bands: ["B03", "B04", "B05", "B08", "B11", "dataMask"] }],
    output: [
      { id: "ndvi", bands: 1 },
      { id: "ndmi", bands: 1 },
      { id: "ndre", bands: 1 },
      { id: "dataMask", bands: 1 }
    ]
  };
}
function evaluatePixel(s) {
  return {
    ndvi: [(s.B08 - s.B04) / (s.B08 + s.B04)],
    ndmi: [(s.B08 - s.B11) / (s.B08 + s.B11)],
    ndre: [(s.B08 - s.B05) / (s.B08 + s.B05)],
    dataMask: [s.dataMask]
  };
}`;

const INDICES = ["ndvi", "ndmi", "ndre"] as const;

async function tokenCopernicus(): Promise<string> {
  const id = Deno.env.get("CDSE_CLIENT_ID");
  const secreto = Deno.env.get("CDSE_CLIENT_SECRET");
  if (!id || !secreto) throw new Error("Faltan los secretos CDSE_CLIENT_ID y CDSE_CLIENT_SECRET.");
  const r = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "client_credentials", client_id: id, client_secret: secreto }),
  });
  if (!r.ok) throw new Error(`Copernicus rechazó las credenciales (${r.status}).`);
  return (await r.json()).access_token;
}

// Anillo del lote: lista de [lon, lat]; se cierra el polígono si hace falta
function anilloCerrado(anillo: [number, number][]): [number, number][] {
  const a = anillo.map((p) => [Number(p[0]), Number(p[1])] as [number, number]);
  const f = a[0], l = a[a.length - 1];
  if (f && l && (f[0] !== l[0] || f[1] !== l[1])) a.push(f);
  return a;
}

Deno.serve(async (req) => {
  try {
    if (req.method !== "POST") return new Response("Método no permitido", { status: 405 });

    const { potrero_id, dias = 90 } = await req.json();
    if (!potrero_id) return Response.json({ error: "Falta potrero_id" }, { status: 400 });

    // Cliente con el token del usuario: RLS limita lo que puede leer y guardar
    const cliente = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: req.headers.get("Authorization") ?? "" } } },
    );

    const { data: lote, error: errLote } = await cliente
      .from("ganader_potreros").select("id, anillo").eq("id", potrero_id).single();
    if (errLote || !lote) return Response.json({ error: "Lote no encontrado" }, { status: 404 });

    const hasta = new Date();
    const desde = new Date(hasta.getTime() - Math.min(Number(dias), 365) * 86400000);

    const r = await fetch(STATS_URL, {
      method: "POST",
      headers: { Authorization: `Bearer ${await tokenCopernicus()}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        input: {
          bounds: { geometry: { type: "Polygon", coordinates: [anilloCerrado(lote.anillo)] } },
          data: [{ type: "sentinel-2-l2a", dataFilter: { maxCloudCoverage: 40 } }],
        },
        aggregation: {
          timeRange: { from: desde.toISOString(), to: hasta.toISOString() },
          aggregationInterval: { of: "P7D" },
          evalscript: EVALSCRIPT,
          resx: 10,
          resy: 10,
        },
      }),
    });
    if (!r.ok) return Response.json({ error: "Sentinel Hub no respondió", estado: r.status }, { status: 502 });

    const datos = await r.json();
    const filas: Record<string, unknown>[] = [];
    for (const intervalo of datos.data ?? []) {
      const fecha = String(intervalo.interval.from).slice(0, 10);
      for (const indice of INDICES) {
        const banda = intervalo.outputs?.[indice]?.bands?.B0?.stats;
        const mascara = intervalo.outputs?.dataMask?.bands?.B0?.stats;
        if (!banda || !banda.sampleCount) continue; // semana sin observaciones válidas
        const nubes = mascara && mascara.sampleCount ? Math.round((1 - (mascara.mean ?? 1)) * 100) : null;
        filas.push({
          potrero_id,
          fecha,
          indice,
          media: banda.mean,
          minimo: banda.min,
          maximo: banda.max,
          nubes_pct: nubes,
          actualizado_en: new Date().toISOString(),
        });
      }
    }

    if (filas.length) {
      const { error: errGuardar } = await cliente.from("indices_lote").upsert(filas);
      if (errGuardar) return Response.json({ error: "No se pudo guardar", detalle: errGuardar.message }, { status: 500 });
    }

    return Response.json({ potrero_id, semanas: filas.length / INDICES.length, filas: filas.length });
  } catch (e) {
    return Response.json({ error: (e as Error).message }, { status: 500 });
  }
});
