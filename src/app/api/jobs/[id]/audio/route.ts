import { createReadStream } from "fs";
import { stat } from "fs/promises";
import { Readable } from "stream";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { jobs } from "@/db/schema";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RouteContext = {
  params: Promise<{ id: string }>;
};

export async function GET(_request: Request, context: RouteContext) {
  const { id } = await context.params;
  const [job] = await db.select().from(jobs).where(eq(jobs.id, id)).limit(1);
  if (!job) {
    return Response.json({ error: "Cut not found." }, { status: 404 });
  }

  try {
    const info = await stat(job.filePath);
    const stream = createReadStream(job.filePath);
    return new Response(Readable.toWeb(stream) as ReadableStream, {
      headers: {
        "Content-Type": job.mimeType || "audio/mpeg",
        "Content-Length": String(info.size),
        "Content-Disposition": `inline; filename="${job.originalFilename}"`,
        "Cache-Control": "private, max-age=3600",
      },
    });
  } catch {
    return Response.json({ error: "Original audio is no longer on disk." }, { status: 404 });
  }
}
