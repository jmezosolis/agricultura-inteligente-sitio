import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { withSupabase } from "jsr:@supabase/server@^1";

const MODELO = "claude-sonnet-5-5";

const SISTEMA = `Eres un asistente agrícola para productores de México (Morelos y Centro del país).
Responde solo con JSON válido, sin texto extra, con esta forma:
{"diagnostico": "texto breve", "confianza": "alta|media|baja", "acciones": ["acción 1", "acción 2"], "prioridad": "alta|media|baja", "aviso": "recuerda que debe revisarlo un técnico en campo"}`;

export default {
  fetch: withSupabase({ auth: ["publishable"] }, async (req) => {
    if (req.method !== "POST") {
      return new Response("Método no permitido", { status: 405 });
    }

    const { pregunta, imagenBase64, tipoImagen = "image/jpeg" } = await req.json();
    const clave = Deno.env.get("ANTHROPIC_API_KEY");
    if (!clave) {
      return Response.json({ error: "Falta configurar ANTHROPIC_API_KEY" }, { status: 500 });
    }

    const contenido: unknown[] = [];
    if (imagenBase64) {
      contenido.push({
        type: "image",
        source: { type: "base64", media_type: tipoImagen, data: imagenBase64 },
      });
    }
    contenido.push({
      type: "text",
      text: pregunta ?? "Analiza la imagen de la planta o del cultivo y responde en el formato indicado.",
    });

    const respuesta = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "x-api-key": clave,
        "anthropic-version": "2023-06-01",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model: MODELO,
        max_tokens: 1200,
        system: SISTEMA,
        messages: [{ role: "user", content: contenido }],
      }),
    });

    if (!respuesta.ok) {
      return Response.json({ error: "La IA no respondió", estado: respuesta.status }, { status: 502 });
    }

    const datos = await respuesta.json();
    const texto = datos?.content?.[0]?.text ?? "";
    return Response.json({ respuesta: texto });
  }),
};
