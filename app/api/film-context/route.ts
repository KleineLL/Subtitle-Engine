import { NextResponse } from "next/server";
import { openrouter } from "@/lib/openrouter";

export const runtime = "nodejs";
export const maxDuration = 60;

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

Return a single JSON object merging all steps. Example structure:
{
  "title": "Human Traffic",
  "year": "1999",
  "director": "Justin Kerrigan",
  "setting": "1990s Cardiff rave culture",
  "themes": "youth nightlife, drug culture, friendship",
  "cultural_context": "UK club scene, ecstasy culture, weekend lifestyle",
  "language_style": "British slang, casual dialogue, rave terminology",
  "subculture_context": "UK rave and club culture of the late 90s",
  "slang_style": "Casual, drug-related slang, youth vernacular",
  "historical_background": "Post-Thatcher Britain, rise of dance music",
  "audience_perception": "Cult film about youth culture and hedonism",
  "characters": [
    { "name": "Jip", "gender": "male" },
    { "name": "Nina", "gender": "female" },
    { "name": "Koop", "gender": "male" },
    { "name": "Moff", "gender": "male" },
    { "name": "Trixi", "gender": "female" }
  ]
}`;

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const { title, year } = body;

    if (!title || typeof title !== "string" || !title.trim()) {
      return NextResponse.json(
        { error: "Title is required" },
        { status: 400 }
      );
    }

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
    if (!raw) {
      return NextResponse.json(
        { error: "No response from model" },
        { status: 500 }
      );
    }

    const parsed = JSON.parse(raw) as Record<string, unknown>;
    return NextResponse.json(parsed);
  } catch (error) {
    console.error("Film context error:", error);
    return NextResponse.json(
      { error: "Failed to generate film context" },
      { status: 500 }
    );
  }
}
