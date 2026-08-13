import {
  integer,
  jsonb,
  pgTable,
  real,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";

export const jobs = pgTable("jobs", {
  id: uuid("id").primaryKey().defaultRandom(),
  title: text("title").notNull(),
  originalFilename: text("original_filename").notNull(),
  mimeType: text("mime_type").notNull(),
  filePath: text("file_path").notNull(),
  lyrics: text("lyrics").notNull(),
  cleanedLyrics: text("cleaned_lyrics"),
  transcription: text("transcription"),
  transcriptionJson: jsonb("transcription_json").$type<Record<string, unknown> | null>(),
  status: text("status").notNull().default("uploaded"),
  error: text("error"),
  zipPath: text("zip_path"),
  durationSeconds: real("duration_seconds"),
  segmentsCount: integer("segments_count").notNull().default(0),
  alignmentSource: text("alignment_source"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
});

export const segments = pgTable("segments", {
  id: uuid("id").primaryKey().defaultRandom(),
  jobId: uuid("job_id")
    .references(() => jobs.id, { onDelete: "cascade" })
    .notNull(),
  index: integer("index").notNull(),
  startTime: real("start_time").notNull(),
  endTime: real("end_time").notNull(),
  type: text("type").notNull(),
  text: text("text").notNull(),
  filename: text("filename"),
  filePath: text("file_path"),
  duration: real("duration"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

export type JobRow = typeof jobs.$inferSelect;
export type NewJobRow = typeof jobs.$inferInsert;
export type SegmentRow = typeof segments.$inferSelect;
