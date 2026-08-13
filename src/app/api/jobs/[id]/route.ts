import { rm } from "fs/promises";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { jobs, segments } from "@/db/schema";
import { jobDir } from "@/lib/paths";
import { serializeJob } from "@/lib/serialize";

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

  const jobSegments = await db.select().from(segments).where(eq(segments.jobId, id));
  jobSegments.sort((a, b) => a.index - b.index);

  return Response.json({ job: serializeJob(job, jobSegments) });
}

export async function DELETE(_request: Request, context: RouteContext) {
  const { id } = await context.params;
  const [job] = await db.select().from(jobs).where(eq(jobs.id, id)).limit(1);
  if (!job) {
    return Response.json({ error: "Cut not found." }, { status: 404 });
  }

  await db.delete(jobs).where(eq(jobs.id, id));
  await rm(jobDir(id), { recursive: true, force: true });
  return Response.json({ ok: true });
}
