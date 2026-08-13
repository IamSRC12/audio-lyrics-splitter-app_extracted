import { eq } from "drizzle-orm";
import { db } from "@/db";
import { jobs, segments } from "@/db/schema";
import { resolveGroqApiKey } from "@/lib/groq";
import { processJob } from "@/lib/process-job";
import { serializeJob } from "@/lib/serialize";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

type RouteContext = {
  params: Promise<{ id: string }>;
};

export async function POST(request: Request, context: RouteContext) {
  try {
    const { id } = await context.params;
    const [job] = await db.select().from(jobs).where(eq(jobs.id, id)).limit(1);
    if (!job) {
      return Response.json({ error: "Cut not found." }, { status: 404 });
    }

    const apiKey = resolveGroqApiKey(request);
    if (!apiKey) {
      return Response.json({ error: "A Groq API key is required." }, { status: 400 });
    }

    if (["transcribing", "aligning", "splitting"].includes(job.status)) {
      const jobSegments = await db.select().from(segments).where(eq(segments.jobId, id));
      return Response.json({ job: serializeJob(job, jobSegments) });
    }

    void processJob(id, apiKey);
    return Response.json({
      job: serializeJob({ ...job, status: "uploaded", error: null }),
    });
  } catch (error) {
    console.error("Failed to restart job:", error);
    return Response.json({ error: "Could not restart the cut." }, { status: 500 });
  }
}
