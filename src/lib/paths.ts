import { mkdir } from "fs/promises";
import path from "path";

export const DATA_ROOT = path.join(process.cwd(), "data");
export const JOBS_ROOT = path.join(DATA_ROOT, "jobs");

export function jobDir(jobId: string) {
  return path.join(JOBS_ROOT, jobId);
}

export function segmentsDir(jobId: string) {
  return path.join(jobDir(jobId), "segments");
}

export async function ensureJobDirs(jobId: string) {
  await mkdir(segmentsDir(jobId), { recursive: true });
}

export { extensionOf, sanitizeFilename, titleFromFilename } from "@/lib/filenames";
