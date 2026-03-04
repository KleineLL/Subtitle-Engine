import { NextResponse } from "next/server";
import { openrouter } from "@/lib/openrouter";

export const runtime = "nodejs";
export const maxDuration = 30;

const SYSTEM_PROMPT = `You are a film analyst.

Given a film title and year, generate a concise context summary for subtitle translation.

Include:
- setting
- themes
- tone
- main characters
- cultural context
- language style

Keep it under 150 words.`;

const OUTPUT_SCHEMA = `Return structured JSON only. Example:
{
  "setting": "1990s Cardiff rave culture",
  "themes": "youth nightlife, drug culture, friendship",
  "tone": "comedic, chaotic, energetic",
  "language": "British slang, casual dialogue",
  "characters": ["Jip", "Nina", "Koop", "Moff"]
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
        { role: "system", content: `${SYSTEM_PROMPT}\n\n${OUTPUT_SCHEMA}` },
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
