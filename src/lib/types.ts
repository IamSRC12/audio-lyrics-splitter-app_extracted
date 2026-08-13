export type JobStatus =
  | "uploaded"
  | "transcribing"
  | "aligning"
  | "splitting"
  | "completed"
  | "failed";

export type SegmentKind = "lyric" | "music";

export type WhisperWord = {
  word: string;
  start: number;
  end: number;
};

export type WhisperSegment = {
  id?: number;
  start: number;
  end: number;
  text: string;
};

export type WhisperResult = {
  text: string;
  words: WhisperWord[];
  segments: WhisperSegment[];
  duration?: number;
};

export type AlignedSegment = {
  id: number;
  start_time: number;
  end_time: number;
  type: SegmentKind;
  text: string;
};

export type SerializedSegment = {
  id: string;
  jobId: string;
  index: number;
  startTime: number;
  endTime: number;
  type: SegmentKind;
  text: string;
  filename: string | null;
  filePath: string | null;
  duration: number | null;
  createdAt: string;
};

export type SerializedJob = {
  id: string;
  title: string;
  originalFilename: string;
  mimeType: string;
  lyrics: string;
  cleanedLyrics: string | null;
  transcription: string | null;
  status: JobStatus;
  error: string | null;
  zipPath: string | null;
  durationSeconds: number | null;
  segmentsCount: number;
  alignmentSource: string | null;
  createdAt: string;
  updatedAt: string;
  segments?: SerializedSegment[];
};
