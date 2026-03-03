import { NextResponse } from "next/server";
import OpenAI from "openai";

const client = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const { subtitles } = body;

    if (!subtitles) {
      return NextResponse.json(
        { error: "No subtitles provided" },
        { status: 400 }
      );
    }

    const prompt = `
You are a professional film subtitle translator.

Translation philosophy:
Context-aware adaptive (recommended).

For each subtitle line:

1. Identify its function (exposition, humor, tension, casual dialogue, historical tone, etc.).
2. Decide which translation strategy best preserves meaning, emotion, and rhythm.
3. Apply that strategy locally.
4. Avoid applying a fixed global style.
5. Maintain overall coherence across the film.
6. Preserve subtitle timing format exactly.

Return ONLY translated subtitles.
Do not add explanations.

Subtitles:
${subtitles}
`;

    const completion = await client.chat.completions.create({
      model: "gpt-4o-mini",
      temperature: 0.7,
      messages: [
        { role: "system", content: "You are a film subtitle translator." },
        { role: "user", content: prompt },
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
