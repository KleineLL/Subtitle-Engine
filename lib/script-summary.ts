import { parseSrt } from "@/lib/srt";
import { openrouter } from "@/lib/openrouter";

const SCRIPT_SAMPLE_MAX_CHARS = 12000;

export type ScriptSummary = {
  tone: string;
  dialogue_style: string;
  narrative_summary: string;
};

export async function generateScriptSummary(subtitles: string): Promise<ScriptSummary | null> {
  const entries = parseSrt(subtitles);
  if (entries.length === 0) return null;

  const fullScriptText = entries.map((e) => e.text).join("\n");
  const scriptSample =
    fullScriptText.length > SCRIPT_SAMPLE_MAX_CHARS
      ? fullScriptText.slice(0, SCRIPT_SAMPLE_MAX_CHARS - 100) + "\n[...]"
      : fullScriptText;

  const prompt = `Analyze this subtitle script sample and summarize for translation guidance.

Subtitle dialogue (sample):
${scriptSample}

Return JSON only:
{
  "tone": "description of overall tone",
  "dialogue_style": "description of how characters speak",
  "narrative_summary": "brief summary of narrative situation, character dynamics, slang density, cultural references"
}`;

  try {
    const completion = await openrouter.chat.completions.create({
      model: "openai/gpt-4o-mini",
      temperature: 0.2,
      messages: [
        { role: "system", content: "Return structured JSON only. No markdown." },
        { role: "user", content: prompt },
      ],
      response_format: { type: "json_object" },
    });

    const raw = (completion.choices[0]?.message?.content ?? "").trim();
    if (!raw) return null;

    const parsed = JSON.parse(raw) as Record<string, unknown>;
    return {
      tone: String(parsed.tone ?? ""),
      dialogue_style: String(parsed.dialogue_style ?? ""),
      narrative_summary: String(parsed.narrative_summary ?? ""),
    };
  } catch {
    return null;
  }
}
