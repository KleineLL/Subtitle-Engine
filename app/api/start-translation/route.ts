import { NextResponse } from "next/server";
import { after } from "next/server";
import { createJob, runTranslationJob } from "@/lib/translation-jobs";

export const runtime = "nodejs";
export const maxDuration = 300;

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const { subtitles, filmContext } = body;

    if (!subtitles) {
      return NextResponse.json(
        { error: "No subtitles provided" },
        { status: 400 }
      );
    }

    const jobId = createJob(subtitles, filmContext);

    after(async () => {
      await runTranslationJob(jobId);
    });

    return NextResponse.json({ jobId });
  } catch (error) {
    console.error("Start translation error:", error);
    return NextResponse.json(
      { error: "Failed to start translation" },
      { status: 500 }
    );
  }
}
