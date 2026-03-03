import { NextResponse } from "next/server";
import OpenAI from "openai";

const client = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const { subtitles, filmContext } = body;

    if (!subtitles) {
      return NextResponse.json(
        { error: "No subtitles provided" },
        { status: 400 }
      );
    }

    const filmInfo = filmContext
      ? `Film context:
Title: ${filmContext.Title ?? ""}
Year: ${filmContext.Year ?? ""}
Genre: ${filmContext.Genre ?? ""}
Director: ${filmContext.Director ?? ""}
Actors: ${filmContext.Actors ?? ""}
Plot: ${filmContext.Plot ?? ""}

`
      : "";

    const systemPrompt = `You are a professional film subtitle translator.

${filmInfo}For EACH subtitle line, follow this internal process:

Step 1: Identify the sentence function:
(exposition, humor, tension, casual speech, irony, historical tone, emotional climax, cultural reference, etc.)

Step 2: Decide which translation strategy best preserves:
- semantic meaning
- emotional tone
- character voice
- spoken rhythm

Step 3: Apply that strategy locally.

Important rules:
- Do NOT apply a fixed global style.
- Strategy switching per sentence is encouraged.
- Avoid mechanical consistency.
- Preserve subtitle formatting and timing exactly.
- Return only the translated subtitles.
- Do not output reasoning steps.`;

    const completion = await client.chat.completions.create({
      model: "gpt-4o-mini",
      temperature: 0.7,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: `Subtitles:\n${subtitles}` },
      ],
    });

    const translated =
      completion.choices[0]?.message?.content || "Translation failed.";

    return NextResponse.json({ translated });
  } catch (error: any) {
    console.error("Translation error:", error);
    return NextResponse.json(
      { error: "Translation failed" },
      { status: 500 }
    );
  }
}
