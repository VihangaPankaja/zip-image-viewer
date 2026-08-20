import { z } from "zod";

export type SessionTree = {
  children?: SessionTree[];
  extension?: string;
  name: string;
  parentPath?: string;
  path: string;
  size?: number;
  type: "file" | "directory";
};

const sessionTreeSchema: z.ZodType<SessionTree> = z.object({
  children: z.lazy(() => z.array(sessionTreeSchema)).optional(),
  extension: z.string().optional(),
  name: z.string(),
  parentPath: z.string().optional(),
  path: z.string(),
  size: z.number().optional(),
  type: z.enum(["file", "directory"]),
});

export const sessionPayloadSchema = z.looseObject({
  id: z.string().optional(),
  firstFilePath: z.string().optional(),
  tree: sessionTreeSchema.optional(),
});
export type SessionPayload = z.infer<typeof sessionPayloadSchema>;

export const jobPayloadSchema = z.looseObject({
  id: z.string().optional(),
  status: z.string().optional(),
  sessionId: z.string().optional(),
  reportedSize: z.number().optional(),
  error: z.string().optional(),
  averageSpeedBytesPerSec: z.number().optional(),
  downloadedBytes: z.number().optional(),
  etaSeconds: z.number().optional(),
  maxRetries: z.number().optional(),
  percent: z.number().nullable().optional(),
  phase: z.string().optional(),
  retryCount: z.number().optional(),
  threadCount: z.number().optional(),
  threadMode: z.enum(["auto", "single", "segmented"]).optional(),
  totalTranscodeEntries: z.number().optional(),
  transcodedEntries: z.number().optional(),
  downloadSpeedBytesPerSec: z.number().optional(),
});
export type JobPayload = z.infer<typeof jobPayloadSchema>;

export type OversizePrompt = {
  jobId?: string;
  reportedSize: number;
  limit: number;
};
