import type { JobRow, SegmentRow } from "@/db/schema";
import type { JobStatus, SegmentKind, SerializedJob, SerializedSegment } from "@/lib/types";

export function serializeSegment(segment: SegmentRow): SerializedSegment {
  return {
    id: segment.id,
    jobId: segment.jobId,
    index: segment.index,
    startTime: segment.startTime,
    endTime: segment.endTime,
    type: segment.type as SegmentKind,
    text: segment.text,
    filename: segment.filename,
    filePath: segment.filePath,
    duration: segment.duration,
    createdAt: segment.createdAt.toISOString(),
  };
}

export function serializeJob(job: JobRow, jobSegments?: SegmentRow[]): SerializedJob {
  return {
    id: job.id,
    title: job.title,
    originalFilename: job.originalFilename,
    mimeType: job.mimeType,
    lyrics: job.lyrics,
    cleanedLyrics: job.cleanedLyrics,
    transcription: job.transcription,
    status: job.status as JobStatus,
    error: job.error,
    zipPath: job.zipPath,
    durationSeconds: job.durationSeconds,
    segmentsCount: job.segmentsCount,
    alignmentSource: job.alignmentSource,
    createdAt: job.createdAt.toISOString(),
    updatedAt: job.updatedAt.toISOString(),
    segments: jobSegments?.map(serializeSegment),
  };
}
