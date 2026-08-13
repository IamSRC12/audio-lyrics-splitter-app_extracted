import { execFile } from "child_process";
import { readdir, readFile, writeFile } from "fs/promises";
import path from "path";
import { promisify } from "util";
import ffmpegPath from "ffmpeg-static";
import JSZip from "jszip";
import { parseBuffer } from "music-metadata";
import { jobDir, sanitizeFilename, segmentsDir } from "@/lib/paths";
import type { AlignedSegment } from "@/lib/types";

const execFileAsync = promisify(execFile);

export type SplitFile = {
  index: number;
  filename: string;
  filepath: string;
  type: AlignedSegment["type"];
  text: string;
  duration: number;
  startTime: number;
  endTime: number;
};

export async function readAudioDuration(filePath: string) {
  const buffer = await readFile(filePath);
  const metadata = await parseBuffer(buffer, undefined, { duration: true });
  return metadata.format.duration ?? 0;
}

export async function splitAudio(jobId: string, audioPath: string, aligned: AlignedSegment[]) {
  if (!ffmpegPath) {
    throw new Error("ffmpeg binary is not available");
  }

  const outputDir = segmentsDir(jobId);
  const files: SplitFile[] = [];

  for (const segment of aligned) {
    const duration = Math.max(0.05, segment.end_time - segment.start_time);
    const safeText = sanitizeFilename(segment.text);
    const filename = `${String(segment.id).padStart(3, "0")}_${segment.type}_${safeText}.mp3`;
    const filepath = path.join(outputDir, filename);

    await execFileAsync(
      ffmpegPath,
      [
        "-y",
        "-ss",
        segment.start_time.toFixed(3),
        "-t",
        duration.toFixed(3),
        "-i",
        audioPath,
        "-acodec",
        "libmp3lame",
        "-ab",
        "192k",
        filepath,
      ],
      { timeout: 120000 },
    );

    files.push({
      index: segment.id,
      filename,
      filepath,
      type: segment.type,
      text: segment.text,
      duration,
      startTime: segment.start_time,
      endTime: segment.end_time,
    });
  }

  return files;
}

export async function createZipFromFiles(jobId: string, files: SplitFile[], zipName = "segments.zip") {
  const zip = new JSZip();
  for (const file of files) {
    zip.file(file.filename, await readFile(file.filepath));
  }
  const buffer = await zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE" });
  const zipPath = path.join(jobDir(jobId), zipName);
  await writeFile(zipPath, buffer);
  return zipPath;
}

export async function collectExistingSplits(jobId: string): Promise<SplitFile[]> {
  const outputDir = segmentsDir(jobId);
  try {
    const names = await readdir(outputDir);
    return names
      .filter((name) => name.endsWith(".mp3"))
      .sort()
      .map((filename, index) => ({
        index: index + 1,
        filename,
        filepath: path.join(outputDir, filename),
        type: filename.includes("_music_") ? "music" : "lyric",
        text: filename,
        duration: 0,
        startTime: 0,
        endTime: 0,
      }));
  } catch {
    return [];
  }
}
