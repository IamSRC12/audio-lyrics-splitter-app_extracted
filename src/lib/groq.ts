import { readFile } from "fs/promises";
import Groq, { toFile } from "groq-sdk";
import { alignLyricsHeuristic, cleanLyrics, formatTranscriptionForLlm, normalizeSegments } from "@/lib/lyrics";
import type { AlignedSegment, WhisperResult, WhisperSegment, WhisperWord } from "@/lib/types";

const CHAT_MODELS = ["llama-3.3-70b-versatile", "llama-3.1-8b-instant"];

type VerboseTranscription = {
  text?: string;
  duration?: number;
  words?: Array<{ word?: string; start?: number; end?: number }>;
  segments?: Array<{ id?: number; start?: number; end?: number; text?: string }>;
};

export function resolveGroqApiKey(request?: Request) {
  const headerKey = request?.headers.get("x-groq-api-key")?.trim();
  return headerKey || process.env.GROQ_API_KEY?.trim() || "";
}

export function createGroqClient(apiKey: string) {
  return new Groq({ apiKey });
}

export async function transcribeAudio(apiKey: string, filePath: string, filename: string): Promise<WhisperResult> {
  const client = createGroqClient(apiKey);
  const buffer = await readFile(filePath);
  const file = await toFile(buffer, filename);
  const result = (await client.audio.transcriptions.create({
    file,
    model: "whisper-large-v3",
    response_format: "verbose_json",
    timestamp_granularities: ["word", "segment"],
    temperature: 0,
  })) as VerboseTranscription;

  const words: WhisperWord[] = (result.words ?? [])
    .map((word) => ({
      word: (word.word ?? "").trim(),
      start: Number(word.start ?? 0),
      end: Number(word.end ?? 0),
    }))
    .filter((word) => word.word.length > 0 && Number.isFinite(word.start) && Number.isFinite(word.end));

  const segments: WhisperSegment[] = (result.segments ?? [])
    .map((segment) => ({
      id: segment.id,
      start: Number(segment.start ?? 0),
      end: Number(segment.end ?? 0),
      text: (segment.text ?? "").trim(),
    }))
    .filter((segment) => segment.text.length > 0);

  return {
    text: (result.text ?? "").trim(),
    words,
    segments,
    duration: typeof result.duration === "number" ? result.duration : undefined,
  };
}

export async function alignLyricsWithAudio(
  apiKey: string,
  lyrics: string,
  transcription: WhisperResult,
  duration: number,
) {
  const formatted = formatTranscriptionForLlm(transcription.segments, transcription.words);
  const cleanedLines = cleanLyrics(lyrics);

  try {
    const llmSegments = await alignWithLlm(apiKey, lyrics, formatted);
    return {
      source: "llm" as const,
      cleanedLyrics: cleanedLines.join("\n"),
      segments: normalizeSegments(llmSegments, duration),
    };
  } catch {
    return {
      source: "heuristic" as const,
      cleanedLyrics: cleanedLines.join("\n"),
      segments: alignLyricsHeuristic(lyrics, transcription.words, transcription.segments, duration),
    };
  }
}

async function alignWithLlm(apiKey: string, lyrics: string, whisperTranscription: string) {
  if (!whisperTranscription) {
    throw new Error("Empty transcription");
  }

  const client = createGroqClient(apiKey);
  const prompt = `You are an audio-lyrics alignment assistant. Analyze transcribed audio with timestamps and user-provided lyrics, then create precise audio segments.

## TASK
1. Remove metadata from lyrics such as [Intro], [Outro], [Verse 1], [Chorus], (x2) in ANY language.
2. Match each cleaned lyric line to the corresponding timestamp in the transcription.
3. Identify instrumental/music-only segments between lyric lines.
4. Create a segmentation map.

## RULES
- Strip ALL structural markers like [Intro], [Verse], [Chorus], (x2), etc. in any language
- Match lyrics SEMANTICALLY, not just exact word matching
- Ensure segments do not overlap
- Mark gaps between lyrics greater than 1 second as "music" segments
- Start and end times should be precise to 1 decimal place
- Segments must be in chronological order
- If there is an intro before the first lyric, mark it as music
- If there is an outro after the last lyric, mark it as music

## OUTPUT FORMAT (JSON ONLY)
{
  "segments": [
    {
      "id": 1,
      "start_time": 0.0,
      "end_time": 5.2,
      "type": "music",
      "text": "Instrumental"
    },
    {
      "id": 2,
      "start_time": 5.2,
      "end_time": 9.8,
      "type": "lyric",
      "text": "First line of the song"
    }
  ]
}

**User Lyrics:**
${lyrics}

**Whisper Transcription:**
${whisperTranscription}

Return ONLY valid JSON, no additional text.`;

  let lastError: unknown;
  for (const model of CHAT_MODELS) {
    try {
      const completion = await client.chat.completions.create({
        model,
        temperature: 0.1,
        response_format: { type: "json_object" },
        messages: [
          {
            role: "system",
            content: "You are a precise audio segmentation assistant. Always return valid JSON only.",
          },
          { role: "user", content: prompt },
        ],
      });

      const content = completion.choices[0]?.message?.content ?? "";
      return parseAlignedSegments(content);
    } catch (error) {
      lastError = error;
    }
  }

  throw lastError instanceof Error ? lastError : new Error("Lyric alignment failed");
}

function parseAlignedSegments(raw: string): AlignedSegment[] {
  const parsed = extractJson(raw) as { segments?: unknown };
  if (!Array.isArray(parsed.segments)) {
    throw new Error("Model did not return a segments array");
  }

  return parsed.segments.map((item, index) => {
    const record = (item ?? {}) as Record<string, unknown>;
    const type = record.type === "music" ? "music" : "lyric";
    return {
      id: Number(record.id) || index + 1,
      start_time: Number(record.start_time),
      end_time: Number(record.end_time),
      type,
      text: String(record.text ?? (type === "music" ? "Instrumental" : "")),
    };
  });
}

function extractJson(raw: string) {
  const trimmed = raw.trim();
  try {
    return JSON.parse(trimmed) as unknown;
  } catch {
    const match = trimmed.match(/\{[\s\S]*\}/);
    if (!match) throw new Error("Model returned invalid JSON");
    return JSON.parse(match[0]) as unknown;
  }
}
