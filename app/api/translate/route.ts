import { NextResponse } from "next/server";
import { parseSrt, entriesToSrt } from "@/lib/srt";
import { openrouter } from "@/lib/openrouter";

const CHUNK_SIZE = 40;

export const runtime = "nodejs";
export const maxDuration = 60;

function cleanChineseSpacing(text: string): string {
  return text
    .replace(/\s+/g, " ")
    .replace(/([，。！？；：、""\u201C\u201D])\s+/g, "$1")
    .trim();
}

export async function POST(req: Request) {
  try {
    console.log("API /api/translate called");

    const body = await req.json();
    const { subtitles, filmContext } = body;
    console.log("Request received");

    const filmContextDisplay =
      filmContext && typeof filmContext === "object"
        ? Object.entries(filmContext)
            .map(([k, v]) =>
              Array.isArray(v) ? `${k}: ${(v as unknown[]).join(", ")}` : `${k}: ${String(v)}`
            )
            .join("\n")
        : filmContext && typeof filmContext === "string"
          ? filmContext
          : "No film context provided.";

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

    const systemPrompt = `You are a professional subtitle translator.

Film context:
${filmContextDisplay}

Use this context to understand:
- cultural references
- slang
- character relationships
- tone and humor

Translate subtitles into natural Chinese.

You will receive a JSON array of subtitle entries.
Translate ONLY the text field into Chinese.
Return a JSON array with the same ids.

Rules:
- do not skip any entries
- do not include English
- keep the same ids
- return only Chinese translations`;

    type JsonEntry = { id: number; text: string };

    const parseJsonOutput = (
      rawResponse: string,
      chunk: (typeof entries)[0][]
    ): JsonEntry[] | null => {
      const trimmed = rawResponse.trim();
      const jsonMatch = trimmed.match(/\[[\s\S]*\]/);
      if (!jsonMatch) return null;
      try {
        const parsed = JSON.parse(jsonMatch[0]) as unknown;
        if (!Array.isArray(parsed)) return null;
        const result: JsonEntry[] = [];
        for (const item of parsed) {
          if (
            item &&
            typeof item === "object" &&
            "id" in item &&
            "text" in item &&
            typeof (item as JsonEntry).id === "number" &&
            typeof (item as JsonEntry).text === "string"
          ) {
            result.push({ id: (item as JsonEntry).id, text: (item as JsonEntry).text });
          }
        }
        return result;
      } catch {
        return null;
      }
    };

    const translateChunk = async (
      chunk: (typeof entries)[0][],
      jsonInput: string,
      userContent: string
    ): Promise<JsonEntry[] | null> => {
      const completion = await openrouter.chat.completions.create({
        model: "openai/gpt-4o-mini",
        temperature: 0.3,
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userContent },
        ],
      });
      const rawResponse = (completion.choices[0]?.message?.content ?? "").trim();
      return parseJsonOutput(rawResponse, chunk);
    };

    await Promise.all(
      chunks.map(async (chunk, i) => {
        const chunkStartIndex = i * CHUNK_SIZE;
        const contextEntries = entries.slice(
          Math.max(0, chunkStartIndex - 10),
          chunkStartIndex
        );
        const contextText = contextEntries.map((e) => e.text).join("\n");

        const jsonInput = JSON.stringify(
          chunk.map((e, idx) => ({ id: idx, text: e.text })),
          null,
          2
        );

        const userContent = contextText
          ? `Context from previous dialogue:
${contextText}

Subtitles to translate (JSON array):
${jsonInput}

Example output:
[
  { "id": 0, "text": "因为我得付房租。" },
  { "id": 1, "text": "但要我说的话……" },
  { "id": 2, "text": "而且他是来真的，大生意。" }
]`
          : `Subtitles to translate (JSON array):
${jsonInput}

Example output:
[
  { "id": 0, "text": "因为我得付房租。" },
  { "id": 1, "text": "但要我说的话……" },
  { "id": 2, "text": "而且他是来真的，大生意。" }
]`;

        console.log(`Translating chunk ${i + 1}/${totalChunks}`);

        let result = await translateChunk(chunk, jsonInput, userContent);

        if (!result) {
          console.warn("JSON parse failed. Retrying translation...");
          result = await translateChunk(chunk, jsonInput, userContent);
        }

        if (result) {
          result.forEach((item) => {
            const targetIndex = chunkStartIndex + item.id;
            if (targetIndex >= 0 && targetIndex < entries.length) {
              entries[targetIndex].text = cleanChineseSpacing(item.text);
            }
          });
        } else {
          console.error(`Chunk ${i + 1}: JSON parsing failed after retry. Skipping chunk.`);
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
