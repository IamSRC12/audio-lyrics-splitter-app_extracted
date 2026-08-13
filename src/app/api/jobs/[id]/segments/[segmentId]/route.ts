import { createReadStream } from "fs";
import { stat } from "fs/promises";
import { Readable } from "stream";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { segments } from "@/db/schema";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RouteContext = {
  params: Promise<{ id: string; segmentId: string }>;
};

export async function GET(_request: Request, context: RouteContext) {
  const { id, segmentId } = await context.params;
  const [segment] = await db
    .select()
    .from(segments)
    .where(and(eq(segments.id, segmentId), eq(segments.jobId, id)))
    .limit(1);

  if (!segment?.filePath) {
    return Response.json({ error: "Segment file not found." }, { status: 404 });
  }

  try {
    const info = await stat(segment.filePath);
    const stream = createReadStream(segment.filePath);
    return new Response(Readable.toWeb(stream) as ReadableStream, {
      headers: {
        "Content-Type": "audio/mpeg",
        "Content-Length": String(info.size),
        "Content-Disposition": `attachment; filename="${segment.filename ?? "segment.mp3"}"`,
      },
    });
  } catch {
    return Response.json({ error: "Segment file is no longer on disk." }, { status: 404 });
  }
}
