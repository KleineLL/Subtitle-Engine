import { NextResponse } from "next/server";
import OpenAI from "openai";

export const runtime = "nodejs";
export const maxDuration = 60;

const client = new OpenAI({
  baseURL: "https://openrouter.ai/api/v1",
  apiKey: process.env.OPENROUTER_API_KEY,
  defaultHeaders: {
    "HTTP-Referer": "https://subtitle-engine.vercel.app",
    "X-Title": "Subtitle Engine",
  },
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
      ? `Film Context
Title: ${filmContext.Title ?? ""}
Year: ${filmContext.Year ?? ""}
Genre: ${filmContext.Genre ?? ""}
Plot: ${filmContext.Plot ?? ""}

`
      : "";

    const systemPrompt = `You are a professional subtitle translator.

${filmInfo}Rules:
- Keep the same numbering
- Keep the same timestamps
- Only translate the dialogue text
- Output valid SRT format`;

    const completion = await client.chat.completions.create({
      model: "openai/gpt-4o-mini",
      temperature: 0.7,
      messages: [
        { role: "system", content: systemPrompt },
        {
          role: "user",
          content: `Translate the following subtitles:\n\n${subtitles}\n\nReturn only the translated SRT.`,
        },
      ],
    });

    const translated =
      completion.choices[0]?.message?.content?.trim() ?? "Translation failed.";

    return NextResponse.json({ translated });
  } catch (error) {
    console.error("Translation error:", error);
    return NextResponse.json(
      { error: "Translation failed" },
      { status: 500 }
    );
  }
}
