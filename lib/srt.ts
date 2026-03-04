export type SrtEntry = {
  index: number;
  timecode: string;
  text: string;
};

export function parseSrt(srt: string): SrtEntry[] {
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

export function entriesToSrt(entries: SrtEntry[]): string {
  return entries
    .map((e) => `${e.index}\n${e.timecode}\n${e.text}`)
    .join("\n\n");
}
