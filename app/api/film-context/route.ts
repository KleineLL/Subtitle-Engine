import { NextResponse } from "next/server";
import { generateFilmContext } from "@/lib/film-context";

export const runtime = "nodejs";
export const maxDuration = 60;

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

    const parsed = await generateFilmContext(title, year);
  } catch (error) {
    console.error("Film context error:", error);
    return NextResponse.json(
      { error: "Failed to generate film context" },
      { status: 500 }
    );
  }
}
