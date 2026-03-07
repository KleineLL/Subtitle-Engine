import { NextResponse } from "next/server";
import { parseSrt, entriesToSrt } from "@/lib/srt";
import { normalizeText } from "@/lib/normalize";
import { openrouter } from "@/lib/openrouter";

const CHUNK_SIZE = 40;
const CONTEXT_WINDOW = 6;
const SCRIPT_SAMPLE_MAX_CHARS = 12000;
const ENGLISH_LEAKAGE_REGEX = /[A-Za-z]{3,}/;

export const runtime = "nodejs";
export const maxDuration = 60;

export async function POST(req: Request) {
  try {
    console.log("API /api/translate called");

    const body = await req.json();
    const { subtitles, confirmedContext } = body;
    const filmContext = confirmedContext ?? body.filmContext;
    console.log("Request received");

    const filmContextObj =
      filmContext && typeof filmContext === "object" ? filmContext : {};
    const filmContextEntries = Object.entries(filmContextObj).filter(
      ([k]) => k !== "characters" && k !== "script_summary"
    );
    const filmContextDisplay =
      filmContextEntries.length > 0
        ? filmContextEntries
            .map(([k, v]) =>
              Array.isArray(v) ? `${k}: ${(v as unknown[]).join(", ")}` : `${k}: ${String(v)}`
            )
            .join("\n")
        : filmContext && typeof filmContext === "string"
          ? filmContext
          : "No film context provided.";

    const characters = (filmContextObj as Record<string, unknown>).characters;
    const charactersDisplay =
      Array.isArray(characters) && characters.length > 0
        ? characters
            .map((c: unknown) => {
              if (c && typeof c === "object" && "name" in c && "gender" in c) {
                return `${(c as { name: string; gender: string }).name} (${(c as { name: string; gender: string }).gender})`;
              }
              return null;
            })
            .filter(Boolean)
            .join(", ")
        : "No character information available.";

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
    console.log("Total chunks:", totalChunks);

    const originalTexts = entries.map((e) => e.text);

    // Use confirmed script summary if provided; otherwise generate it
    let scriptSummary =
      (filmContextObj as Record<string, unknown>).script_summary as string | undefined;
    if (!scriptSummary || typeof scriptSummary !== "string") {
      const fullScriptText = entries.map((e) => e.text).join("\n");
      const scriptSample =
        fullScriptText.length > SCRIPT_SAMPLE_MAX_CHARS
          ? fullScriptText.slice(0, SCRIPT_SAMPLE_MAX_CHARS - 100) + "\n[...]"
          : fullScriptText;

      console.log("Generating script understanding...");
      const scriptUnderstandingPrompt = `Analyze this subtitle script sample and summarize for translation guidance.

Subtitle dialogue (sample):
${scriptSample}

Return JSON only:
{
  "tone": "description of overall tone",
  "dialogue_style": "description of how characters speak",
  "narrative_summary": "brief summary of narrative situation, character dynamics, slang density, cultural references"
}`;

      scriptSummary = "No script summary available.";
      try {
        const scriptCompletion = await openrouter.chat.completions.create({
          model: "openai/gpt-4o-mini",
          temperature: 0.2,
          messages: [
            { role: "system", content: "Return structured JSON only. No markdown." },
            { role: "user", content: scriptUnderstandingPrompt },
          ],
          response_format: { type: "json_object" },
        });
        const scriptRaw = (scriptCompletion.choices[0]?.message?.content ?? "").trim();
        if (scriptRaw) {
          const scriptParsed = JSON.parse(scriptRaw) as Record<string, unknown>;
          scriptSummary = Object.entries(scriptParsed)
            .map(([k, v]) => `${k}: ${String(v)}`)
            .join("\n");
        }
      } catch (e) {
        console.warn("Script understanding failed, continuing without:", e);
      }
    }

    // STEP 4 — Context-aware translation
    const systemPrompt = `You are translating film subtitles.

You have access to:
- Film context (metadata, setting, themes, cultural context, language style)
- Script understanding (tone, dialogue style, narrative summary)
- Character information (for gender-aware dialogue)

Use them to interpret dialogue appropriately.

Translation rules:
- Preserve meaning
- Use natural spoken Chinese
- Adapt slang based on cultural context
- Do not rewrite dialogue unnecessarily
- Keep translations concise and subtitle-friendly
- Maintain speaker's tone, humor, and personality

All dialogue must be translated fully into Chinese.
English words must not appear in the output unless they are:
- song titles
- band names
- film titles
- proper nouns such as character names.
Do not leave English phrases untranslated.

When translating slang such as "mate", consider the gender of the addressed character if known.
Prefer gender-neutral Chinese expressions such as:
伙计
哥们
老兄
Avoid gendered terms like "兄弟" when addressing a female character.

Film context:
${filmContextDisplay}

Characters (name, gender):
${charactersDisplay}

Script understanding:
${scriptSummary}

Input format: JSON array with id and text. Output format: same structure with Chinese translations only.
Example input: [{"id":0,"text":"Hello there."},{"id":1,"text":"How are you?"}]
Example output: [{"id":0,"text":"你好。"},{"id":1,"text":"你好吗？"}]

Rules:
- Do NOT change ids
- Do NOT change or generate timestamps
- Return only the JSON array
- Do not skip any entries
- Do not include English in output (except proper nouns, titles)

You may receive previous dialogue context for understanding only. Do NOT translate the context.`;

    type JsonEntry = { id: number; text: string };

    const parseJsonOutput = (rawResponse: string): JsonEntry[] | null => {
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
    ): Promise<Map<number, string>> => {
      const completion = await openrouter.chat.completions.create({
        model: "openai/gpt-4o-mini",
        temperature: 0.3,
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userContent },
        ],
      });
      const rawResponse = (completion.choices[0]?.message?.content ?? "").trim();
      const parsed = parseJsonOutput(rawResponse);
      if (!parsed) return new Map();

      const map = new Map<number, string>();
      parsed.forEach((item) => map.set(item.id, item.text));
      return map;
    };

    await Promise.all(
      chunks.map(async (chunk, i) => {
        const chunkStartIndex = i * CHUNK_SIZE;
        const contextEntries = entries.slice(
          Math.max(0, chunkStartIndex - CONTEXT_WINDOW),
          chunkStartIndex
        );
        const contextText = contextEntries
          .map((e) => e.text)
          .join("\n");

        const jsonInput = JSON.stringify(
          chunk.map((e, idx) => ({ id: idx, text: e.text })),
          null,
          2
        );

        const userContent = contextText
          ? `Previous dialogue context (for understanding only—do not translate):
${contextText}

Translate the following subtitles (JSON array):
${jsonInput}`
          : `Translate the following subtitles (JSON array):
${jsonInput}`;

        console.log(`Translating chunk ${i + 1}/${totalChunks}`);

        let translationMap = await translateChunk(chunk, jsonInput, userContent);

        if (translationMap.size === 0) {
          console.warn("JSON parse failed. Retrying translation...");
          translationMap = await translateChunk(chunk, jsonInput, userContent);
        }

        if (translationMap.size > 0) {
          translationMap.forEach((text, id) => {
            const targetIndex = chunkStartIndex + id;
            if (targetIndex >= 0 && targetIndex < entries.length) {
              entries[targetIndex].text = normalizeText(text);
            }
          });
        } else {
          console.error(`Chunk ${i + 1}: JSON parsing failed after retry. Skipping chunk.`);
        }
      })
    );

    // English leakage check: retry entries that still contain English words (3+ letters)
    const leakedIndices: number[] = [];
    for (let idx = 0; idx < entries.length; idx++) {
      if (ENGLISH_LEAKAGE_REGEX.test(entries[idx].text)) {
        leakedIndices.push(idx);
      }
    }
    if (leakedIndices.length > 0) {
      console.warn(`English leakage detected in ${leakedIndices.length} entries, retrying...`);
      for (const leakedIndex of leakedIndices) {
        const contextEntries = entries.slice(
          Math.max(0, leakedIndex - CONTEXT_WINDOW),
          leakedIndex
        );
        const contextText = contextEntries.map((e) => e.text).join("\n");
        const originalText = originalTexts[leakedIndex];
        const jsonInput = JSON.stringify([{ id: 0, text: originalText }], null, 2);

        const userContent = contextText
          ? `Previous dialogue context (for understanding only—do not translate):
${contextText}

Translate the following subtitles (JSON array). Ensure full Chinese translation:
${jsonInput}`
          : `Translate the following subtitles (JSON array). Ensure full Chinese translation:
${jsonInput}`;

        const retryMap = await translateChunk(
          [entries[leakedIndex]],
          jsonInput,
          userContent
        );
        const retryText = retryMap.get(0);
        if (retryText) {
          entries[leakedIndex].text = normalizeText(retryText);
        }
      }
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
