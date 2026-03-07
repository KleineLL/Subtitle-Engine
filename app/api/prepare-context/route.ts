import { NextResponse } from "next/server";
import { generateScriptSummary } from "@/lib/script-summary";

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

    const yearStr = year != null ? String(year).trim() : "";

    // Fetch film context from our own API
    const host =
      req.headers.get("x-forwarded-host") ||
      req.headers.get("host") ||
      process.env.VERCEL_URL ||
      "localhost:3000";
    const protocol = req.headers.get("x-forwarded-proto") || "http";
    const baseUrl = `${protocol}://${host}`;

    const fcRes = await fetch(`${baseUrl}/api/film-context`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title: title.trim(), year: yearStr }),
    });

    let filmContext: Record<string, unknown> = {};
    if (fcRes.ok) {
      filmContext = (await fcRes.json()) as Record<string, unknown>;
    }

    // Generate script summary
    const scriptSummary = await generateScriptSummary(subtitles);
    const scriptSummaryObj = scriptSummary
      ? {
          tone: scriptSummary.tone,
          dialogue_style: scriptSummary.dialogue_style,
          narrative_summary: scriptSummary.narrative_summary,
        }
      : { tone: "", dialogue_style: "", narrative_summary: "" };

    const result = {
      ...filmContext,
      scriptSummary: scriptSummaryObj,
    };

    return NextResponse.json(result);
  } catch (error) {
    console.error("Prepare context error:", error);
    return NextResponse.json(
      { error: "Failed to prepare film context" },
      { status: 500 }
    );
  }
}
