import { openrouter } from "@/lib/openrouter";

const SYSTEM_PROMPT = `You are a film analyst preparing context for subtitle translation.

Given a film title and year, produce two structured outputs:

STEP 1 — Film metadata understanding:
- title, year, director
- setting
- themes
- cultural context
- language style

STEP 2 — Cultural context enrichment:
Based on your knowledge of this film (from Wikipedia, IMDb, Letterboxd, critical reception, audience discussions), synthesize a short cultural context. Do NOT scrape pages—use your existing knowledge to generate:
- subculture_context
- slang_style
- historical_background
- audience_perception

Keep STEP 2 under 150 words total.

STEP 3 — Character extraction:
Identify major characters and infer their gender when possible from your knowledge of the film.

Return a single JSON object merging all steps. Example structure (use placeholder format—generate real values from the input film):
{
  "title": "...",
  "year": "...",
  "director": "...",
  "setting": "...",
  "themes": "...",
  "cultural_context": "...",
  "language_style": "...",
  "subculture_context": "...",
  "slang_style": "...",
  "historical_background": "...",
  "audience_perception": "...",
  "characters": [
    { "name": "...", "gender": "male" },
    { "name": "...", "gender": "female" }
  ]
}`;

export async function generateFilmContext(
  title: string,
  year?: string
): Promise<Record<string, unknown>> {
  const yearStr = year != null ? String(year).trim() : "";
  const userContent = yearStr
    ? `Film: "${title}" (${yearStr})`
    : `Film: "${title}"`;

  const completion = await openrouter.chat.completions.create({
    model: "openai/gpt-4o-mini",
    temperature: 0.3,
    messages: [
      { role: "system", content: SYSTEM_PROMPT },
      { role: "user", content: userContent },
    ],
    response_format: { type: "json_object" },
  });

  const raw = (completion.choices[0]?.message?.content ?? "").trim();
  if (!raw) throw new Error("No response from model");

  return JSON.parse(raw) as Record<string, unknown>;
}
