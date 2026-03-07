import { openrouter } from "@/lib/openrouter";

export async function generateSemanticAnchors(
  filmContext: Record<string, unknown>,
  scriptSummary: { tone: string; dialogue_style: string; narrative_summary: string }
): Promise<string[]> {
  const contextStr = Object.entries(filmContext)
    .filter(([k]) => !["characters", "scriptSummary", "semantic_anchors"].includes(k))
    .map(([k, v]) => `${k}: ${Array.isArray(v) ? (v as unknown[]).join(", ") : String(v)}`)
    .join("\n");

  const scriptStr = [
    `tone: ${scriptSummary.tone}`,
    `dialogue_style: ${scriptSummary.dialogue_style}`,
    `narrative_summary: ${scriptSummary.narrative_summary}`,
  ].join("\n");

  const prompt = `You are analyzing a film for subtitle translation.

Film context:
${contextStr}

Script understanding:
${scriptStr}

Generate 3–6 semantic anchors: short phrases describing the main linguistic and cultural domains that influence how dialogue should be interpreted. These help the translator understand slang, tone, and culturally loaded phrases.

Examples:
- For a rave culture film: youth club culture, recreational drug slang, british casual banter
- For a crime film: crime slang, gang hierarchy language, police interrogation tone
- For a comedy: sarcasm, exaggeration, casual banter

Return JSON only:
{
  "semantic_anchors": ["anchor1", "anchor2", "anchor3"]
}`;

  try {
    const completion = await openrouter.chat.completions.create({
      model: "openai/gpt-4o-mini",
      temperature: 0.3,
      messages: [
        { role: "system", content: "Return structured JSON only. No markdown." },
        { role: "user", content: prompt },
      ],
      response_format: { type: "json_object" },
    });

    const raw = (completion.choices[0]?.message?.content ?? "").trim();
    if (!raw) return [];

    const parsed = JSON.parse(raw) as { semantic_anchors?: unknown };
    const anchors = parsed.semantic_anchors;
    if (!Array.isArray(anchors)) return [];

    return anchors
      .filter((a): a is string => typeof a === "string" && a.trim().length > 0)
      .map((a) => a.trim())
      .slice(0, 8);
  } catch {
    return [];
  }
}
