"use client";

import { useState, useEffect } from "react";

type FilmDetail = {
  Title: string;
  Year: string;
  imdbID: string;
  Plot?: string;
  Genre?: string;
  Director?: string;
  Actors?: string;
};

type ReviewContext = {
  setting?: string;
  themes?: string;
  cultural_context?: string;
  scriptSummary?: string;
  characters?: { name: string; gender: string }[];
  [key: string]: unknown;
};

export default function Home() {
  const [phase, setPhase] = useState<"phase1" | "phase2">("phase1");
  const [filmTitle, setFilmTitle] = useState("");
  const [year, setYear] = useState("");
  const [imdbId, setImdbId] = useState("");
  const [searchResults, setSearchResults] = useState<FilmDetail[] | null>(null);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [isSearching, setIsSearching] = useState(false);
  const [selectedFilm, setSelectedFilm] = useState<FilmDetail | null>(null);
  const [srtFile, setSrtFile] = useState<File | null>(null);
  const [translatedSubtitles, setTranslatedSubtitles] = useState("");
  const [isTranslating, setIsTranslating] = useState(false);
  const [progress, setProgress] = useState(0);
  const [preparedContext, setPreparedContext] = useState<ReviewContext | null>(null);
  const [confirmedContext, setConfirmedContext] = useState<ReviewContext | null>(null);
  const [isPreparing, setIsPreparing] = useState(false);

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

  const handlePrepareContext = async () => {
    if (!srtFile || !selectedFilm) return;

    setIsPreparing(true);
    setPreparedContext(null);

    try {
      const text = await srtFile.text();
      const res = await fetch("/api/prepare-context", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: selectedFilm.Title,
          year: selectedFilm.Year,
          subtitles: text,
        }),
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error ?? "Failed to prepare context");
      }

      const data = (await res.json()) as ReviewContext;
      setPreparedContext(data);
    } catch (err) {
      console.error(err);
      alert(err instanceof Error ? err.message : "Failed to prepare context.");
    } finally {
      setIsPreparing(false);
    }
  };

  const handleConfirmContext = () => {
    if (preparedContext) {
      setConfirmedContext({ ...preparedContext });
    }
  };

  const handleTranslate = async () => {
    if (!srtFile || !confirmedContext) return;

    setIsTranslating(true);
    setProgress(5);

    try {
      const text = await srtFile.text();

      const res = await fetch("/api/translate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          subtitles: text,
          filmContext: confirmedContext,
        }),
      });

      const data = await res.json();

      if (!res.ok) {
        throw new Error(data.error ?? "Translation failed");
      }

      setTranslatedSubtitles(data.translated ?? "");
    } catch (err) {
      console.error(err);
      alert(err instanceof Error ? err.message : "Translation failed.");
    } finally {
      setProgress(100);
      setIsTranslating(false);
    }
  };

  useEffect(() => {
    if (!isTranslating) return;

    const interval = setInterval(() => {
      setProgress((prev) => {
        if (prev >= 90) return prev;
        return prev + Math.random() * 5;
      });
    }, 700);

    return () => clearInterval(interval);
  }, [isTranslating]);

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
    setProgress(0);
    setPreparedContext(null);
    setConfirmedContext(null);
  };

  const updatePreparedField = (
    field: string,
    value: string | { name: string; gender: string }[]
  ) => {
    if (!preparedContext) return;
    setPreparedContext((prev) => (prev ? { ...prev, [field]: value } : null));
  };

  const updateCharacterGender = (index: number, gender: string) => {
    if (!preparedContext?.characters) return;
    const next = [...preparedContext.characters];
    next[index] = { ...next[index], gender };
    setPreparedContext((prev) => (prev ? { ...prev, characters: next } : null));
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

            <div className="space-y-4">
              <div>
                <label className="mb-1 block text-xs font-medium text-stone-600">
                  Subtitle file (.srt)
                </label>
                <input
                  type="file"
                  accept=".srt"
                  onChange={(e) => {
                    setSrtFile(e.target.files?.[0] ?? null);
                    setPreparedContext(null);
                    setConfirmedContext(null);
                  }}
                  className="w-full rounded border border-stone-200 bg-white px-3 py-2 text-sm file:mr-3 file:rounded file:border-0 file:bg-stone-100 file:px-3 file:py-1 file:text-xs file:font-medium file:text-stone-700"
                />
              </div>

              <button
                type="button"
                onClick={handlePrepareContext}
                disabled={!srtFile || !selectedFilm || isPreparing}
                className="w-full rounded border border-stone-300 bg-white py-2.5 text-sm font-medium text-stone-700 transition-colors hover:bg-stone-50 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {isPreparing ? "Generating context…" : "Generate Film Context"}
              </button>

              {preparedContext && (
                <div className="rounded-lg border border-stone-200 bg-stone-50 p-4">
                  <h3 className="mb-3 text-sm font-medium text-stone-700">
                    Review Film Context
                  </h3>
                  <p className="mb-4 text-xs text-stone-500">
                    Edit the context below, then confirm to use it for translation.
                  </p>

                  <div className="space-y-3">
                    <div>
                      <label className="mb-1 block text-xs font-medium text-stone-600">
                        Setting
                      </label>
                      <textarea
                        value={preparedContext.setting ?? ""}
                        onChange={(e) => updatePreparedField("setting", e.target.value)}
                        rows={2}
                        className="w-full rounded border border-stone-200 bg-white px-3 py-2 text-sm outline-none focus:border-stone-400"
                      />
                    </div>
                    <div>
                      <label className="mb-1 block text-xs font-medium text-stone-600">
                        Themes
                      </label>
                      <textarea
                        value={preparedContext.themes ?? ""}
                        onChange={(e) => updatePreparedField("themes", e.target.value)}
                        rows={2}
                        className="w-full rounded border border-stone-200 bg-white px-3 py-2 text-sm outline-none focus:border-stone-400"
                      />
                    </div>
                    <div>
                      <label className="mb-1 block text-xs font-medium text-stone-600">
                        Cultural context
                      </label>
                      <textarea
                        value={
                          preparedContext.cultural_context ??
                          ([
                            preparedContext.subculture_context,
                            preparedContext.slang_style,
                            preparedContext.historical_background,
                            preparedContext.audience_perception,
                          ]
                            .filter(Boolean)
                            .join("\n\n") || "")
                        }
                        onChange={(e) =>
                          updatePreparedField("cultural_context", e.target.value)
                        }
                        rows={4}
                        className="w-full rounded border border-stone-200 bg-white px-3 py-2 text-sm outline-none focus:border-stone-400"
                      />
                    </div>
                    <div>
                      <label className="mb-1 block text-xs font-medium text-stone-600">
                        Script summary
                      </label>
                      <textarea
                        value={preparedContext.scriptSummary ?? ""}
                        onChange={(e) =>
                          updatePreparedField("scriptSummary", e.target.value)
                        }
                        rows={4}
                        className="w-full rounded border border-stone-200 bg-white px-3 py-2 text-sm outline-none focus:border-stone-400"
                      />
                    </div>
                    <div>
                      <label className="mb-2 block text-xs font-medium text-stone-600">
                        Characters
                      </label>
                      <table className="w-full border-collapse rounded border border-stone-200 bg-white text-sm">
                        <thead>
                          <tr className="border-b border-stone-200 bg-stone-100">
                            <th className="px-3 py-2 text-left text-xs font-medium text-stone-600">
                              Name
                            </th>
                            <th className="px-3 py-2 text-left text-xs font-medium text-stone-600">
                              Gender
                            </th>
                          </tr>
                        </thead>
                        <tbody>
                          {(preparedContext.characters ?? []).map((char, idx) => (
                            <tr
                              key={idx}
                              className="border-b border-stone-100 last:border-0"
                            >
                              <td className="px-3 py-2">{char.name}</td>
                              <td className="px-3 py-2">
                                <select
                                  value={char.gender}
                                  onChange={(e) =>
                                    updateCharacterGender(idx, e.target.value)
                                  }
                                  className="rounded border border-stone-200 bg-white px-2 py-1 text-xs outline-none focus:border-stone-400"
                                >
                                  <option value="male">male</option>
                                  <option value="female">female</option>
                                  <option value="unknown">unknown</option>
                                </select>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                      {(!preparedContext.characters ||
                        preparedContext.characters.length === 0) && (
                        <p className="mt-2 text-xs text-stone-400">
                          No characters identified.
                        </p>
                      )}
                    </div>
                  </div>

                  <button
                    type="button"
                    onClick={handleConfirmContext}
                    className="mt-4 w-full rounded bg-stone-900 py-2.5 text-sm font-medium text-white transition-colors hover:bg-stone-800"
                  >
                    Confirm Context
                  </button>
                </div>
              )}

              {confirmedContext && (
                <p className="text-xs text-emerald-600">
                  ✓ Context confirmed. You can now translate.
                </p>
              )}

              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  handleTranslate();
                }}
              >
                <button
                  type="submit"
                  disabled={!srtFile || !confirmedContext || isTranslating}
                  className="w-full rounded bg-stone-900 py-2.5 text-sm font-medium text-white transition-colors hover:bg-stone-800 disabled:cursor-not-allowed disabled:bg-stone-400"
                >
                  {isTranslating ? "Translating…" : "Translate"}
                </button>
              </form>

            {(isTranslating || progress > 0) && (
                <>
                  <div className="mt-4 w-full rounded-full bg-gray-200 h-3">
                    <div
                      className="h-3 rounded-full bg-blue-500 transition-all duration-300"
                      style={{ width: `${progress}%` }}
                    />
                  </div>
                  <p className="mt-2 text-sm text-gray-500">
                    🎬 Translating {selectedFilm?.Title || filmTitle || "film"} subtitles…{" "}
                    {Math.round(progress)}%
                  </p>
                </>
              )}
            </div>

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
