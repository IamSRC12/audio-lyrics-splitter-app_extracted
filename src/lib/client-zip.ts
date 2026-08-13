import JSZip from "jszip";
import { sanitizeFilename } from "@/lib/filenames";
import type { SerializedSegment } from "@/lib/types";

export async function downloadBrowserZip(
  source: File | ArrayBuffer,
  segments: SerializedSegment[],
  title: string,
) {
  const context = new AudioContext();
  try {
    const bytes = source instanceof File ? await source.arrayBuffer() : source;
    const audio = await context.decodeAudioData(bytes.slice(0));
    const zip = new JSZip();

    for (const segment of segments) {
      const wav = encodeWavSlice(audio, segment.startTime, segment.endTime);
      const filename = `${String(segment.index).padStart(3, "0")}_${segment.type}_${sanitizeFilename(segment.text)}.wav`;
      zip.file(filename, wav);
    }

    const blob = await zip.generateAsync({ type: "blob", compression: "DEFLATE" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `${title.replace(/[^\w.-]+/g, "_") || "cutline"}_segments.zip`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
  } finally {
    await context.close();
  }
}

function encodeWavSlice(buffer: AudioBuffer, start: number, end: number) {
  const sampleRate = buffer.sampleRate;
  const startSample = Math.max(0, Math.floor(start * sampleRate));
  const endSample = Math.min(buffer.length, Math.floor(end * sampleRate));
  const frameCount = Math.max(1, endSample - startSample);
  const channels = buffer.numberOfChannels;
  const bytesPerSample = 2;
  const blockAlign = channels * bytesPerSample;
  const dataSize = frameCount * blockAlign;
  const output = new ArrayBuffer(44 + dataSize);
  const view = new DataView(output);

  writeString(view, 0, "RIFF");
  view.setUint32(4, 36 + dataSize, true);
  writeString(view, 8, "WAVE");
  writeString(view, 12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, channels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * blockAlign, true);
  view.setUint16(32, blockAlign, true);
  view.setUint16(34, 16, true);
  writeString(view, 36, "data");
  view.setUint32(40, dataSize, true);

  let offset = 44;
  for (let i = 0; i < frameCount; i += 1) {
    for (let channel = 0; channel < channels; channel += 1) {
      const sample = buffer.getChannelData(channel)[startSample + i] ?? 0;
      const clipped = Math.max(-1, Math.min(1, sample));
      view.setInt16(offset, clipped < 0 ? clipped * 0x8000 : clipped * 0x7fff, true);
      offset += 2;
    }
  }

  return output;
}

function writeString(view: DataView, offset: number, value: string) {
  for (let i = 0; i < value.length; i += 1) {
    view.setUint8(offset + i, value.charCodeAt(i));
  }
}
