import { normalizeText } from "@/lib/normalize";
import { openrouter } from "@/lib/openrouter";

const ENGLISH_WORD_REGEX = /\b[a-zA-Z]{3,}\b/g;

/**
 * Returns true if text contains English dialogue words that should have been
 * translated. Proper nouns (capitalized standalone, quoted, or in brackets) are
 * allowed.
 */
function hasEnglishDialogueLeakage(text: string): boolean {
  const matches = text.matchAll(ENGLISH_WORD_REGEX);
  for (const match of matches) {
    const word = match[0];
    const start = match.index!;
    const end = start + word.length;
    const charBefore = text[start - 1] ?? " ";
    const charAfter = text[end] ?? " ";

    // Skip if inside quotes: "word" or 'word'
    if (
      (charBefore === '"' && charAfter === '"') ||
      (charBefore === "'" && charAfter === "'")
    ) {
      continue;
    }
    // Skip if inside brackets: [word] or [word ...]
    if (charBefore === "[") {
      const afterWord = text.slice(end);
      if (afterWord.includes("]")) continue;
    }
    if (charAfter === "]") {
      const beforeWord = text.slice(0, start);
      if (beforeWord.includes("[")) continue;
    }
    // Skip if capitalized and standalone (likely proper noun: Oasis, Blur)
    if (word[0] === word[0].toUpperCase() && word.slice(1) === word.slice(1).toLowerCase()) {
      const beforeIsBoundary = /[\s\u4e00-\u9fff，。！？；：、""\u201C\u201D\p{P}]/u.test(charBefore) || start === 0;
      const afterIsBoundary = /[\s\u4e00-\u9fff，。！？；：、""\u201C\u201D\p{P}]/u.test(charAfter) || end === text.length;
      if (beforeIsBoundary && afterIsBoundary) continue;
    }

    return true; // Found English dialogue that should have been translated
  }
  return false;
}

export function buildContextFromObj(contextObj: Record<string, unknown>) {
  const excludeKeys = new Set([
    "characters",
    "scriptSummary",
    "semantic_anchors",
  ]);
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

  const semanticAnchors = contextObj.semantic_anchors;
  const semanticAnchorsList =
    Array.isArray(semanticAnchors) && semanticAnchors.length > 0
      ? (semanticAnchors as string[]).map((a) => `- ${a}`).join("\n")
      : "";

  return {
    filmContextDisplay,
    charactersDisplay,
    scriptSummary,
    semanticAnchorsList,
  };
}

export function buildSystemPrompt(
  filmContextDisplay: string,
  charactersDisplay: string,
  scriptSummary: string,
  semanticAnchorsList: string
) {
  const semanticAnchorsSection =
    semanticAnchorsList
      ? `

Semantic anchors (use these to interpret dialogue meaning before translating):
${semanticAnchorsList}

Use the semantic anchors to interpret dialogue meaning before translating into Chinese.
`
      : "";

  return `You are translating film subtitles.

You have access to:
- Film context (metadata, setting, themes, cultural context, language style)
- Script understanding (tone, dialogue style, narrative summary)
- Character information (for gender-aware dialogue)${semanticAnchorsList ? "\n- Semantic anchors (linguistic and cultural domains)" : ""}

Use them to interpret dialogue appropriately.${semanticAnchorsSection}

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

  const stricterInstruction = `Translate the dialogue fully into Chinese.
Do not leave English words in the dialogue.
Exception: preserve song titles, band names, artist names, and film titles in English (e.g. Oasis, Blur, Smells Like Teen Spirit).`;

  for (let i = 0; i < result.length; i++) {
    if (hasEnglishDialogueLeakage(result[i].text)) {
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

${stricterInstruction}

Translate the following subtitles (JSON array):
${JSON.stringify([{ id: 0, text: originalTexts[i] }], null, 2)}`
        : `${stricterInstruction}

Translate the following subtitles (JSON array):
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
