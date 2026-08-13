import type { AlignedSegment, SegmentKind, WhisperSegment, WhisperWord } from "@/lib/types";

const METADATA_PATTERNS = [
  /\[.*?\]/g,
  /\([^)]*(?:repeat|x\d+|chorus|verse|intro|outro|bridge|hook|solo|instrumental)[^)]*\)/gi,
  /^\s*\d+[\.)]\s*/gm,
];

export function cleanLyrics(lyrics: string) {
  let cleaned = lyrics;
  for (const pattern of METADATA_PATTERNS) {
    cleaned = cleaned.replace(pattern, "");
  }

  return cleaned
    .split(/\r?\n/)
    .map((line) => line.replace(/\s+/g, " ").trim())
    .filter(Boolean);
}

export function formatTranscriptionForLlm(segments: WhisperSegment[], words: WhisperWord[]) {
  if (segments.length > 0) {
    return segments
      .map((segment) => {
        const start = Number(segment.start ?? 0);
        const end = Number(segment.end ?? 0);
        const text = (segment.text ?? "").trim();
        return `[${start.toFixed(1)}-${end.toFixed(1)}]: "${text}"`;
      })
      .join("\n");
  }

  if (words.length === 0) return "";

  const lines: string[] = [];
  let bucket: WhisperWord[] = [];

  for (const word of words) {
    bucket.push(word);
    const span = (bucket.at(-1)?.end ?? 0) - (bucket[0]?.start ?? 0);
    if (bucket.length >= 12 || span >= 6) {
      lines.push(formatWordBucket(bucket));
      bucket = [];
    }
  }

  if (bucket.length > 0) lines.push(formatWordBucket(bucket));
  return lines.join("\n");
}

function formatWordBucket(bucket: WhisperWord[]) {
  const start = bucket[0]?.start ?? 0;
  const end = bucket.at(-1)?.end ?? start;
  const text = bucket.map((word) => word.word).join("").replace(/\s+/g, " ").trim();
  return `[${start.toFixed(1)}-${end.toFixed(1)}]: "${text}"`;
}

export function normalizeSegments(raw: AlignedSegment[], duration: number) {
  const safeDuration = Number.isFinite(duration) && duration > 0 ? duration : inferDuration(raw);
  const prepared = raw
    .map((segment) => {
      const start = clamp(Number(segment.start_time), 0, safeDuration);
      const end = clamp(Number(segment.end_time), 0, safeDuration);
      const type: SegmentKind = segment.type === "music" ? "music" : "lyric";
      return {
        id: 0,
        start_time: Number(start.toFixed(2)),
        end_time: Number(end.toFixed(2)),
        type,
        text: (segment.text || (type === "music" ? "Instrumental" : "Untitled line")).trim(),
      } satisfies AlignedSegment;
    })
    .filter((segment) => segment.end_time - segment.start_time >= 0.05)
    .sort((a, b) => a.start_time - b.start_time);

  // Fix overlaps WITHOUT merging — keep both segments, just adjust the boundary
  const snapped: AlignedSegment[] = [];
  for (const segment of prepared) {
    const previous = snapped.at(-1);
    if (!previous) {
      snapped.push(segment);
      continue;
    }

    if (segment.start_time < previous.end_time) {
      const midpoint = Number(((previous.end_time + segment.start_time) / 2).toFixed(2));
      previous.end_time = midpoint;
      segment.start_time = midpoint;
    }

    // Keep the segment even if it is short — DO NOT drop/merge it
    if (segment.end_time > segment.start_time) {
      snapped.push(segment);
    }
  }

  const withGaps = fillMusicGaps(snapped, safeDuration);
  return withGaps.map((segment, index) => ({ ...segment, id: index + 1 }));
}

export function fillMusicGaps(segments: AlignedSegment[], duration: number) {
  const filled: AlignedSegment[] = [];
  let cursor = 0;
  const MIN_GAP = 0.05; // fill ANY gap >= 50ms so timeline is contiguous

  for (const segment of segments) {
    const gap = segment.start_time - cursor;

    if (gap >= MIN_GAP) {
      // Insert a music segment to fill the gap (keeps things contiguous)
      filled.push({
        id: 0,
        start_time: Number(cursor.toFixed(2)),
        end_time: Number(segment.start_time.toFixed(2)),
        type: "music",
        text: cursor === 0 ? "Intro" : "Instrumental",
      });
    } else if (gap > 0) {
      // Sub-50ms sliver — snap this segment's start to the cursor so there is no hole
      segment.start_time = Number(cursor.toFixed(2));
    }

    filled.push(segment);
    cursor = Math.max(cursor, segment.end_time);
  }

  // Trailing gap to the end of the audio
  const trailingGap = duration - cursor;
  if (trailingGap >= MIN_GAP) {
    filled.push({
      id: 0,
      start_time: Number(cursor.toFixed(2)),
      end_time: Number(duration.toFixed(2)),
      type: "music",
      text: "Outro",
    });
  } else if (trailingGap > 0 && filled.length > 0) {
    // Tiny tail — extend the last segment so the timeline reaches `duration`
    filled[filled.length - 1].end_time = Number(duration.toFixed(2));
  }

  return filled;
}

export function alignLyricsHeuristic(
  lyrics: string,
  words: WhisperWord[],
  whisperSegments: WhisperSegment[],
  duration: number,
) {
  const lines = cleanLyrics(lyrics);
  if (lines.length === 0) {
    throw new Error("No lyric lines remain after cleaning metadata tags.");
  }

  const sourceWords = words.length > 0 ? words : wordsFromSegments(whisperSegments);
  if (sourceWords.length === 0) {
    throw new Error("Transcription did not include usable timestamps.");
  }

  const lyricSegments: AlignedSegment[] = [];
  let wordIndex = 0;

  for (const line of lines) {
    const tokens = tokenize(line);
    if (tokens.length === 0) continue;

    const match = findBestWindow(sourceWords, tokens, wordIndex);
    const startWord = sourceWords[match.start];
    const endWord = sourceWords[match.end - 1];
    if (!startWord || !endWord) continue;

    lyricSegments.push({
      id: 0,
      start_time: startWord.start,
      end_time: Math.max(endWord.end, startWord.start + 0.2),
      type: "lyric",
      text: line,
    });
    wordIndex = match.end;
  }

  return normalizeSegments(lyricSegments, duration);
}

function wordsFromSegments(segments: WhisperSegment[]): WhisperWord[] {
  const words: WhisperWord[] = [];
  for (const segment of segments) {
    const pieces = (segment.text ?? "").trim().split(/\s+/).filter(Boolean);
    if (pieces.length === 0) continue;
    const span = Math.max(segment.end - segment.start, 0.2);
    const step = span / pieces.length;
    pieces.forEach((piece, index) => {
      words.push({
        word: piece,
        start: segment.start + step * index,
        end: segment.start + step * (index + 1),
      });
    });
  }
  return words;
}

function findBestWindow(words: WhisperWord[], tokens: string[], fromIndex: number) {
  let bestStart = fromIndex;
  let bestEnd = Math.min(words.length, fromIndex + Math.max(tokens.length, 1));
  let bestScore = -1;
  const searchLimit = Math.min(words.length, fromIndex + 90);

  for (let start = fromIndex; start < searchLimit; start += 1) {
    for (let length = Math.max(1, tokens.length - 2); length <= tokens.length + 4; length += 1) {
      const end = start + length;
      if (end > words.length) break;
      const windowTokens = words
        .slice(start, end)
        .flatMap((word) => tokenize(word.word))
        .filter(Boolean);
      const score = similarity(tokens, windowTokens) - (start - fromIndex) * 0.008;
      if (score > bestScore) {
        bestScore = score;
        bestStart = start;
        bestEnd = end;
      }
    }
  }

  if (bestScore < 0.18) {
    bestStart = fromIndex;
    bestEnd = Math.min(words.length, fromIndex + Math.max(tokens.length, 1));
  }

  return { start: bestStart, end: Math.max(bestStart + 1, bestEnd) };
}

function similarity(expected: string[], actual: string[]) {
  if (expected.length === 0 || actual.length === 0) return 0;
  const actualSet = new Set(actual);
  let hits = 0;
  for (const token of expected) {
    if (actualSet.has(token)) hits += 1;
  }

  let i = 0;
  let j = 0;
  let sequential = 0;
  while (i < expected.length && j < actual.length) {
    if (expected[i] === actual[j]) {
      sequential += 1;
      i += 1;
      j += 1;
    } else {
      j += 1;
    }
  }

  return (hits / expected.length) * 0.45 + (sequential / expected.length) * 0.55;
}

function tokenize(value: string) {
  return value
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9\s']/gi, " ")
    .split(/\s+/)
    .filter(Boolean);
}

function inferDuration(segments: AlignedSegment[]) {
  return segments.reduce((max, segment) => Math.max(max, Number(segment.end_time) || 0), 0);
}

function clamp(value: number, min: number, max: number) {
  if (!Number.isFinite(value)) return min;
  return Math.min(max, Math.max(min, value));
}
