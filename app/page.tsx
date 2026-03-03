"use client";

import { useState } from "react";

type FilmResult = {
  id: string;
  title: string;
  year: string;
  imdbId: string;
};

const TRANSLATION_STYLES = [
  { value: "cultural", label: "Cultural immersive" },
  { value: "literal", label: "Literal study mode" },
  { value: "comedic", label: "Comedic rhythm enhanced" },
] as const;

export default function Home() {
  const [phase, setPhase] = useState<"phase1" | "phase2">("phase1");
  const [filmTitle, setFilmTitle] = useState("");
  const [year, setYear] = useState("");
  const [imdbId, setImdbId] = useState("");
  const [searchResults, setSearchResults] = useState<FilmResult[] | null>(null);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [isSearching, setIsSearching] = useState(false);
  const [selectedFilm, setSelectedFilm] = useState<FilmResult | null>(null);
  const [translationStyle, setTranslationStyle] = useState(TRANSLATION_STYLES[0].value);
  const [srtFile, setSrtFile] = useState<File | null>(null);
  const [translatedSubtitles, setTranslatedSubtitles] = useState("");
  const [isTranslating, setIsTranslating] = useState(false);

  const toFilmResult = (item: { imdbID: string; Title: string; Year: string }): FilmResult => ({
    id: item.imdbID,
    title: item.Title,
    year: item.Year,
    imdbId: item.imdbID,
  });

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
      setSearchResults([toFilmResult(data)]);
    } else if (data.Search?.length) {
      setSearchResults(data.Search.map(toFilmResult));
    } else {
      setSearchError("No results found");
    }
    setIsSearching(false);
  };

  const handleConfirmFilm = (film: FilmResult) => {
    setSelectedFilm(film);
    setPhase("phase2");
  };

  const handleTranslate = async () => {
    if (!srtFile) return;

    setIsTranslating(true);

    try {
      const text = await srtFile.text();

      const res = await fetch("/api/translate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ subtitles: text }),
      });

      if (!res.ok) {
        throw new Error("Translation failed");
      }

      const data = await res.json();
      setTranslatedSubtitles(data.translated);
    } catch (err) {
      console.error(err);
      alert("Translation failed.");
    } finally {
      setIsTranslating(false);
    }
  };

  const handleDownload = () => {
    const blob = new Blob([translatedSubtitles], { type: "text/plain" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `translated_${selectedFilm?.title.replace(/\s+/g, "_") ?? "subtitles"}.srt`;
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
                    key={film.id}
                    className="flex items-center justify-between gap-3 py-3"
                  >
                    <div>
                      <p className="text-sm font-medium">{film.title}</p>
                      <p className="text-xs text-stone-500">
                        {film.year} · {film.imdbId}
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
                Translating for <strong>{selectedFilm.title}</strong> ({selectedFilm.year})
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
                <label htmlFor="style" className="mb-1 block text-xs font-medium text-stone-600">
                  Translation style
                </label>
                <select
                  id="style"
                  value={translationStyle}
                  onChange={(e) =>
                    setTranslationStyle(e.target.value as (typeof TRANSLATION_STYLES)[number]["value"])
                  }
                  className="w-full rounded border border-stone-200 bg-white px-3 py-2 text-sm outline-none transition-colors focus:border-stone-400 focus:ring-1 focus:ring-stone-300"
                >
                  {TRANSLATION_STYLES.map((style) => (
                    <option key={style.value} value={style.value}>
                      {style.label}
                    </option>
                  ))}
                </select>
              </div>

              <button
                type="submit"
                disabled={!srtFile || isTranslating}
                className="w-full rounded bg-stone-900 py-2.5 text-sm font-medium text-white transition-colors hover:bg-stone-800 disabled:cursor-not-allowed disabled:bg-stone-400"
              >
                {isTranslating ? "Translating…" : "Translate"}
              </button>
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
