"use client";

import Image from "next/image";
import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { downloadBrowserZip } from "@/lib/client-zip";
import { formatBytes, formatClock, SAMPLE_LYRICS, STATUS_COPY } from "@/lib/format";
import type { JobStatus, SerializedJob, SerializedSegment } from "@/lib/types";

type StudioAppProps = {
  initialJobs: SerializedJob[];
  groqConfigured: boolean;
};

const ACCEPT = ".mp3,.wav,.ogg,.m4a,.flac,.webm,.mp4";
const ACTIVE_STATUSES: JobStatus[] = ["uploaded", "transcribing", "aligning", "splitting"];

async function safeJson<T>(response: Response): Promise<T> {
  const text = await response.text();
  if (!text) return {} as T;
  try {
    return JSON.parse(text) as T;
  } catch {
    return {} as T;
  }
}

export function StudioApp({ initialJobs, groqConfigured }: StudioAppProps) {
  const [jobs, setJobs] = useState(initialJobs);
  const [activeJob, setActiveJob] = useState<SerializedJob | null>(null);
  const [lyrics, setLyrics] = useState("");
  const [title, setTitle] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [peaks, setPeaks] = useState<number[]>([]);
  const [localDuration, setLocalDuration] = useState(0);
  const [dragOver, setDragOver] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [apiKey, setApiKey] = useState("");
  const [showKey, setShowKey] = useState(false);
  const [keySaved, setKeySaved] = useState(false);
  const [libraryOpen, setLibraryOpen] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [playingId, setPlayingId] = useState<string | null>(null);
  const [zipping, setZipping] = useState(false);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const objectUrlRef = useRef<string | null>(null);
  const playRangeRef = useRef<{ end: number; id: string } | null>(null);

  useEffect(() => {
    const stored = window.localStorage.getItem("cutline-groq-key");
    if (stored) setApiKey(stored);
  }, []);

  useEffect(() => {
    window.localStorage.setItem("cutline-groq-key", apiKey);
  }, [apiKey]);

  useEffect(() => {
    return () => {
      if (objectUrlRef.current) URL.revokeObjectURL(objectUrlRef.current);
    };
  }, []);

  const activeId = activeJob?.id;
  const activeStatus = activeJob?.status;

  useEffect(() => {
    if (!activeId || !activeStatus || !ACTIVE_STATUSES.includes(activeStatus)) return;

    const timer = window.setInterval(async () => {
      const response = await fetch(`/api/jobs/${activeId}`, { cache: "no-store" });
      if (!response.ok) return;
      const payload = await safeJson<{ job?: SerializedJob }>(response);
      if (payload.job) {
        setActiveJob(payload.job);
        setJobs((current) => current.map((job) => (job.id === payload.job!.id ? payload.job! : job)));
      }
    }, 1400);

    return () => window.clearInterval(timer);
  }, [activeId, activeStatus]);

  const audioSrc = useMemo(() => {
    if (file && objectUrlRef.current) return objectUrlRef.current;
    if (activeJob) return `/api/jobs/${activeJob.id}/audio`;
    return "";
  }, [file, activeJob]);

  const segments = activeJob?.segments ?? [];
  const duration = activeJob?.durationSeconds || localDuration;
  const processing = Boolean(activeJob && ACTIVE_STATUSES.includes(activeJob.status));

  const onFile = useCallback(async (next: File | null) => {
    setFile(next);
    setError(null);
    if (objectUrlRef.current) {
      URL.revokeObjectURL(objectUrlRef.current);
      objectUrlRef.current = null;
    }
    if (!next) {
      setPeaks([]);
      setLocalDuration(0);
      return;
    }
    objectUrlRef.current = URL.createObjectURL(next);
    setTitle(next.name.replace(/\.[^.]+$/, "").replace(/[_-]+/g, " "));
    try {
      const measured = await computePeaks(next);
      setPeaks(measured.peaks);
      setLocalDuration(measured.duration);
    } catch {
      setPeaks([]);
    }
  }, []);

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    if (!file) {
      setError("Drop a song onto the desk first.");
      return;
    }
    if (!lyrics.trim()) {
      setError("The lyric sheet is empty.");
      return;
    }

    setBusy(true);
    setError(null);

    const body = new FormData();
    body.append("audio", file);
    body.append("lyrics", lyrics);
    if (title.trim()) body.append("title", title.trim());

    try {
      const response = await fetch("/api/jobs", {
        method: "POST",
        body,
        headers: apiKey.trim() ? { "x-groq-api-key": apiKey.trim() } : undefined,
      });
      const payload = await safeJson<{ job?: SerializedJob; error?: string }>(response);
      if (!response.ok || !payload.job) {
        throw new Error(payload.error || "The booth could not take the reel.");
      }
      setActiveJob(payload.job);
      setJobs((current) => [payload.job!, ...current.filter((job) => job.id !== payload.job!.id)]);
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : "Upload failed.");
    } finally {
      setBusy(false);
    }
  }

  async function loadJob(id: string) {
    const response = await fetch(`/api/jobs/${id}`, { cache: "no-store" });
    if (!response.ok) return;
    const payload = await safeJson<{ job?: SerializedJob }>(response);
    if (payload.job) {
      setActiveJob(payload.job);
      setLyrics(payload.job.lyrics);
      setTitle(payload.job.title);
      setLibraryOpen(false);
    }
  }

  async function retryJob() {
    if (!activeJob) return;
    const response = await fetch(`/api/jobs/${activeJob.id}/process`, {
      method: "POST",
      headers: apiKey.trim() ? { "x-groq-api-key": apiKey.trim() } : undefined,
    });
    const payload = await safeJson<{ job?: SerializedJob; error?: string }>(response);
    if (!response.ok || !payload.job) {
      setError(payload.error || "Could not restart the cut.");
      return;
    }
    setActiveJob({ ...payload.job, status: "uploaded" });
  }

  async function deleteJob(id: string) {
    await fetch(`/api/jobs/${id}`, { method: "DELETE" });
    setJobs((current) => current.filter((job) => job.id !== id));
    if (activeJob?.id === id) {
      setActiveJob(null);
    }
  }

  function playSegment(segment: SerializedSegment) {
    const audio = audioRef.current;
    if (!audio) return;
    playRangeRef.current = { end: segment.endTime, id: segment.id };
    audio.currentTime = Math.max(0, segment.startTime);
    void audio.play();
    setPlayingId(segment.id);
  }

  function toggleMaster() {
    const audio = audioRef.current;
    if (!audio) return;
    playRangeRef.current = null;
    if (audio.paused) {
      void audio.play();
      setPlayingId("master");
    } else {
      audio.pause();
      setPlayingId(null);
    }
  }

  async function handleBrowserZip() {
    if (!activeJob || segments.length === 0) return;
    setZipping(true);
    setError(null);
    try {
      if (file) {
        await downloadBrowserZip(file, segments, activeJob.title);
      } else {
        const response = await fetch(`/api/jobs/${activeJob.id}/audio`);
        if (!response.ok) throw new Error("Could not load the original reel.");
        const buffer = await response.arrayBuffer();
        await downloadBrowserZip(buffer, segments, activeJob.title);
      }
    } catch (zipError) {
      setError(zipError instanceof Error ? zipError.message : "Browser zip failed.");
    } finally {
      setZipping(false);
    }
  }

  return (
    <div className="relative min-h-screen overflow-x-hidden bg-ink text-paper">
      <div className="grain" />
      <header className="relative z-20 flex items-center justify-between gap-4 border-b border-line px-5 py-4 md:px-8">
        <div className="flex items-center gap-3">
          <Image
            src="/images/cutline-mark.png"
            alt="Cutline mark"
            width={44}
            height={44}
            className="size-11 rounded-full border border-copper/40 object-cover"
          />
          <div>
            <p className="font-display text-xl tracking-[0.22em] text-gold">CUTLINE</p>
            <p className="text-[11px] uppercase tracking-[0.22em] text-paper-dim">Analog lyric lathe</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setHelpOpen(true)}
            className="rounded-full border border-line px-4 py-2 text-[11px] uppercase tracking-[0.18em] text-paper-dim transition hover:border-copper hover:text-gold"
          >
            Method
          </button>
          <button
            type="button"
            onClick={() => setLibraryOpen(true)}
            className="rounded-full bg-copper px-4 py-2 text-[11px] uppercase tracking-[0.18em] text-ink transition hover:bg-copper-2"
          >
            Vault {jobs.length > 0 ? `· ${jobs.length}` : ""}
          </button>
        </div>
      </header>

      <section className="hero-wash relative mx-5 mt-5 overflow-hidden rounded-[28px] border border-line md:mx-8">
        <div className="grid gap-8 px-6 py-10 md:grid-cols-[1.2fr_0.8fr] md:px-10 md:py-14">
          <div>
            <p className="text-xs uppercase tracking-[0.28em] text-gold">Studio floor</p>
            <h1 className="mt-3 max-w-xl font-display text-4xl leading-[0.95] text-paper md:text-6xl">
              Split a song into verses and the silence between them.
            </h1>
            <p className="mt-5 max-w-lg text-sm leading-6 text-paper-dim md:text-base">
              Drop an MP3 and the lyric sheet. Whisper timestamps the vocal, an LLM lines each line
              to the tape, then Cutline slices lyric clips and instrumental breaths into a ZIP.
            </p>
          </div>
          <div className="flex flex-col justify-end gap-4">
            <div className="rounded-3xl border border-line bg-ink/55 p-5 backdrop-blur-sm">
              <div className="flex items-center justify-between text-[11px] uppercase tracking-[0.18em] text-paper-dim">
                <span>Booth key</span>
                <span className={groqConfigured || apiKey ? "text-moss" : "text-rose"}>
                  {groqConfigured ? "Env live" : apiKey ? "Session key" : "Needed"}
                </span>
              </div>
              <button
                type="button"
                onClick={() => setShowKey((value) => !value)}
                className="mt-3 text-left text-sm text-gold underline-offset-4 hover:underline"
              >
                {showKey ? "Hide Groq key field" : "Add or override Groq API key"}
              </button>
              {showKey ? (
                <div className="mt-3 flex items-center gap-2">
                  <input
                    type="password"
                    value={apiKey}
                    onChange={(event) => {
                      setApiKey(event.target.value);
                      setKeySaved(false);
                    }}
                    placeholder="gsk_..."
                    className="w-full flex-1 rounded-2xl border border-line bg-ink-2 px-4 py-3 text-sm text-paper outline-none ring-copper/40 focus:ring-2"
                  />
                  <button
                    type="button"
                    onClick={() => {
                      window.localStorage.setItem("cutline-groq-key", apiKey.trim());
                      setKeySaved(true);
                      setTimeout(() => setKeySaved(false), 2000);
                    }}
                    className={`shrink-0 rounded-2xl px-4 py-3 text-xs font-semibold uppercase tracking-[0.15em] transition active:scale-95 ${
                      keySaved
                        ? "bg-moss text-ink border border-moss"
                        : "bg-copper text-ink hover:bg-copper-2"
                    }`}
                  >
                    {keySaved ? "Saved ✓" : "Save"}
                  </button>
                </div>
              ) : null}
            </div>
          </div>
        </div>
      </section>

      <main className="relative z-10 mx-auto grid max-w-[1400px] gap-6 px-5 py-6 md:px-8 lg:grid-cols-[1.05fr_0.95fr]">
        <form
          onSubmit={handleSubmit}
          className="rounded-[28px] border border-line bg-ink-2/90 p-5 shadow-[0_30px_80px_rgba(0,0,0,0.35)] md:p-7"
        >
          <div className="flex items-end justify-between gap-4">
            <div>
              <p className="text-[11px] uppercase tracking-[0.22em] text-copper-2">01 · Source</p>
              <h2 className="mt-1 font-display text-3xl">The reel</h2>
            </div>
            <input
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              placeholder="Working title"
              className="w-40 rounded-full border border-line bg-transparent px-4 py-2 text-xs uppercase tracking-[0.16em] outline-none focus:border-copper"
            />
          </div>

          <label
            onDragOver={(event) => {
              event.preventDefault();
              setDragOver(true);
            }}
            onDragLeave={() => setDragOver(false)}
            onDrop={(event) => {
              event.preventDefault();
              setDragOver(false);
              const next = event.dataTransfer.files[0];
              if (next) void onFile(next);
            }}
            className={`mt-6 block cursor-pointer rounded-[24px] border border-dashed p-5 transition ${
              dragOver ? "border-copper bg-copper/10" : "border-line bg-ink"
            }`}
          >
            <input
              type="file"
              accept={ACCEPT}
              className="hidden"
              onChange={(event) => void onFile(event.target.files?.[0] ?? null)}
            />
            <div className="flex flex-col gap-4 md:flex-row md:items-center">
              <Image
                src="/images/vinyl.jpg"
                alt="Vinyl close-up"
                width={120}
                height={80}
                className="h-20 w-28 rounded-2xl object-cover"
              />
              <div className="flex-1">
                <p className="font-display text-2xl">
                  {file ? file.name : "Drop the master take"}
                </p>
                <p className="mt-1 text-sm text-paper-dim">
                  {file
                    ? `${formatBytes(file.size)} · ${formatClock(localDuration)}`
                    : "MP3, WAV, OGG, M4A · up to 50MB"}
                </p>
              </div>
            </div>
            <Waveform
              peaks={peaks}
              duration={duration}
              currentTime={currentTime}
              segments={segments}
              onSeek={(time) => {
                if (audioRef.current) audioRef.current.currentTime = time;
              }}
            />
          </label>

          <div className="mt-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-[11px] uppercase tracking-[0.22em] text-copper-2">02 · Sheet</p>
                <h2 className="mt-1 font-display text-3xl">Lyrics</h2>
              </div>
              <button
                type="button"
                onClick={() => setLyrics(SAMPLE_LYRICS)}
                className="text-[11px] uppercase tracking-[0.16em] text-gold hover:underline"
              >
                Load sample
              </button>
            </div>
            <div className="lyric-sheet mt-4 overflow-hidden rounded-[24px] border border-line">
              <textarea
                value={lyrics}
                onChange={(event) => setLyrics(event.target.value)}
                rows={12}
                placeholder="Paste the full lyric sheet. Tags like [Intro] and [Chorus] are stripped automatically."
                className="min-h-[280px] w-full resize-y bg-ink/70 px-5 py-5 font-display text-lg leading-8 text-paper outline-none placeholder:text-paper-dim/70"
              />
            </div>
          </div>

          {error ? (
            <p className="mt-4 rounded-2xl border border-rose/40 bg-rose/10 px-4 py-3 text-sm text-paper">
              {error}
            </p>
          ) : null}

          <button
            type="submit"
            disabled={busy || processing}
            className="mt-6 w-full rounded-full bg-copper py-4 text-sm uppercase tracking-[0.24em] text-ink transition hover:bg-copper-2 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {busy ? "Handing the reel over…" : processing ? "The lathe is already spinning" : "Cut the record"}
          </button>
        </form>

        <section className="rounded-[28px] border border-line bg-ink-2/90 p-5 md:p-7">
          <div className="flex items-start justify-between gap-4">
            <div>
              <p className="text-[11px] uppercase tracking-[0.22em] text-copper-2">03 · Cut</p>
              <h2 className="mt-1 font-display text-3xl">{activeJob?.title ?? "Waiting for a take"}</h2>
              <p className="mt-2 max-w-md text-sm text-paper-dim">
                {activeJob
                  ? STATUS_COPY[activeJob.status].detail
                  : "Upload a track and the lyric sheet. The timeline will appear here."}
              </p>
            </div>
            {activeJob ? (
              <span className="rounded-full border border-gold/30 px-3 py-1 text-[11px] uppercase tracking-[0.16em] text-gold">
                {STATUS_COPY[activeJob.status].label}
              </span>
            ) : null}
          </div>

          <ProcessRail status={activeJob?.status ?? null} />

          {audioSrc ? (
            <div className="mt-6 rounded-[22px] border border-line bg-ink p-4">
              <div className="flex items-center justify-between gap-3">
                <button
                  type="button"
                  onClick={toggleMaster}
                  className="rounded-full border border-copper px-4 py-2 text-[11px] uppercase tracking-[0.16em] text-gold"
                >
                  {playingId === "master" ? "Pause master" : "Play master"}
                </button>
                <p className="text-xs text-paper-dim">{formatClock(currentTime)} / {formatClock(duration)}</p>
              </div>
              <audio
                ref={audioRef}
                src={audioSrc}
                className="mt-3 w-full"
                controls
                onTimeUpdate={(event) => {
                  const time = event.currentTarget.currentTime;
                  setCurrentTime(time);
                  const range = playRangeRef.current;
                  if (range && time >= range.end) {
                    event.currentTarget.pause();
                    playRangeRef.current = null;
                    setPlayingId(null);
                  }
                }}
                onPause={() => {
                  if (!playRangeRef.current) setPlayingId(null);
                }}
              />
            </div>
          ) : null}

          {activeJob?.error ? (
            <div className="mt-5 rounded-2xl border border-rose/40 bg-rose/10 p-4">
              <p className="text-sm">{activeJob.error}</p>
              {activeJob.status === "failed" ? (
                <button
                  type="button"
                  onClick={() => void retryJob()}
                  className="mt-3 text-[11px] uppercase tracking-[0.16em] text-gold underline"
                >
                  Run the cut again
                </button>
              ) : null}
            </div>
          ) : null}

          {activeJob && segments.length > 0 ? (
            <div className="mt-5 flex flex-wrap gap-3">
              <a
                href={`/api/jobs/${activeJob.id}/download`}
                className="rounded-full bg-gold px-5 py-3 text-[11px] uppercase tracking-[0.18em] text-ink"
              >
                Download ZIP · {segments.length} clips
              </a>
              <button
                type="button"
                onClick={() => void handleBrowserZip()}
                disabled={zipping}
                className="rounded-full border border-line px-5 py-3 text-[11px] uppercase tracking-[0.18em] text-paper-dim"
              >
                {zipping ? "Building WAV pack…" : "Browser WAV pack"}
              </button>
            </div>
          ) : null}

          <div className="console-scroll mt-6 max-h-[520px] space-y-3 overflow-auto pr-1">
            {segments.length === 0 ? (
              <EmptyVault />
            ) : (
              segments.map((segment) => (
                <article
                  key={segment.id}
                  className="grid grid-cols-[auto_1fr_auto] items-center gap-4 rounded-2xl border border-line bg-ink px-4 py-3"
                >
                  <span
                    className={`rounded-full px-2.5 py-1 text-[10px] uppercase tracking-[0.16em] ${
                      segment.type === "lyric"
                        ? "bg-copper/20 text-copper-2"
                        : "bg-moss/20 text-moss"
                    }`}
                  >
                    {segment.type}
                  </span>
                  <div>
                    <p className="font-display text-lg leading-tight">{segment.text}</p>
                    <p className="mt-1 text-xs text-paper-dim">
                      {formatClock(segment.startTime)} – {formatClock(segment.endTime)} ·{" "}
                      {formatClock(segment.duration ?? segment.endTime - segment.startTime)}
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => playSegment(segment)}
                      className="rounded-full border border-line px-3 py-1 text-[10px] uppercase tracking-[0.16em] text-gold"
                    >
                      {playingId === segment.id ? "Playing" : "Cue"}
                    </button>
                    {segment.filename ? (
                      <a
                        href={`/api/jobs/${segment.jobId}/segments/${segment.id}`}
                        className="rounded-full border border-line px-3 py-1 text-[10px] uppercase tracking-[0.16em] text-paper-dim"
                      >
                        File
                      </a>
                    ) : null}
                  </div>
                </article>
              ))
            )}
          </div>
        </section>
      </main>

      {libraryOpen ? (
        <aside className="fixed inset-0 z-30 bg-ink/70 backdrop-blur-sm">
          <div className="absolute right-0 top-0 flex h-full w-full max-w-md flex-col border-l border-line bg-ink-2">
            <div className="flex items-center justify-between border-b border-line px-6 py-5">
              <div>
                <p className="text-[11px] uppercase tracking-[0.2em] text-copper-2">Vault</p>
                <h3 className="font-display text-3xl">Previous cuts</h3>
              </div>
              <button
                type="button"
                onClick={() => setLibraryOpen(false)}
                className="text-sm text-paper-dim"
              >
                Close
              </button>
            </div>
            <div className="console-scroll flex-1 space-y-3 overflow-auto p-5">
              {jobs.length === 0 ? (
                <p className="text-sm text-paper-dim">The vault is empty. Cut a record to fill it.</p>
              ) : (
                jobs.map((job) => (
                  <article key={job.id} className="rounded-2xl border border-line bg-ink p-4">
                    <button type="button" onClick={() => void loadJob(job.id)} className="w-full text-left">
                      <p className="font-display text-xl">{job.title}</p>
                      <p className="mt-1 text-xs uppercase tracking-[0.16em] text-paper-dim">
                        {STATUS_COPY[job.status].label} · {job.segmentsCount} clips
                      </p>
                    </button>
                    <div className="mt-3 flex gap-3 text-[11px] uppercase tracking-[0.16em]">
                      <button type="button" onClick={() => void loadJob(job.id)} className="text-gold">
                        Open
                      </button>
                      <button type="button" onClick={() => void deleteJob(job.id)} className="text-rose">
                        Discard
                      </button>
                    </div>
                  </article>
                ))
              )}
            </div>
          </div>
        </aside>
      ) : null}

      {helpOpen ? (
        <div className="fixed inset-0 z-30 grid place-items-center bg-ink/75 p-4 backdrop-blur-sm">
          <div className="max-h-[90vh] w-full max-w-3xl overflow-auto rounded-[28px] border border-line bg-ink-2">
            <div className="grid gap-0 md:grid-cols-[0.8fr_1.2fr]">
              <Image
                src="/images/vintage-desk.jpg"
                alt="Vintage studio desk"
                width={480}
                height={640}
                className="h-56 w-full object-cover md:h-full"
              />
              <div className="p-6 md:p-8">
                <p className="text-[11px] uppercase tracking-[0.2em] text-copper-2">Method</p>
                <h3 className="mt-2 font-display text-4xl">How the lathe works</h3>
                <ol className="mt-6 space-y-4 text-sm leading-6 text-paper-dim">
                  <li>
                    <span className="text-gold">01.</span> Groq Whisper transcribes the audio with
                    word and segment timestamps.
                  </li>
                  <li>
                    <span className="text-gold">02.</span> Llama cleans the lyric sheet and maps each
                    line onto those timestamps, marking gaps as instrumental.
                  </li>
                  <li>
                    <span className="text-gold">03.</span> ffmpeg slices the master into MP3 clips and
                    packs them into a ZIP.
                  </li>
                  <li>
                    <span className="text-gold">04.</span> If the server pack is delayed, build a WAV
                    pack in the browser from the same timeline.
                  </li>
                </ol>
                <button
                  type="button"
                  onClick={() => setHelpOpen(false)}
                  className="mt-8 rounded-full bg-copper px-5 py-3 text-[11px] uppercase tracking-[0.18em] text-ink"
                >
                  Back to the floor
                </button>
              </div>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function ProcessRail({ status }: { status: JobStatus | null }) {
  const steps: JobStatus[] = ["uploaded", "transcribing", "aligning", "splitting", "completed"];
  const current = status === "failed" ? -1 : status ? steps.indexOf(status) : -1;

  return (
    <div className="mt-6 grid grid-cols-5 gap-2">
      {steps.map((step, index) => {
        const on = current >= index;
        return (
          <div key={step} className={`rounded-full py-2 text-center text-[10px] uppercase tracking-[0.14em] ${
            on ? "bg-copper text-ink" : "bg-ink text-paper-dim"
          }`}>
            {step === "uploaded" ? "Queue" : step === "transcribing" ? "Listen" : step === "aligning" ? "Align" : step === "splitting" ? "Cut" : "Vault"}
          </div>
        );
      })}
    </div>
  );
}

function Waveform({
  peaks,
  duration,
  currentTime,
  segments,
  onSeek,
}: {
  peaks: number[];
  duration: number;
  currentTime: number;
  segments: SerializedSegment[];
  onSeek: (time: number) => void;
}) {
  const bars = peaks.length > 0 ? peaks : Array.from({ length: 64 }, () => 0.12);
  const max = Math.max(...bars, 0.08);

  return (
    <div
      className="mt-5 flex h-24 items-end gap-[3px]"
      onClick={(event) => {
        if (!duration) return;
        const bounds = event.currentTarget.getBoundingClientRect();
        const ratio = (event.clientX - bounds.left) / bounds.width;
        onSeek(ratio * duration);
      }}
    >
      {bars.map((value, index) => {
        const ratio = index / bars.length;
        const time = ratio * duration;
        const segment = segments.find((item) => time >= item.startTime && time < item.endTime);
        const active = duration > 0 && time <= currentTime;
        const color = segment?.type === "lyric" ? "bg-copper-2" : segment?.type === "music" ? "bg-moss" : "bg-paper-dim";
        return (
          <span
            key={index}
            className={`flex-1 rounded-full ${color} ${active ? "opacity-100" : "opacity-35"}`}
            style={{ height: `${Math.max(8, (value / max) * 100)}%` }}
          />
        );
      })}
    </div>
  );
}

function EmptyVault() {
  return (
    <div className="rounded-[24px] border border-dashed border-line p-8 text-center">
      <Image
        src="/images/og-cutline.jpg"
        alt="Studio atmosphere"
        width={640}
        height={360}
        className="mx-auto h-40 w-full max-w-md rounded-2xl object-cover"
      />
      <p className="mt-5 font-display text-2xl">No clips on the bench yet</p>
      <p className="mt-2 text-sm text-paper-dim">
        After the lathe finishes, lyric lines and instrumental breaths will stack here.
      </p>
    </div>
  );
}

async function computePeaks(file: File) {
  const context = new AudioContext();
  try {
    const audio = await context.decodeAudioData((await file.arrayBuffer()).slice(0));
    const data = audio.getChannelData(0);
    const count = 88;
    const block = Math.max(1, Math.floor(data.length / count));
    const peaks: number[] = [];
    for (let i = 0; i < count; i += 1) {
      let sum = 0;
      for (let j = 0; j < block; j += 1) {
        sum += Math.abs(data[i * block + j] ?? 0);
      }
      peaks.push(sum / block);
    }
    return { peaks, duration: audio.duration };
  } finally {
    await context.close();
  }
}
