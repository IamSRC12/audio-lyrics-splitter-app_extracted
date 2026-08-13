export function extensionOf(filename: string) {
  const ext = filename.split(".").pop()?.toLowerCase() ?? "mp3";
  return ext.replace(/[^a-z0-9]/g, "") || "mp3";
}

export function sanitizeFilename(text: string) {
  const cleaned = text
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, "")
    .replace(/\s+/g, "_")
    .replace(/_+/g, "_")
    .replace(/^\.+/, "")
    .slice(0, 36);
  return cleaned || "clip";
}

export function titleFromFilename(filename: string) {
  const base = filename.replace(/\.[^.]+$/, "").replace(/[_-]+/g, " ").trim();
  return base || "Untitled cut";
}
