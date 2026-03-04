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

    const systemPromptBase = `You are a professional subtitle translator.

Rules:
- Translate dialogue naturally into Chinese
- Adapt slang and tone when appropriate
- Choose translation strategy dynamically (literal / adaptive / expressive)
- Return translations as a JSON array where each item corresponds to one subtitle line
- Do not add numbering, timestamps, or any SRT structure—only the translated text strings

Strict output rules:
- Return ONLY the Chinese translation text
- Do NOT include the original English subtitles
- Do NOT output bilingual subtitles
- Do NOT repeat the source text
- Each output line must contain only the translated Chinese dialogue

${filmContextText}`;

    const translateChunk = async (
      chunk: (typeof entries)[0][],
      textLines: string[],
      chunkText: string,
      contextText: string
    ): Promise<string[]> => {
      const userContent = contextText
        ? `Context from previous dialogue:
${contextText}

Subtitles to translate:
${chunkText}

Translate the subtitle lines into Chinese. Return ONLY a JSON array of translated strings, one per line, in the same order.

Example format:
["translation of first line", "translation of second line"]`
        : `Translate the following subtitle lines into Chinese. Return ONLY a JSON array of translated strings, one per line, in the same order.

Example format:
["translation of first line", "translation of second line"]

Subtitles to translate:
${chunkText}`;

      const completion = await client.chat.completions.create({
        model: "openai/gpt-4o-mini",
        temperature: 0.3,
        messages: [
          { role: "system", content: systemPromptBase },
          { role: "user", content: userContent },
        ],
      });

      const rawResponse = (completion.choices[0]?.message?.content ?? "").trim();
      const jsonMatch = rawResponse.match(/\[[\s\S]*\]/);
      const jsonStr = jsonMatch ? jsonMatch[0] : rawResponse;
      try {
        return JSON.parse(jsonStr) as string[];
      } catch {
        return textLines.map((t) => t);
      }
    };

    const normalizeToLength = (
      lines: string[],
      targetLength: number,
      originals: string[]
    ): string[] => {
      if (lines.length === targetLength) return lines;
      if (lines.length > targetLength) {
        const result = lines.slice(0, targetLength - 1);
        const joined = lines.slice(targetLength - 1).join(" ");
        result.push(joined);
        return result;
      }
      const result = [...lines];
      while (result.length < targetLength) {
        result.push(originals[result.length] ?? "");
      }
      return result.slice(0, targetLength);
    };

    await Promise.all(
      chunks.map(async (chunk, i) => {
        const chunkStartIndex = i * CHUNK_SIZE;
        const contextEntries = entries.slice(
          Math.max(0, chunkStartIndex - 10),
          chunkStartIndex
        );
        const contextText = contextEntries.map((e) => e.text).join("\n");
        const textLines = chunk.map((e) => e.text);
        const chunkText = JSON.stringify(textLines, null, 2);

        console.log(`Translating chunk ${i + 1}/${totalChunks}`);

        let translatedLines = await translateChunk(
          chunk,
          textLines,
          chunkText,
          contextText
        );

        if (translatedLines.length !== chunk.length) {
          console.warn(
            `Translation line mismatch (chunk ${i + 1}): got ${translatedLines.length}, expected ${chunk.length}. Retrying...`
          );
          translatedLines = await translateChunk(
            chunk,
            textLines,
            chunkText,
            contextText
          );
        }

        if (translatedLines.length !== chunk.length) {
          console.warn(
            `Translation line mismatch persists. Using fallback (chunk ${i + 1}).`
          );
          translatedLines = normalizeToLength(
            translatedLines,
            chunk.length,
            textLines
          );
        }

        for (let j = 0; j < chunk.length; j++) {
          const cleaned = (translatedLines[j] ?? chunk[j].text ?? "")
            .replace(/\n/g, " ")
            .trim();
          chunk[j].text = cleaned;
        }
      })
    );

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
