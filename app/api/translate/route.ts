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
    console.log("API /api/translate called");

    const body = await req.json();
    const { subtitles, filmContext } = body;
    console.log("Request received");

    const filmContextText = filmContext
      ? `Film context:\n${filmContext.Title ?? ""} (${filmContext.Year ?? ""})\n${filmContext.Genre ?? ""}${filmContext.Plot ? `\n${filmContext.Plot}` : ""}`
      : "(No film context provided)";

    if (!subtitles) {
      return NextResponse.json(
        { error: "No subtitles provided" },
        { status: 400 }
      );
    }

    const entries = parseSrt(subtitles);
    console.log("Parsed subtitle entries:", entries.length);
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
    console.log("Total chunks:", chunks.length);

    let storyMemory = "";
    const systemPromptBase = `You are a professional subtitle translator.

Rules:
- Translate dialogue naturally into Chinese
- Adapt slang and tone when appropriate
- Choose translation strategy dynamically (literal / adaptive / expressive)
- Return translations as a JSON array where each item corresponds to one subtitle line
- Do not add numbering, timestamps, or any SRT structure—only the translated text strings

${filmContextText}

Story so far:
`;

    for (let i = 0; i < chunks.length; i++) {
      console.log(`Translating chunk ${i + 1}/${totalChunks}`);

      const chunk = chunks[i];
      const textLines = chunk.map((e) => e.text);
      const textLinesJson = JSON.stringify(textLines, null, 2);
      const systemPrompt = `${systemPromptBase}${storyMemory || "(This is the first chunk.)"}`;

      const completion = await client.chat.completions.create({
        model: "openai/gpt-4o-mini",
        temperature: 0.3,
        messages: [
          { role: "system", content: systemPrompt },
          {
            role: "user",
            content: `Translate the following subtitle lines into Chinese. Return ONLY a JSON array of translated strings, one per line, in the same order.

Example format:
["translation of first line", "translation of second line"]

Subtitle lines to translate:
${textLinesJson}`,
          },
        ],
      });

      const rawResponse = (completion.choices[0]?.message?.content ?? "").trim();
      const jsonMatch = rawResponse.match(/\[[\s\S]*\]/);
      const jsonStr = jsonMatch ? jsonMatch[0] : rawResponse;
      let translatedLines: string[];
      try {
        translatedLines = JSON.parse(jsonStr) as string[];
      } catch {
        translatedLines = textLines.map((t) => t);
      }

      for (let j = 0; j < chunk.length; j++) {
        const cleaned = (translatedLines[j] ?? chunk[j].text ?? "")
          .replace(/\n/g, " ")
          .trim();
        chunk[j].text = cleaned;
      }

      const translatedTextForSummary = chunk.map((e) => e.text).join(" ");
      const summaryCompletion = await client.chat.completions.create({
        model: "openai/gpt-4o-mini",
        temperature: 0.2,
        messages: [
          {
            role: "user",
            content: `Summarize the dialogue in 1–2 sentences so future chunks understand the story context:\n\n${translatedTextForSummary}`,
          },
        ],
      });

      const summary = (summaryCompletion.choices[0]?.message?.content ?? "").trim();
      storyMemory = summary ? `${storyMemory ? storyMemory + "\n\n" : ""}${summary}` : storyMemory;
    }

    console.log("All chunks translated");

    const finalSrt = entriesToSrt(entries);
    console.log("Returning final SRT");

    return NextResponse.json({ translated: finalSrt });
  } catch (error) {
    console.error("Translation error full:", error);
    return NextResponse.json(
      { error: "Translation failed" },
      { status: 500 }
    );
  }
}
