import OpenAI from "openai";

const CHUNK_SIZE = 50;

const client = new OpenAI({
  baseURL: "https://openrouter.ai/api/v1",
  apiKey: process.env.OPENROUTER_API_KEY,
  defaultHeaders: {
    "HTTP-Referer": "https://subtitle-engine.vercel.app",
    "X-Title": "Subtitle Engine",
  },
});

type TranslationJob = {
  progress: number;
  done: boolean;
  result?: string;
  error?: string;
  subtitles?: string;
  filmContext?: {
    Title?: string;
    Year?: string;
    Genre?: string;
    Plot?: string;
  };
};

const jobs = new Map<string, TranslationJob>();

function createJobId(): string {
  return `job_${Date.now()}_${Math.random().toString(36).slice(2, 11)}`;
}

export function createJob(
  subtitles: string,
  filmContext?: TranslationJob["filmContext"]
): string {
  const jobId = createJobId();
  jobs.set(jobId, {
    progress: 0,
    done: false,
    subtitles,
    filmContext,
  });
  return jobId;
}

export function getJob(jobId: string): Omit<TranslationJob, "subtitles"> | undefined {
  const job = jobs.get(jobId);
  if (!job) return undefined;
  const { subtitles: _, ...rest } = job;
  return rest;
}

function setJobData(jobId: string, data: Partial<TranslationJob>): void {
  const job = jobs.get(jobId);
  if (job) {
    Object.assign(job, data);
  }
}

type SrtEntry = {
  index: number;
  timecode: string;
  text: string;
};

function parseSrt(srt: string): SrtEntry[] {
  const entries: SrtEntry[] = [];
  const blocks = srt.trim().split(/\n\s*\n/).filter(Boolean);

  for (const block of blocks) {
    const lines = block.split(/\r?\n/);
    if (lines.length < 2) continue;

    const index = parseInt(lines[0], 10) || entries.length + 1;
    const timecodeMatch = lines[1].match(
      /\d{2}:\d{2}:\d{2}[,.]\d{3}\s*-->\s*\d{2}:\d{2}:\d{2}[,.]\d{3}/
    );
    const timecode = timecodeMatch ? lines[1].trim() : "";
    const text = lines.slice(2).join("\n").trim();

    entries.push({ index, timecode, text });
  }

  return entries;
}

function formatChunk(entries: SrtEntry[]): string {
  return entries.map((e, i) => `${i + 1}\n${e.text}`).join("\n\n");
}

function parseTranslatedChunk(raw: string, count: number): string[] {
  const texts: string[] = [];
  const blocks = raw.trim().split(/\n\s*\n/).filter(Boolean);

  for (let i = 0; i < Math.min(blocks.length, count); i++) {
    const lines = blocks[i].split(/\r?\n/);
    const text =
      lines.length > 1
        ? lines.slice(1).join("\n").trim()
        : lines[0]?.trim() ?? "";
    texts.push(text);
  }

  return texts;
}

function entryToSrt(entry: SrtEntry, text: string): string {
  return `${entry.index}\n${entry.timecode}\n${text}\n`;
}

export async function runTranslationJob(jobId: string): Promise<void> {
  const job = jobs.get(jobId);
  if (!job?.subtitles) {
    setJobData(jobId, { done: true, progress: 100, error: "Job data missing" });
    return;
  }

  const subtitles = job.subtitles;
  const filmContext = job.filmContext;
  try {
    const entries = parseSrt(subtitles);
    if (entries.length === 0) {
      setJobData(jobId, { done: true, progress: 100, error: "No valid subtitle entries" });
      return;
    }

    const filmInfo = filmContext
      ? `Film Context
Title: ${filmContext.Title ?? ""}
Year: ${filmContext.Year ?? ""}
Genre: ${filmContext.Genre ?? ""}
Plot: ${filmContext.Plot ?? ""}

`
      : "";

    const systemPrompt = `You are a professional subtitle translator.

${filmInfo}Rules:
- Keep numbering unchanged
- Keep timestamps unchanged
- Only translate dialogue lines
- Output valid SRT format
- Do not add explanations`;

    const chunks: SrtEntry[][] = [];
    for (let i = 0; i < entries.length; i += CHUNK_SIZE) {
      chunks.push(entries.slice(i, i + CHUNK_SIZE));
    }

    const translatedTexts: string[] = [];
    const totalChunks = chunks.length;

    for (let i = 0; i < chunks.length; i++) {
      const chunk = chunks[i];
      const chunkText = formatChunk(chunk);

      const completion = await client.chat.completions.create({
        model: "openai/gpt-4o-mini",
        temperature: 0.7,
        messages: [
          { role: "system", content: systemPrompt },
          {
            role: "user",
            content: `Translate the following subtitles into Chinese and return valid SRT:

${chunkText}

Return only the translated subtitles.`,
          },
        ],
      });

      const raw = completion.choices[0]?.message?.content?.trim() ?? "";
      const parsed = parseTranslatedChunk(raw, chunk.length);
      for (let j = 0; j < chunk.length; j++) {
        translatedTexts.push(parsed[j] ?? chunk[j].text);
      }

      const progress = Math.round(((i + 1) / totalChunks) * 100);
      setJobData(jobId, { progress });
    }

    const translated = entries
      .map((entry, i) => entryToSrt(entry, translatedTexts[i] ?? entry.text))
      .join("\n");

    setJobData(jobId, { progress: 100, done: true, result: translated });
  } catch (error) {
    console.error("Translation job error:", error);
    setJobData(jobId, {
      progress: 100,
      done: true,
      error: error instanceof Error ? error.message : "Translation failed",
    });
  }
}

