import { NextResponse } from "next/server";
import { parseSrt } from "@/lib/srt";
import { generateFilmContext } from "@/lib/film-context";
import { openrouter } from "@/lib/openrouter";

const SCRIPT_SAMPLE_MAX_CHARS = 12000;

export const runtime = "nodejs";
export const maxDuration = 90;

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const { title, year, subtitles } = body;

    if (!title || typeof title !== "string" || !title.trim()) {
      return NextResponse.json(
        { error: "Title is required" },
        { status: 400 }
      );
    }

    if (!subtitles || typeof subtitles !== "string") {
      return NextResponse.json(
        { error: "Subtitles are required" },
        { status: 400 }
      );
    }

    const entries = parseSrt(subtitles);
    if (entries.length === 0) {
      return NextResponse.json(
        { error: "No valid subtitle entries" },
        { status: 400 }
      );
    }

    const filmContext = await generateFilmContext(title, year);

    const fullScriptText = entries.map((e) => e.text).join("\n");
    const scriptSample =
      fullScriptText.length > SCRIPT_SAMPLE_MAX_CHARS
        ? fullScriptText.slice(0, SCRIPT_SAMPLE_MAX_CHARS - 100) + "\n[...]"
        : fullScriptText;

    const scriptUnderstandingPrompt = `Analyze this subtitle script sample and summarize for translation guidance.

Subtitle dialogue (sample):
${scriptSample}

Return JSON only:
{
  "tone": "description of overall tone",
  "dialogue_style": "description of how characters speak",
  "narrative_summary": "brief summary of narrative situation, character dynamics, slang density, cultural references"
}`;

    let scriptSummary = "No script summary available.";
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
      console.warn("Script understanding failed:", e);
    }

    const result = {
      ...filmContext,
      script_summary: scriptSummary,
    };

    return NextResponse.json(result);
  } catch (error) {
    console.error("Film understanding error:", error);
    return NextResponse.json(
      { error: "Failed to generate film understanding" },
      { status: 500 }
    );
  }
}
