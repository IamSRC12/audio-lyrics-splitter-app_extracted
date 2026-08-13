import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { jobs, segments } from "@/db/schema";
import { createZipFromFiles, readAudioDuration, splitAudio } from "@/lib/audio";
import { alignLyricsWithAudio, transcribeAudio } from "@/lib/groq";

export async function processJob(jobId: string, apiKey: string) {
  const existing = await db.select().from(jobs).where(eq(jobs.id, jobId)).limit(1);
  const job = existing[0];
  if (!job) {
    throw new Error("Job not found");
  }

  try {
    await updateJob(jobId, { status: "transcribing", error: null });
    const transcription = await transcribeAudio(apiKey, job.filePath, job.originalFilename);
    const measuredDuration = await readAudioDuration(job.filePath).catch(() => 0);
    const duration =
      transcription.duration && transcription.duration > 0
        ? transcription.duration
        : measuredDuration;

    await updateJob(jobId, {
      transcription: transcription.text,
      transcriptionJson: transcription as unknown as Record<string, unknown>,
      durationSeconds: duration || null,
      status: "aligning",
    });

    const alignment = await alignLyricsWithAudio(apiKey, job.lyrics, transcription, duration);

    await db.delete(segments).where(eq(segments.jobId, jobId));
    if (alignment.segments.length > 0) {
      await db.insert(segments).values(
        alignment.segments.map((segment) => ({
          jobId,
          index: segment.id,
          startTime: segment.start_time,
          endTime: segment.end_time,
          type: segment.type,
          text: segment.text,
          duration: segment.end_time - segment.start_time,
        })),
      );
    }

    await updateJob(jobId, {
      cleanedLyrics: alignment.cleanedLyrics,
      alignmentSource: alignment.source,
      segmentsCount: alignment.segments.length,
      status: "splitting",
    });

    try {
      const files = await splitAudio(jobId, job.filePath, alignment.segments);
      const zipPath = await createZipFromFiles(jobId, files, `${safeZipName(job.title)}.zip`);

      for (const file of files) {
        await db
          .update(segments)
          .set({
            filename: file.filename,
            filePath: file.filepath,
            duration: file.duration,
          })
          .where(and(eq(segments.jobId, jobId), eq(segments.index, file.index)));
      }

      await updateJob(jobId, {
        status: "completed",
        zipPath,
        segmentsCount: files.length,
        error: null,
      });
    } catch (splitError) {
      const message = splitError instanceof Error ? splitError.message : "Audio splitting failed";
      await updateJob(jobId, {
        status: "completed",
        error: `Timeline ready. Server slice failed (${message}). Use the browser WAV pack.`,
      });
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : "Processing failed";
    await updateJob(jobId, { status: "failed", error: message });
  }
}

async function updateJob(jobId: string, values: Partial<typeof jobs.$inferInsert>) {
  await db
    .update(jobs)
    .set({ ...values, updatedAt: new Date() })
    .where(eq(jobs.id, jobId));
}

function safeZipName(title: string) {
  return title.replace(/[<>:"/\\|?*]+/g, "").replace(/\s+/g, "_").slice(0, 40) || "segments";
}
