import { NextResponse } from "next/server";
import OpenAI from "openai";
import { parseSrt, entriesToSrt } from "@/lib/srt";

const CHUNK_SIZE = 40;

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
    console.log("API called");
    const body = await req.json();
    const { subtitles } = body;

    if (!subtitles) {
      return NextResponse.json(
        { error: "No subtitles provided" },
        { status: 400 }
      );
    }

    const entries = parseSrt(subtitles);
    console.log("Entries:", entries.length);
    if (entries.length === 0) {
      return NextResponse.json(
        { error: "No valid subtitle entries" },
        { status: 400 }
      );
    }

    const chunks: typeof entries[] = [];
    for (let i = 0; i < entries.length; i += CHUNK_SIZE) {
      chunks.push(entries.slice(i, i + CHUNK_SIZE));
    }

    const totalChunks = chunks.length;
    const translatedChunks: string[] = [];

    const systemPrompt = `You are a professional subtitle translator.

Rules:
- Keep subtitle numbering unchanged
- Keep timestamps unchanged
- Only translate dialogue into Chinese
- Return valid SRT format
- Do not add explanations`;

    for (let i = 0; i < chunks.length; i++) {
      console.log("Translating chunk", i + 1, "/", totalChunks);

      const chunkSrt = entriesToSrt(chunks[i]);

      console.log("Calling OpenRouter");
      const completion = await client.chat.completions.create({
        model: "openai/gpt-4o-mini",
        temperature: 0.7,
        messages: [
          { role: "system", content: systemPrompt },
          {
            role: "user",
            content: `Translate the following subtitles into Chinese and return valid SRT:

${chunkSrt}

Return only the translated subtitles.`,
          },
        ],
      });

      const translatedChunk =
        completion.choices[0]?.message?.content?.trim() ?? "";

      translatedChunks.push(translatedChunk);
    }

    const finalSrt = translatedChunks.join("\n\n");

    return NextResponse.json({ translated: finalSrt });
  } catch (error) {
    console.error("Translation error:", error);
    return NextResponse.json(
      { error: "Translation failed" },
      { status: 500 }
    );
  }
}
