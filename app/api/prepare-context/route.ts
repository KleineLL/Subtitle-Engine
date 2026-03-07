import { NextResponse } from "next/server";
import { openrouter } from "@/lib/openrouter";
import { parseSrt } from "@/lib/srt";

export const runtime = "nodejs";
export const maxDuration = 60;

const FILM_CONTEXT_PROMPT = `You are a film analyst preparing context for subtitle translation.

Given a film title and year, produce structured outputs:
- title, year, director, setting, themes, cultural_context, language_style
- subculture_context, slang_style, historical_background, audience_perception
- characters: array of { name, gender }

Return a single JSON object. Generate real values from the input film.`;

const SCRIPT_SUMMARY_PROMPT = `Analyze this subtitle script sample and summarize for translation guidance.

Return JSON only:
{
  "tone": "description of overall tone",
  "dialogue_style": "description of how characters speak",
  "narrative_summary": "brief summary of narrative situation, character dynamics, slang density, cultural references"
}`;

const SCRIPT_SAMPLE_MAX_CHARS = 12000;

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

    if (!subtitles || typeof subtitles !== "string" || !subtitles.trim()) {
      return NextResponse.json(
        { error: "Subtitles are required" },
        { status: 400 }
      );
    }

    const yearStr = year != null ? String(year).trim() : "";
    const filmUserContent = yearStr
      ? `Film: "${title}" (${yearStr})`
      : `Film: "${title}"`;

    // Step 1: Film metadata, cultural context, characters
    const filmCompletion = await openrouter.chat.completions.create({
      model: "openai/gpt-4o-mini",
      temperature: 0.3,
      messages: [
        { role: "system", content: FILM_CONTEXT_PROMPT },
        { role: "user", content: filmUserContent },
      ],
      response_format: { type: "json_object" },
    });

    const filmRaw = (filmCompletion.choices[0]?.message?.content ?? "").trim();
    if (!filmRaw) {
      return NextResponse.json(
        { error: "Failed to generate film context" },
        { status: 500 }
      );
    }

    const filmContext = JSON.parse(filmRaw) as Record<string, unknown>;

    // Step 2: Script summary from subtitles
    const entries = parseSrt(subtitles);
    const fullScriptText = entries.map((e) => e.text).join("\n");
    const scriptSample =
      fullScriptText.length > SCRIPT_SAMPLE_MAX_CHARS
        ? fullScriptText.slice(0, SCRIPT_SAMPLE_MAX_CHARS - 100) + "\n[...]"
        : fullScriptText;

    let scriptSummary = "";
    try {
      const scriptCompletion = await openrouter.chat.completions.create({
        model: "openai/gpt-4o-mini",
        temperature: 0.2,
        messages: [
          { role: "system", content: "Return structured JSON only. No markdown." },
          {
            role: "user",
            content: `${SCRIPT_SUMMARY_PROMPT}\n\nSubtitle dialogue (sample):\n${scriptSample}`,
          },
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
      console.warn("Script summary failed:", e);
    }

    const result = {
      ...filmContext,
      scriptSummary: scriptSummary || "No script summary available.",
    };

    return NextResponse.json(result);
  } catch (error) {
    console.error("Prepare context error:", error);
    return NextResponse.json(
      { error: "Failed to prepare context" },
      { status: 500 }
    );
  }
}
