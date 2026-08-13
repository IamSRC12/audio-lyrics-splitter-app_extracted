import type { JobStatus } from "@/lib/types";

export function formatClock(seconds: number | null | undefined) {
  const value = Math.max(0, Number(seconds) || 0);
  const minutes = Math.floor(value / 60);
  const rest = value - minutes * 60;
  return `${minutes}:${rest.toFixed(1).padStart(4, "0")}`;
}

export function formatBytes(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export const STATUS_COPY: Record<JobStatus, { label: string; detail: string }> = {
  uploaded: {
    label: "At the desk",
    detail: "The reel is queued. Whisper is about to listen.",
  },
  transcribing: {
    label: "Listening",
    detail: "Whisper is stamping every word with a timestamp.",
  },
  aligning: {
    label: "Scoring the sheet",
    detail: "The lyric map is being lined up to the vocal take.",
  },
  splitting: {
    label: "Cutting tape",
    detail: "Lyric lines and instrumental breaths are being sliced.",
  },
  completed: {
    label: "In the vault",
    detail: "Every clip is boxed and ready to download.",
  },
  failed: {
    label: "Take didn't land",
    detail: "Something snagged in the booth. You can run it again.",
  },
};

export const SAMPLE_LYRICS = `[Intro]
Hello world
This is a test

[Verse]
Line one here
Line two here

[Chorus]
We split the night into verses
And leave the quiet for the music`;
