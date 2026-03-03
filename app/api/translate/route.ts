import { NextResponse } from "next/server";
import OpenAI from "openai";

const client = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

const CHUNK_SIZE = 15;

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
    const timecodeMatch = lines[1].match(/\d{2}:\d{2}:\d{2}[,.]\d{3}\s*-->\s*\d{2}:\d{2}:\d{2}[,.]\d{3}/);
    const timecode = timecodeMatch ? lines[1].trim() : "";
    const text = lines.slice(2).join("\n").trim();

    entries.push({ index, timecode, text });
  }

  return entries;
}

function formatChunkForTranslation(entries: SrtEntry[]): string {
  return entries
    .map((e, i) => `${i + 1}\n${e.text}`)
    .join("\n\n");
}

function parseTranslatedChunk(raw: string, count: number): string[] {
  const texts: string[] = [];
  const blocks = raw.trim().split(/\n\s*\n/).filter(Boolean);

  for (let i = 0; i < Math.min(blocks.length, count); i++) {
    const lines = blocks[i].split(/\r?\n/);
    const text = lines.length > 1 ? lines.slice(1).join("\n").trim() : lines[0]?.trim() ?? "";
    texts.push(text);
  }

  return texts;
}

function entryToSrt(entry: SrtEntry, text: string): string {
  return `${entry.index}\n${entry.timecode}\n${text}\n`;
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
- Return only the translated subtitles in the same format: each block is a number on line 1, then the translated text, with blank lines between blocks.
- Do not output reasoning steps.
- Do not add or modify timecodes.`;

    const translatedTexts: string[] = [];

    for (let i = 0; i < entries.length; i += CHUNK_SIZE) {
      const chunk = entries.slice(i, i + CHUNK_SIZE);
      const chunkInput = formatChunkForTranslation(chunk);

      const completion = await client.chat.completions.create({
        model: "gpt-4o-mini",
        temperature: 0.7,
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: `Translate only the subtitle text. Preserve timecodes by not changing the format.\n\n${chunkInput}` },
        ],
      });

      const raw = completion.choices[0]?.message?.content?.trim() ?? "";
      const parsed = parseTranslatedChunk(raw, chunk.length);

      for (let j = 0; j < chunk.length; j++) {
        translatedTexts.push(parsed[j] ?? chunk[j].text);
      }
    }

    const translated = entries
      .map((entry, i) => entryToSrt(entry, translatedTexts[i] ?? entry.text))
      .join("\n");

    return NextResponse.json({ translated });
  } catch (error: any) {
    console.error("Translation error:", error);
    return NextResponse.json(
      { error: "Translation failed" },
      { status: 500 }
    );
  }
}
