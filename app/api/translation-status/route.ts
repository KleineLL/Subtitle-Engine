import { NextResponse } from "next/server";
import { getJob } from "@/lib/translation-jobs";

export const runtime = "nodejs";

export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const jobId = searchParams.get("jobId");

    if (!jobId) {
      return NextResponse.json(
        { error: "jobId is required" },
        { status: 400 }
      );
    }

    const job = getJob(jobId);

    if (!job) {
      return NextResponse.json(
        { error: "Job not found" },
        { status: 404 }
      );
    }

    const response: {
      progress: number;
      done: boolean;
      result?: string;
      error?: string;
    } = {
      progress: job.progress,
      done: job.done,
    };

    if (job.done && job.result) {
      response.result = job.result;
    }

    if (job.done && job.error) {
      response.error = job.error;
    }

    return NextResponse.json(response);
  } catch (error) {
    console.error("Translation status error:", error);
    return NextResponse.json(
      { error: "Failed to get translation status" },
      { status: 500 }
    );
  }
}
