import { NextResponse } from "next/server";
import OpenAI from "openai";
import { parseSrt, entriesToSrt } from "@/lib/srt";

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
    const { subtitles } = body;

    if (!subtitles) {
      return NextResponse.json(
        { error: "No subtitles provided" },
        { status: 400 }
      );
    }

    const entries = parseSrt(subtitles);
    if (entries.length === 0) {
      return NextResponse.json(
        { error: "No valid subtitle entries" },
        { status: 400 }
      );
    }

    const fullSrtText = entriesToSrt(entries);

    const completion = await client.chat.completions.create({
      model: "openai/gpt-4o-mini",
      temperature: 0.7,
      messages: [
        {
          role: "system",
          content: `You are a professional subtitle translator.

Rules:
- Keep subtitle numbering unchanged
- Keep timestamps unchanged
- Only translate dialogue
- Return valid SRT format
- Do not add explanations`,
        },
        {
          role: "user",
          content: `Translate the following subtitles into Chinese and return valid SRT:

${fullSrtText}

Return only the translated subtitles.`,
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
