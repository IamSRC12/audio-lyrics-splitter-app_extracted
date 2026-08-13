import { readFile } from "fs/promises";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { jobs, segments } from "@/db/schema";
import { collectExistingSplits, createZipFromFiles, splitAudio } from "@/lib/audio";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

type RouteContext = {
  params: Promise<{ id: string }>;
};

export async function GET(_request: Request, context: RouteContext) {
  const { id } = await context.params;
  const [job] = await db.select().from(jobs).where(eq(jobs.id, id)).limit(1);
  if (!job) {
    return Response.json({ error: "Cut not found." }, { status: 404 });
  }

  let zipPath = job.zipPath;
  if (!zipPath) {
    const existing = await collectExistingSplits(id);
    if (existing.length > 0) {
      zipPath = await createZipFromFiles(id, existing, "segments.zip");
    } else {
      const jobSegments = await db.select().from(segments).where(eq(segments.jobId, id));
      if (jobSegments.length === 0) {
        return Response.json({ error: "This cut has no downloadable segments yet." }, { status: 404 });
      }
      const files = await splitAudio(
        id,
        job.filePath,
        jobSegments
          .sort((a, b) => a.index - b.index)
          .map((segment) => ({
            id: segment.index,
            start_time: segment.startTime,
            end_time: segment.endTime,
            type: segment.type === "music" ? "music" : "lyric",
            text: segment.text,
          })),
      );
      zipPath = await createZipFromFiles(id, files, "segments.zip");
    }

    await db.update(jobs).set({ zipPath, updatedAt: new Date() }).where(eq(jobs.id, id));
  }

  const buffer = await readFile(zipPath);
  const filename = `${job.title.replace(/[^\w.-]+/g, "_") || "cutline"}_segments.zip`;

  return new Response(buffer, {
    headers: {
      "Content-Type": "application/zip",
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Content-Length": String(buffer.byteLength),
    },
  });
}
