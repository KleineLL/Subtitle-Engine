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
- Translate every numbered subtitle line. Do NOT skip any numbers.
- Return the same numbered format: "N|| translated text" per line

Strict output rules:
- Return ONLY the Chinese translation text
- Do NOT include the original English subtitles
- Do NOT output bilingual subtitles
- Do NOT repeat the source text
- Each output line must contain only the number, "||", and the translated Chinese dialogue
- Preserve every number from 1 to N—translate every line including narration or context

${filmContextText}`;

    const parseNumberedOutput = (
      rawResponse: string,
      chunk: (typeof entries)[0][]
    ): string[] => {
      const result: string[] = new Array(chunk.length);
      for (let j = 0; j < chunk.length; j++) {
        result[j] = chunk[j].text;
      }
      const lines = rawResponse.trim().split(/\r?\n/).filter(Boolean);
      for (const line of lines) {
        const match = line.match(/^(\d+)\s*\|\|\s*(.*)$/);
        if (match) {
          const num = parseInt(match[1], 10);
          const text = match[2].trim();
          if (num >= 1 && num <= chunk.length) {
            result[num - 1] = text;
          }
        }
      }
      return result;
    };

    const translateChunk = async (
      chunk: (typeof entries)[0][],
      numberedInput: string,
      userContent: string
    ): Promise<string[]> => {
      const completion = await client.chat.completions.create({
        model: "openai/gpt-4o-mini",
        temperature: 0.3,
        messages: [
          { role: "system", content: systemPromptBase },
          { role: "user", content: userContent },
        ],
      });
      const rawResponse = (completion.choices[0]?.message?.content ?? "").trim();
      return parseNumberedOutput(rawResponse, chunk);
    };

    const normalizeToChunkLength = (
      translatedLines: string[],
      chunk: (typeof entries)[0][]
    ): string[] => {
      const expectedLen = chunk.length;
      if (translatedLines.length === expectedLen) return translatedLines;
      if (translatedLines.length > expectedLen) {
        const head = translatedLines.slice(0, expectedLen - 1);
        const tail = translatedLines.slice(expectedLen - 1).join(" ");
        return [...head, tail];
      }
      const result = [...translatedLines];
      while (result.length < expectedLen) {
        result.push(chunk[result.length].text);
      }
      return result.slice(0, expectedLen);
    };

    await Promise.all(
      chunks.map(async (chunk, i) => {
        const chunkStartIndex = i * CHUNK_SIZE;
        const contextEntries = entries.slice(
          Math.max(0, chunkStartIndex - 10),
          chunkStartIndex
        );
        const contextText = contextEntries.map((e) => e.text).join("\n");
        const numberedInput = chunk
          .map((e, idx) => `${idx + 1}|| ${e.text}`)
          .join("\n");

        const userContent = contextText
          ? `Context from previous dialogue:
${contextText}

Subtitles to translate (numbered format—translate every line, do NOT skip any numbers):
${numberedInput}

Translate every numbered subtitle line into Chinese. Do NOT skip any numbers. Return the same numbered format.

Example output:
1|| 因为我得付房租。
2|| 但要我说的话，敌基督早就和我们在一起了……
3|| 而且他是来真的，大生意。
4|| - 好吧，宁？ - 嗯。`
          : `Subtitles to translate (numbered format—translate every line, do NOT skip any numbers):
${numberedInput}

Translate every numbered subtitle line into Chinese. Do NOT skip any numbers. Return the same numbered format.

Example output:
1|| 因为我得付房租。
2|| 但要我说的话，敌基督早就和我们在一起了……
3|| 而且他是来真的，大生意。
4|| - 好吧，宁？ - 嗯。`;

        console.log(`Translating chunk ${i + 1}/${totalChunks}`);

        let translatedLines = await translateChunk(chunk, numberedInput, userContent);

        if (translatedLines.length !== chunk.length) {
          console.warn(
            "Translation line mismatch. Retrying...",
            `expected ${chunk.length}, got ${translatedLines.length}`
          );
          translatedLines = await translateChunk(chunk, numberedInput, userContent);
        }

        if (translatedLines.length !== chunk.length) {
          translatedLines = normalizeToChunkLength(translatedLines, chunk);
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
