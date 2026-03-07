import { NextResponse } from "next/server";
import {
  buildContextFromObj,
  buildSystemPrompt,
  translateChunkWithRetry,
} from "@/lib/translate";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const { chunk, confirmedContext, previousContextText } = body;

    if (!chunk || !Array.isArray(chunk) || chunk.length === 0) {
      return NextResponse.json(
        { error: "Chunk is required and must be a non-empty array" },
        { status: 400 }
      );
    }

    const contextObj =
      confirmedContext && typeof confirmedContext === "object"
        ? (confirmedContext as Record<string, unknown>)
        : {};
    const prevText =
      typeof previousContextText === "string" ? previousContextText : "";

    const { filmContextDisplay, charactersDisplay, scriptSummary } =
      buildContextFromObj(contextObj);
    const systemPrompt = buildSystemPrompt(
      filmContextDisplay,
      charactersDisplay,
      scriptSummary
    );

    const chunkEntries = chunk.map(
      (e: { index?: number; timecode?: string; text?: string }) => ({
        index: Number(e.index ?? 0),
        timecode: String(e.timecode ?? ""),
        text: String(e.text ?? ""),
      })
    );

    const translated = await translateChunkWithRetry(
      chunkEntries,
      systemPrompt,
      prevText
    );

    return NextResponse.json({ translated });
  } catch (error) {
    console.error("Translate chunk error:", error);
    return NextResponse.json(
      { error: "translation failed" },
      { status: 500 }
    );
  }
}
