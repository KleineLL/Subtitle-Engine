"use client";

import { useState } from "react";

const CHUNK_SIZE = 80;
const CONTEXT_LINES = 3;

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

function formatEntriesForContext(entries: SrtEntry[]): string {
  return entries.map((e) => `${e.index}\n${e.text}`).join("\n\n");
}

function formatChunkForTranslation(entries: SrtEntry[]): string {
  return entries.map((e, i) => `${i + 1}\n${e.text}`).join("\n\n");
}

function parseTranslatedChunk(raw: string, count: number): string[] {
  const texts: string[] = [];
  const blocks = raw.trim().split(/\n\s*\n/).filter(Boolean);

  for (let i = 0; i < Math.min(blocks.length, count); i++) {
    const lines = blocks[i].split(/\r?\n/);
    const text =
      lines.length > 1 ? lines.slice(1).join("\n").trim() : lines[0]?.trim() ?? "";
    texts.push(text);
  }

  return texts;
}

function entryToSrt(entry: SrtEntry, text: string): string {
  return `${entry.index}\n${entry.timecode}\n${text}\n`;
}

type FilmDetail = {
  Title: string;
  Year: string;
  imdbID: string;
  Plot?: string;
  Genre?: string;
  Director?: string;
  Actors?: string;
};

const TRANSLATION_PHILOSOPHIES = [
  { value: "adaptive", label: "Context-aware adaptive (recommended)" },
  { value: "fidelity", label: "Strict semantic fidelity" },
  { value: "expressive", label: "Expressive performance mode" },
] as const;

export default function Home() {
  const [phase, setPhase] = useState<"phase1" | "phase2">("phase1");
  const [filmTitle, setFilmTitle] = useState("");
  const [year, setYear] = useState("");
  const [imdbId, setImdbId] = useState("");
  const [searchResults, setSearchResults] = useState<FilmDetail[] | null>(null);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [isSearching, setIsSearching] = useState(false);
  const [selectedFilm, setSelectedFilm] = useState<FilmDetail | null>(null);
  const [translationPhilosophy, setTranslationPhilosophy] = useState<
    (typeof TRANSLATION_PHILOSOPHIES)[number]["value"]
  >(TRANSLATION_PHILOSOPHIES[0].value);
  const [srtFile, setSrtFile] = useState<File | null>(null);
  const [translatedSubtitles, setTranslatedSubtitles] = useState("");
  const [isTranslating, setIsTranslating] = useState(false);
  const [translationProgress, setTranslationProgress] = useState<{
    current: number;
    total: number;
  } | null>(null);

  const handleSearch = async () => {
    if (!filmTitle.trim() && !imdbId.trim()) return;
    setSearchError(null);
    setSearchResults(null);
    setIsSearching(true);

    const res = await fetch("/api/search-film", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        title: filmTitle || undefined,
        year: year || undefined,
        imdbID: imdbId || undefined,
      }),
    });

    const data = await res.json();

    if (!res.ok) {
      setSearchError(data.error ?? "Search failed");
      setIsSearching(false);
      return;
    }

    if (data.imdbID) {
      setSearchResults([data]);
    } else {
      setSearchError("No results found");
    }
    setIsSearching(false);
  };

  const handleConfirmFilm = (film: FilmDetail) => {
    setSelectedFilm(film);
    setPhase("phase2");
  };

  const handleTranslate = async () => {
    if (!srtFile) return;

    const apiKey = process.env.NEXT_PUBLIC_OPENROUTER_API_KEY;
    if (!apiKey) {
      alert("OpenRouter API key is not configured. Add NEXT_PUBLIC_OPENROUTER_API_KEY to your environment.");
      return;
    }

    setIsTranslating(true);
    setTranslationProgress(null);

    try {
      const text = await srtFile.text();
      const entries = parseSrt(text);

      if (entries.length === 0) {
        alert("No valid subtitle entries found.");
        return;
      }

      const filmInfo = selectedFilm
        ? `Film Context
Title: ${selectedFilm.Title ?? ""}
Year: ${selectedFilm.Year ?? ""}
Genre: ${selectedFilm.Genre ?? ""}
Plot: ${selectedFilm.Plot ?? ""}

`
        : "";

      const systemPrompt = `You are a professional film subtitle translator.

${filmInfo}Translation Philosophy
- Preserve character voice
- Maintain cinematic dialogue flow
- Adapt slang naturally
- Avoid literal translation

You may receive previous subtitle lines as context. Use them only for understanding dialogue flow—do not translate them. Translate only the current chunk.

Output rules:
- Keep the same line numbers and order as the input.
- Do not merge or split subtitles: one input subtitle must produce exactly one output subtitle.
- Each block: number on line 1, then translated text, blank lines between blocks.
- Do not add or modify timecodes.`;

      const translatedTexts: string[] = [];
      const totalChunks = Math.ceil(entries.length / CHUNK_SIZE);

      for (let i = 0; i < entries.length; i += CHUNK_SIZE) {
        setTranslationProgress({
          current: Math.floor(i / CHUNK_SIZE) + 1,
          total: totalChunks,
        });

        const chunk = entries.slice(i, i + CHUNK_SIZE);
        const previousEntries = entries.slice(Math.max(0, i - CONTEXT_LINES), i);
        const previousContext =
          previousEntries.length > 0
            ? `Previous Context (do not translate):\n${formatEntriesForContext(previousEntries)}\n\n`
            : "";
        const chunkInput = formatChunkForTranslation(chunk);
        const userContent = `${previousContext}Translate these subtitles:\n${chunkInput}`;

        const res = await fetch("https://openrouter.ai/api/v1/chat/completions", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${apiKey}`,
            "HTTP-Referer": "https://subtitle-engine.vercel.app",
            "X-Title": "Subtitle Engine",
          },
          body: JSON.stringify({
            model: "openai/gpt-4o-mini",
            temperature: 0.7,
            messages: [
              { role: "system", content: systemPrompt },
              { role: "user", content: userContent },
            ],
          }),
        });

        if (!res.ok) {
          const err = await res.json().catch(() => ({}));
          throw new Error(err.error?.message ?? "Translation failed");
        }

        const data = await res.json();
        const raw = data.choices?.[0]?.message?.content?.trim() ?? "";
        const parsed = parseTranslatedChunk(raw, chunk.length);

        for (let j = 0; j < chunk.length; j++) {
          translatedTexts.push(parsed[j] ?? chunk[j].text);
        }
      }

      const translated = entries
        .map((entry, i) => entryToSrt(entry, translatedTexts[i] ?? entry.text))
        .join("\n");

      setTranslatedSubtitles(translated);
    } catch (err) {
      console.error(err);
      alert(err instanceof Error ? err.message : "Translation failed.");
    } finally {
      setIsTranslating(false);
      setTranslationProgress(null);
    }
  };

  const handleDownload = () => {
    const blob = new Blob([translatedSubtitles], { type: "text/plain" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `translated_${selectedFilm?.Title.replace(/\s+/g, "_") ?? "subtitles"}.srt`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleReset = () => {
    setPhase("phase1");
    setSelectedFilm(null);
    setSearchResults(null);
    setSearchError(null);
    setFilmTitle("");
    setYear("");
    setImdbId("");
    setSrtFile(null);
    setTranslatedSubtitles("");
    setTranslationProgress(null);
  };

  return (
    <div className="min-h-screen bg-stone-50 px-4 py-12 font-sans text-stone-900">
      <main className="mx-auto max-w-xl">
        <h1 className="mb-10 text-center text-xl font-medium tracking-tight">
          Subtitle Translation
        </h1>

        {/* Phase 1: Film Identification (hidden when Phase 2 active) */}
        {phase === "phase1" && (
        <section className="rounded-lg border border-stone-200 bg-white p-6 shadow-sm">
          <div className="mb-4 flex items-center justify-between">
            <h2 className="text-sm font-medium text-stone-500">
              Phase 1 — Film Identification
            </h2>
            {selectedFilm && (
              <span className="rounded bg-emerald-100 px-2 py-0.5 text-xs font-medium text-emerald-700">
                Confirmed
              </span>
            )}
          </div>

          <div className="space-y-4">
            <div>
              <label htmlFor="title" className="mb-1 block text-xs font-medium text-stone-600">
                Film Title
              </label>
              <input
                id="title"
                type="text"
                value={filmTitle}
                onChange={(e) => setFilmTitle(e.target.value)}
                placeholder="e.g. The Shawshank Redemption"
                className="w-full rounded border border-stone-200 bg-white px-3 py-2 text-sm outline-none transition-colors focus:border-stone-400 focus:ring-1 focus:ring-stone-300"
              />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label htmlFor="year" className="mb-1 block text-xs font-medium text-stone-600">
                  Year
                </label>
                <input
                  id="year"
                  type="text"
                  value={year}
                  onChange={(e) => setYear(e.target.value)}
                  placeholder="e.g. 1994"
                  className="w-full rounded border border-stone-200 bg-white px-3 py-2 text-sm outline-none transition-colors focus:border-stone-400 focus:ring-1 focus:ring-stone-300"
                />
              </div>
              <div>
                <label htmlFor="imdb" className="mb-1 block text-xs font-medium text-stone-600">
                  IMDB ID
                </label>
                <input
                  id="imdb"
                  type="text"
                  value={imdbId}
                  onChange={(e) => setImdbId(e.target.value)}
                  placeholder="e.g. tt0111161"
                  className="w-full rounded border border-stone-200 bg-white px-3 py-2 text-sm outline-none transition-colors focus:border-stone-400 focus:ring-1 focus:ring-stone-300"
                />
              </div>
            </div>
            <button
              type="button"
              onClick={() => handleSearch()}
              disabled={isSearching || (!filmTitle.trim() && !imdbId.trim())}
              className="w-full rounded bg-stone-900 py-2.5 text-sm font-medium text-white transition-colors hover:bg-stone-800 disabled:cursor-not-allowed disabled:bg-stone-400"
            >
              {isSearching ? "Searching…" : "Search Film"}
            </button>
          </div>

          {searchError && (
            <p className="mt-4 text-sm text-rose-600">{searchError}</p>
          )}

          {searchResults && searchResults.length > 0 && (
            <div className="mt-6 space-y-2">
              <p className="text-xs font-medium text-stone-500">Results</p>
              <ul className="divide-y divide-stone-100">
                {searchResults.map((film) => (
                  <li
                    key={film.imdbID}
                    className="flex items-center justify-between gap-3 py-3"
                  >
                    <div>
                      <p className="text-sm font-medium">{film.Title}</p>
                      <p className="text-xs text-stone-500">
                        {film.Year} · {film.imdbID}
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={() => handleConfirmFilm(film)}
                      className="shrink-0 rounded border border-stone-300 bg-white px-3 py-1.5 text-xs font-medium text-stone-700 transition-colors hover:bg-stone-50"
                    >
                      Confirm
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </section>
        )}

        {/* Phase 2: Subtitle Engine (shown after film confirmed) */}
        {phase === "phase2" && (
          <section className="mt-8 rounded-lg border border-stone-200 bg-white p-6 shadow-sm">
            <div className="mb-4 flex items-center justify-between">
              <h2 className="text-sm font-medium text-stone-500">
                Phase 2 — Subtitle Engine
              </h2>
              <button
                type="button"
                onClick={handleReset}
                className="text-xs text-stone-400 hover:text-stone-600"
              >
                Change film
              </button>
            </div>

            {selectedFilm && (
              <p className="mb-6 text-sm text-stone-600">
                Translating for <strong>{selectedFilm.Title}</strong> ({selectedFilm.Year})
              </p>
            )}

            <form
              onSubmit={(e) => {
                e.preventDefault();
                handleTranslate();
              }}
              className="space-y-4"
            >
              <div>
                <label className="mb-1 block text-xs font-medium text-stone-600">
                  Subtitle file (.srt)
                </label>
                <input
                  type="file"
                  accept=".srt"
                  onChange={(e) => setSrtFile(e.target.files?.[0] ?? null)}
                  className="w-full rounded border border-stone-200 bg-white px-3 py-2 text-sm file:mr-3 file:rounded file:border-0 file:bg-stone-100 file:px-3 file:py-1 file:text-xs file:font-medium file:text-stone-700"
                />
              </div>

              <div>
                <label htmlFor="philosophy" className="mb-1 block text-xs font-medium text-stone-600">
                  Translation Philosophy (optional advanced)
                </label>
                <select
                  id="philosophy"
                  value={translationPhilosophy}
                  onChange={(e) =>
                    setTranslationPhilosophy(
                      e.target.value as (typeof TRANSLATION_PHILOSOPHIES)[number]["value"]
                    )
                  }
                  className="w-full rounded border border-stone-200 bg-white px-3 py-2 text-sm outline-none transition-colors focus:border-stone-400 focus:ring-1 focus:ring-stone-300"
                >
                  {TRANSLATION_PHILOSOPHIES.map((philosophy) => (
                    <option key={philosophy.value} value={philosophy.value}>
                      {philosophy.label}
                    </option>
                  ))}
                </select>
                <p className="mt-2 text-sm text-stone-500">
                  Philosophy shapes translation choices dynamically instead of forcing a uniform
                  stylistic filter.
                </p>
              </div>

              <button
                type="submit"
                disabled={!srtFile || isTranslating}
                className="w-full rounded bg-stone-900 py-2.5 text-sm font-medium text-white transition-colors hover:bg-stone-800 disabled:cursor-not-allowed disabled:bg-stone-400"
              >
                {isTranslating
                  ? translationProgress
                    ? `Translating chunk ${translationProgress.current} of ${translationProgress.total}…`
                    : "Translating…"
                  : "Translate"}
              </button>
              {isTranslating && translationProgress && (
                <p className="text-center text-sm text-stone-500">
                  Processing chunk {translationProgress.current} of {translationProgress.total}…
                </p>
              )}
            </form>

            <div className="mt-6">
              <div className="mb-2 flex items-center justify-between">
                <label className="text-xs font-medium text-stone-600">
                  Translated subtitles
                </label>
                {translatedSubtitles && (
                  <button
                    type="button"
                    onClick={handleDownload}
                    className="rounded border border-stone-300 bg-white px-3 py-1.5 text-xs font-medium text-stone-700 transition-colors hover:bg-stone-50"
                  >
                    Download .srt
                  </button>
                )}
              </div>
              <textarea
                readOnly
                value={translatedSubtitles}
                placeholder="Translated subtitles will appear here..."
                rows={10}
                className="w-full rounded border border-stone-200 bg-stone-50 p-3 font-mono text-sm text-stone-700 outline-none placeholder:text-stone-400"
              />
            </div>
          </section>
        )}
      </main>
    </div>
  );
}
