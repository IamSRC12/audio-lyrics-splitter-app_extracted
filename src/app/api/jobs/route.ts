import { writeFile } from "fs/promises";
import path from "path";
import { desc, eq } from "drizzle-orm";
import { db } from "@/db";
import { jobs } from "@/db/schema";
import { resolveGroqApiKey } from "@/lib/groq";
import { ensureJobDirs, extensionOf, jobDir, titleFromFilename } from "@/lib/paths";
import { processJob } from "@/lib/process-job";
import { serializeJob } from "@/lib/serialize";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

const MAX_BYTES = 50 * 1024 * 1024;
const ALLOWED_EXTENSIONS = new Set(["mp3", "wav", "ogg", "m4a", "flac", "webm", "mp4", "mpeg"]);

export async function GET() {
  try {
    const rows = await db.select().from(jobs).orderBy(desc(jobs.createdAt)).limit(30);
    return Response.json({ jobs: rows.map((row) => serializeJob(row)) });
  } catch {
    return Response.json({ jobs: [] });
  }
}

export async function POST(request: Request) {
  try {
    const formData = await request.formData();
    const audio = formData.get("audio");
    const lyricsValue = formData.get("lyrics");
    const titleValue = formData.get("title");

    if (!(audio instanceof File)) {
      return Response.json({ error: "Upload an audio file to begin." }, { status: 400 });
    }

    const lyrics = typeof lyricsValue === "string" ? lyricsValue.trim() : "";
    if (!lyrics) {
      return Response.json({ error: "Paste the song lyrics before cutting." }, { status: 400 });
    }

    if (audio.size > MAX_BYTES) {
      return Response.json({ error: "Audio must be 50MB or smaller." }, { status: 400 });
    }

    const extension = extensionOf(audio.name);
    if (!ALLOWED_EXTENSIONS.has(extension)) {
      return Response.json({ error: "Use MP3, WAV, OGG, M4A, FLAC or WEBM." }, { status: 400 });
    }

    const apiKey = resolveGroqApiKey(request);
    const title =
      (typeof titleValue === "string" && titleValue.trim()) || titleFromFilename(audio.name);

    const [created] = await db
      .insert(jobs)
      .values({
        title,
        originalFilename: audio.name,
        mimeType: audio.type || `audio/${extension}`,
        filePath: "pending",
        lyrics,
        status: apiKey ? "uploaded" : "failed",
        error: apiKey ? null : "Add a Groq API key to transcribe and align this track.",
      })
      .returning();

    if (!created) {
      return Response.json({ error: "Could not create the job." }, { status: 500 });
    }

    await ensureJobDirs(created.id);
    const filePath = path.join(jobDir(created.id), `original.${extension}`);
    await writeFile(filePath, Buffer.from(await audio.arrayBuffer()));

    const [saved] = await db
      .update(jobs)
      .set({ filePath, updatedAt: new Date() })
      .where(eq(jobs.id, created.id))
      .returning();

    const job = saved ?? { ...created, filePath };

    if (apiKey) {
      void processJob(job.id, apiKey);
    }

    return Response.json({ job: serializeJob(job) }, { status: 201 });
  } catch (error) {
    console.error("Job creation failed:", error);
    const message = error instanceof Error ? error.message : "Upload failed.";
    return Response.json({ error: message }, { status: 500 });
  }
}
