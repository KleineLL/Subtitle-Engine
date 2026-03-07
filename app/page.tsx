"use client";

import { useState, useEffect } from "react";
import { parseSrt, entriesToSrt } from "@/lib/srt";

const CHUNK_SIZE = 35;

type FilmDetail = {
  Title: string;
  Year: string;
  imdbID: string;
  Plot?: string;
  Genre?: string;
  Director?: string;
  Actors?: string;
};

type CharacterInfo = { name: string; gender: string };

type ScriptSummary = {
  tone: string;
  dialogue_style: string;
  narrative_summary: string;
};

type PreparedContext = {
  setting?: string;
  themes?: string;
  cultural_context?: string;
  scriptSummary?: ScriptSummary;
  characters?: CharacterInfo[];
  [key: string]: unknown;
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
  const [srtText, setSrtText] = useState("");
  const [translatedSubtitles, setTranslatedSubtitles] = useState("");
  const [isTranslating, setIsTranslating] = useState(false);
  const [progress, setProgress] = useState(0);

  const [preparedContext, setPreparedContext] = useState<PreparedContext | null>(null);
  const [isPreparing, setIsPreparing] = useState(false);
  const [confirmedContext, setConfirmedContext] = useState<PreparedContext | null>(null);

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
    setPreparedContext(null);
    setConfirmedContext(null);
  };

  const handleSrtChange = (file: File | null) => {
    setSrtFile(file);
    setSrtText("");
    setPreparedContext(null);
    setConfirmedContext(null);
    if (file) {
      file.text().then((t) => setSrtText(t));
    }
  };

  const handlePrepareContext = async () => {
    if (!selectedFilm || !srtText) return;

    setIsPreparing(true);
    setPreparedContext(null);

    try {
      const res = await fetch("/api/prepare-context", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: selectedFilm.Title,
          year: selectedFilm.Year,
          subtitles: srtText,
        }),
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error ?? "Failed to prepare context");
      }

      const data = (await res.json()) as PreparedContext;
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
      setConfirmedContext(preparedContext);
    }
  };

  const handleUpdateReviewField = (
    field: keyof PreparedContext,
    value: string | ScriptSummary | CharacterInfo[]
  ) => {
    if (!preparedContext) return;
    setPreparedContext({ ...preparedContext, [field]: value });
  };

  const handleUpdateCharacter = (index: number, updates: Partial<CharacterInfo>) => {
    if (!preparedContext?.characters) return;
    const next = [...preparedContext.characters];
    next[index] = { ...next[index], ...updates };
    handleUpdateReviewField("characters", next);
  };

  const handleTranslate = async () => {
    if (!srtFile || !srtText || !confirmedContext) return;

    setIsTranslating(true);
    setProgress(5);

    try {
      const entries = parseSrt(srtText);
      if (entries.length === 0) {
        throw new Error("No valid subtitle entries");
      }

      const chunks: typeof entries[] = [];
      for (let i = 0; i < entries.length; i += CHUNK_SIZE) {
        chunks.push(entries.slice(i, i + CHUNK_SIZE));
      }

      const totalChunks = chunks.length;
      const translatedEntries: typeof entries = [];

      for (let i = 0; i < chunks.length; i++) {
        const chunk = chunks[i];
        const previousEntries = entries.slice(0, i * CHUNK_SIZE);
        const previousContextText = previousEntries
          .map((e) => e.text)
          .join("\n");

        const res = await fetch("/api/translate-chunk", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            chunk: chunk.map((e) => ({
              index: e.index,
              timecode: e.timecode,
              text: e.text,
            })),
            confirmedContext,
            previousContextText,
          }),
        });

        const data = await res.json();

        if (!res.ok) {
          throw new Error(data.error ?? "Translation failed");
        }

        const chunkTranslated = data.translated ?? [];
        translatedEntries.push(...chunkTranslated);

        setProgress(5 + Math.round(((i + 1) / totalChunks) * 85));
      }

      const finalSrt = entriesToSrt(translatedEntries);
      setTranslatedSubtitles(finalSrt);
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
    setSrtText("");
    setTranslatedSubtitles("");
    setProgress(0);
    setPreparedContext(null);
    setConfirmedContext(null);
  };

  return (
    <div className="min-h-screen bg-stone-50 px-4 py-12 font-sans text-stone-900">
      <main className="mx-auto max-w-xl">
        <h1 className="mb-10 text-center text-xl font-medium tracking-tight">
          Subtitle Translation
        </h1>

        {/* Phase 1: Film Identification */}
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

        {/* Phase 2: Subtitle Engine */}
        {phase === "phase2" && (
          <section className="mt-8 space-y-6">
            <div className="rounded-lg border border-stone-200 bg-white p-6 shadow-sm">
              <div className="mb-4 flex items-center justify-between">
                <h2 className="text-sm font-medium text-stone-500">
                  Phase 2 — Film Understanding
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
                  Translating for <strong>{selectedFilm.Title}</strong> (
                  {selectedFilm.Year})
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
                    onChange={(e) => handleSrtChange(e.target.files?.[0] ?? null)}
                    className="w-full rounded border border-stone-200 bg-white px-3 py-2 text-sm file:mr-3 file:rounded file:border-0 file:bg-stone-100 file:px-3 file:py-1 file:text-xs file:font-medium file:text-stone-700"
                  />
                </div>

                <button
                  type="button"
                  onClick={handlePrepareContext}
                  disabled={!srtText || isPreparing}
                  className="w-full rounded bg-stone-800 py-2.5 text-sm font-medium text-white transition-colors hover:bg-stone-700 disabled:cursor-not-allowed disabled:bg-stone-400"
                >
                  {isPreparing ? "Generating context…" : "Prepare Context"}
                </button>
              </div>
            </div>

            {/* Phase 3: Review Film Context */}
            {preparedContext && (
              <div className="rounded-lg border border-stone-200 bg-white p-6 shadow-sm">
                <h2 className="mb-4 text-sm font-medium text-stone-500">
                  Review Film Context
                </h2>

                <div className="space-y-4">
                  <div>
                    <label className="mb-1 block text-xs font-medium text-stone-600">
                      Setting
                    </label>
                    <textarea
                      value={preparedContext.setting ?? ""}
                      onChange={(e) =>
                        handleUpdateReviewField("setting", e.target.value)
                      }
                      rows={2}
                      className="w-full rounded border border-stone-200 bg-white px-3 py-2 text-sm outline-none transition-colors focus:border-stone-400 focus:ring-1 focus:ring-stone-300"
                    />
                  </div>

                  <div>
                    <label className="mb-1 block text-xs font-medium text-stone-600">
                      Themes
                    </label>
                    <textarea
                      value={preparedContext.themes ?? ""}
                      onChange={(e) =>
                        handleUpdateReviewField("themes", e.target.value)
                      }
                      rows={2}
                      className="w-full rounded border border-stone-200 bg-white px-3 py-2 text-sm outline-none transition-colors focus:border-stone-400 focus:ring-1 focus:ring-stone-300"
                    />
                  </div>

                  <div>
                    <label className="mb-1 block text-xs font-medium text-stone-600">
                      Cultural context
                    </label>
                    <textarea
                      value={preparedContext.cultural_context ?? ""}
                      onChange={(e) =>
                        handleUpdateReviewField("cultural_context", e.target.value)
                      }
                      rows={3}
                      className="w-full rounded border border-stone-200 bg-white px-3 py-2 text-sm outline-none transition-colors focus:border-stone-400 focus:ring-1 focus:ring-stone-300"
                    />
                  </div>

                  <div>
                    <label className="mb-1 block text-xs font-medium text-stone-600">
                      Script summary
                    </label>
                    <div className="space-y-2">
                      <div>
                        <span className="text-xs text-stone-500">Tone: </span>
                        <textarea
                          value={
                            preparedContext.scriptSummary?.tone ?? ""
                          }
                          onChange={(e) =>
                            handleUpdateReviewField("scriptSummary", {
                              ...(preparedContext.scriptSummary ?? {
                                tone: "",
                                dialogue_style: "",
                                narrative_summary: "",
                              }),
                              tone: e.target.value,
                            })
                          }
                          rows={1}
                          className="mt-1 w-full rounded border border-stone-200 bg-white px-3 py-2 text-sm outline-none transition-colors focus:border-stone-400 focus:ring-1 focus:ring-stone-300"
                        />
                      </div>
                      <div>
                        <span className="text-xs text-stone-500">
                          Dialogue style:{" "}
                        </span>
                        <textarea
                          value={
                            preparedContext.scriptSummary?.dialogue_style ?? ""
                          }
                          onChange={(e) =>
                            handleUpdateReviewField("scriptSummary", {
                              ...(preparedContext.scriptSummary ?? {
                                tone: "",
                                dialogue_style: "",
                                narrative_summary: "",
                              }),
                              dialogue_style: e.target.value,
                            })
                          }
                          rows={1}
                          className="mt-1 w-full rounded border border-stone-200 bg-white px-3 py-2 text-sm outline-none transition-colors focus:border-stone-400 focus:ring-1 focus:ring-stone-300"
                        />
                      </div>
                      <div>
                        <span className="text-xs text-stone-500">
                          Narrative summary:{" "}
                        </span>
                        <textarea
                          value={
                            preparedContext.scriptSummary?.narrative_summary ??
                            ""
                          }
                          onChange={(e) =>
                            handleUpdateReviewField("scriptSummary", {
                              ...(preparedContext.scriptSummary ?? {
                                tone: "",
                                dialogue_style: "",
                                narrative_summary: "",
                              }),
                              narrative_summary: e.target.value,
                            })
                          }
                          rows={2}
                          className="mt-1 w-full rounded border border-stone-200 bg-white px-3 py-2 text-sm outline-none transition-colors focus:border-stone-400 focus:ring-1 focus:ring-stone-300"
                        />
                      </div>
                    </div>
                  </div>

                  <div>
                    <label className="mb-2 block text-xs font-medium text-stone-600">
                      Characters
                    </label>
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="border-b border-stone-200 text-left text-xs text-stone-500">
                          <th className="pb-2 pr-4 font-medium">Name</th>
                          <th className="pb-2 font-medium">Gender</th>
                        </tr>
                      </thead>
                      <tbody>
                        {(preparedContext.characters ?? []).map((char, i) => (
                          <tr
                            key={i}
                            className="border-b border-stone-100 last:border-0"
                          >
                            <td className="py-2 pr-4">{char.name}</td>
                            <td className="py-2">
                              <select
                                value={char.gender}
                                onChange={(e) =>
                                  handleUpdateCharacter(i, {
                                    gender: e.target.value,
                                  })
                                }
                                className="rounded border border-stone-200 bg-white px-2 py-1 text-sm outline-none focus:border-stone-400"
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
                    {(preparedContext.characters ?? []).length === 0 && (
                      <p className="py-2 text-sm text-stone-400">
                        No characters identified
                      </p>
                    )}
                  </div>

                  <button
                    type="button"
                    onClick={handleConfirmContext}
                    className="w-full rounded bg-emerald-600 py-2.5 text-sm font-medium text-white transition-colors hover:bg-emerald-700"
                  >
                    Confirm Context
                  </button>
                </div>
              </div>
            )}

            {/* Phase 5: Translation */}
            {confirmedContext && (
              <div className="rounded-lg border border-stone-200 bg-white p-6 shadow-sm">
                <h2 className="mb-4 text-sm font-medium text-stone-500">
                  Translation
                </h2>

                <div className="space-y-4">
                  <div>
                    <label
                      htmlFor="philosophy"
                      className="mb-1 block text-xs font-medium text-stone-600"
                    >
                      Translation Philosophy (optional)
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
                        <option
                          key={philosophy.value}
                          value={philosophy.value}
                        >
                          {philosophy.label}
                        </option>
                      ))}
                    </select>
                  </div>

                  <button
                    type="button"
                    onClick={handleTranslate}
                    disabled={isTranslating}
                    className="w-full rounded bg-stone-900 py-2.5 text-sm font-medium text-white transition-colors hover:bg-stone-800 disabled:cursor-not-allowed disabled:bg-stone-400"
                  >
                    {isTranslating ? "Translating…" : "Translate"}
                  </button>

                  {(isTranslating || progress > 0) && (
                    <>
                      <div className="mt-4 h-3 w-full rounded-full bg-gray-200">
                        <div
                          className="h-3 rounded-full bg-blue-500 transition-all duration-300"
                          style={{ width: `${progress}%` }}
                        />
                      </div>
                      <p className="mt-2 text-sm text-gray-500">
                        Translating{" "}
                        {selectedFilm?.Title || filmTitle || "film"} subtitles…{" "}
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
              </div>
            )}
          </section>
        )}
      </main>
    </div>
  );
}
