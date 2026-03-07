import { normalizeText } from "@/lib/normalize";
import { openrouter } from "@/lib/openrouter";

const ENGLISH_LEAKAGE_REGEX = /[A-Za-z]{3,}/;

export function buildContextFromObj(contextObj: Record<string, unknown>) {
  const excludeKeys = new Set(["characters", "scriptSummary"]);
  const filmContextEntries = Object.entries(contextObj).filter(
    ([k]) => !excludeKeys.has(k)
  );
  const filmContextDisplay =
    filmContextEntries.length > 0
      ? filmContextEntries
          .map(([k, v]) =>
            Array.isArray(v) ? `${k}: ${(v as unknown[]).join(", ")}` : `${k}: ${String(v)}`
          )
          .join("\n")
      : "No film context provided.";

  const characters = contextObj.characters;
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

  const scriptSummaryObj = contextObj.scriptSummary;
  const scriptSummary =
    scriptSummaryObj &&
    typeof scriptSummaryObj === "object" &&
    "tone" in scriptSummaryObj &&
    "dialogue_style" in scriptSummaryObj &&
    "narrative_summary" in scriptSummaryObj
      ? [
          `tone: ${String((scriptSummaryObj as Record<string, unknown>).tone)}`,
          `dialogue_style: ${String((scriptSummaryObj as Record<string, unknown>).dialogue_style)}`,
          `narrative_summary: ${String((scriptSummaryObj as Record<string, unknown>).narrative_summary)}`,
        ].join("\n")
      : "No script summary available.";

  return { filmContextDisplay, charactersDisplay, scriptSummary };
}

export function buildSystemPrompt(
  filmContextDisplay: string,
  charactersDisplay: string,
  scriptSummary: string
) {
  return `You are translating film subtitles.

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
}

type JsonEntry = { id: number; text: string };

function parseJsonOutput(rawResponse: string): JsonEntry[] | null {
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
}

export type SrtEntry = { index: number; timecode: string; text: string };

export async function translateChunkEntries(
  chunk: SrtEntry[],
  systemPrompt: string,
  previousContextText: string
): Promise<SrtEntry[]> {
  const jsonInput = JSON.stringify(
    chunk.map((e, idx) => ({ id: idx, text: e.text })),
    null,
    2
  );

  const userContent = previousContextText
    ? `Previous dialogue context (for understanding only—do not translate):
${previousContextText}

Translate the following subtitles (JSON array):
${jsonInput}`
    : `Translate the following subtitles (JSON array):
${jsonInput}`;

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
  if (!parsed || parsed.length === 0) return [];

  const result: SrtEntry[] = chunk.map((e, idx) => ({
    ...e,
    text: normalizeText(parsed.find((p) => p.id === idx)?.text ?? e.text),
  }));

  return result;
}

export async function translateChunkWithRetry(
  chunk: SrtEntry[],
  systemPrompt: string,
  previousContextText: string
): Promise<SrtEntry[]> {
  let result = await translateChunkEntries(chunk, systemPrompt, previousContextText);
  if (result.length === 0) {
    result = await translateChunkEntries(chunk, systemPrompt, previousContextText);
  }

  const originalTexts = chunk.map((e) => e.text);

  for (let i = 0; i < result.length; i++) {
    if (ENGLISH_LEAKAGE_REGEX.test(result[i].text)) {
      const prevInChunk = result
        .slice(0, i)
        .map((e) => e.text)
        .join("\n");
      const prevText = previousContextText
        ? previousContextText + (prevInChunk ? "\n" + prevInChunk : "")
        : prevInChunk;

      const retryUserContent = prevText
        ? `Previous dialogue context (for understanding only—do not translate):
${prevText}

Translate the following subtitles (JSON array). Ensure full Chinese translation:
${JSON.stringify([{ id: 0, text: originalTexts[i] }], null, 2)}`
        : `Translate the following subtitles (JSON array). Ensure full Chinese translation:
${JSON.stringify([{ id: 0, text: originalTexts[i] }], null, 2)}`;

      const retryCompletion = await openrouter.chat.completions.create({
        model: "openai/gpt-4o-mini",
        temperature: 0.3,
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: retryUserContent },
        ],
      });
      const retryRaw = (retryCompletion.choices[0]?.message?.content ?? "").trim();
      const retryParsed = parseJsonOutput(retryRaw);
      const retryText = retryParsed?.find((p) => p.id === 0)?.text;
      if (retryText) {
        result[i] = { ...result[i], text: normalizeText(retryText) };
      }
    }
  }

  return result;
}
