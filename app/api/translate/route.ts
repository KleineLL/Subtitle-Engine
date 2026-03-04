import { NextResponse } from "next/server";
import OpenAI from "openai";

export const runtime = "nodejs";
export const maxDuration = 60;

const CHUNK_SIZE = 80;
const CONCURRENCY_LIMIT = 5;

const client = new OpenAI({
  baseURL: "https://openrouter.ai/api/v1",
  apiKey: process.env.OPENROUTER_API_KEY,
  defaultHeaders: {
    "HTTP-Referer": "https://subtitle-engine.vercel.app",
    "X-Title": "Subtitle Engine",
  },
});

type SrtEntry = {
  index: number;
  timecode: string;
  text: string;
};

function parseSrt(srt: string): SrtEntry[] {
  const entries: SrtEntry[] = [];
  const blocks = srt.trim().split(/\n\s*\n/).filter(Boolean);

  for (const block of blocks) {
    const lines = block.split(/\r?\n/);
    if (lines.length < 2) continue;

    const index = parseInt(lines[0], 10) || entries.length + 1;
    const timecodeMatch = lines[1].match(
      /\d{2}:\d{2}:\d{2}[,.]\d{3}\s*-->\s*\d{2}:\d{2}:\d{2}[,.]\d{3}/
    );
    const timecode = timecodeMatch ? lines[1].trim() : "";
    const text = lines.slice(2).join("\n").trim();

    entries.push({ index, timecode, text });
  }

  return entries;
}

function formatChunkForTranslation(entries: SrtEntry[]): string {
  return entries.map((e, i) => `${i + 1}\n${e.text}`).join("\n\n");
}

function parseTranslatedChunk(raw: string, count: number): string[] {
  const texts: string[] = [];
  const blocks = raw.trim().split(/\n\s*\n/).filter(Boolean);

  for (let i = 0; i < Math.min(blocks.length, count); i++) {
    const lines = blocks[i].split(/\r?\n/);
    const text =
      lines.length > 1
        ? lines.slice(1).join("\n").trim()
        : lines[0]?.trim() ?? "";
    texts.push(text);
  }

  return texts;
}

function entryToSrt(entry: SrtEntry, text: string): string {
  return `${entry.index}\n${entry.timecode}\n${text}\n`;
}

async function runWithConcurrency<T, R>(
  items: T[],
  limit: number,
  fn: (item: T, index: number) => Promise<R>
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let index = 0;

  async function worker(): Promise<void> {
    while (index < items.length) {
      const i = index++;
      results[i] = await fn(items[i], i);
    }
  }

  const workers = Array(Math.min(limit, items.length))
    .fill(null)
    .map(() => worker());
  await Promise.all(workers);
  return results;
}

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

    const entries = parseSrt(subtitles);
    if (entries.length === 0) {
      return NextResponse.json(
        { error: "No valid subtitle entries found" },
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

    const systemPrompt = `You are a professional film subtitle translator.

${filmInfo}Rules:
- Keep subtitle numbering unchanged
- Keep timestamps unchanged
- Only translate dialogue
- Output valid SRT format
- Do not add commentary`;

    const chunks: SrtEntry[][] = [];
    for (let i = 0; i < entries.length; i += CHUNK_SIZE) {
      chunks.push(entries.slice(i, i + CHUNK_SIZE));
    }

    const translateChunk = async (
      chunk: SrtEntry[],
      _index: number
    ): Promise<string[]> => {
      const chunkText = formatChunkForTranslation(chunk);

      const completion = await client.chat.completions.create({
        model: "openai/gpt-4o-mini",
        temperature: 0.7,
        messages: [
          { role: "system", content: systemPrompt },
          {
            role: "user",
            content: `Translate the following subtitles into Chinese:

${chunkText}

Return only translated SRT lines.`,
          },
        ],
      });

      const raw = completion.choices[0]?.message?.content?.trim() ?? "";
      return parseTranslatedChunk(raw, chunk.length);
    };

    const results = await runWithConcurrency(
      chunks,
      CONCURRENCY_LIMIT,
      translateChunk
    );

    const translatedTexts: string[] = results.flat();

    const translated = entries
      .map((entry, i) => entryToSrt(entry, translatedTexts[i] ?? entry.text))
      .join("\n");

    return NextResponse.json({ translated });
  } catch (error) {
    console.error("Translation error:", error);
    return NextResponse.json(
      { error: "Translation failed" },
      { status: 500 }
    );
  }
}
