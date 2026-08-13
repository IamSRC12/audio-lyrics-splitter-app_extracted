import { desc } from "drizzle-orm";
import { StudioApp } from "@/components/studio-app";
import { db } from "@/db";
import { jobs } from "@/db/schema";
import { serializeJob } from "@/lib/serialize";

export const dynamic = "force-dynamic";

export default async function HomePage() {
  let initialJobs: ReturnType<typeof serializeJob>[] = [];

  try {
    const rows = await db.select().from(jobs).orderBy(desc(jobs.createdAt)).limit(24);
    initialJobs = rows.map((row) => serializeJob(row));
  } catch {
    initialJobs = [];
  }

  return (
    <StudioApp
      initialJobs={initialJobs}
      groqConfigured={Boolean(process.env.GROQ_API_KEY?.trim())}
    />
  );
}
