import { describe, expect, it } from "vitest";
import request from "supertest";
import { createApp } from "./createApp.js";

describe("createApp", () => {
  it("creates a side-effect-free Express app with typed health output", async () => {
    const app = createApp({
      getSessionCount: () => 2,
      getJobCount: () => 3,
    });

    const response = await request(app).get("/health").expect(200);

    expect(response.body).toEqual({ ok: true, sessions: 2, jobs: 3 });
  });

  it("rejects malformed JSON with a stable typed error", async () => {
    const app = createApp({
      getSessionCount: () => 0,
      getJobCount: () => 0,
    });

    const response = await request(app)
      .post("/api/webhooks/ping")
      .set("content-type", "application/json")
      .send('{"broken"')
      .expect(400);

    expect(response.body).toEqual({
      error: {
        code: "INVALID_JSON",
        message: "Request body is not valid JSON.",
      },
    });
  });

  it("lists active jobs and ready sessions through injected read models", async () => {
    const app = createApp({
      getSessionCount: () => 1,
      getJobCount: () => 1,
      listJobs: () => [{ id: "job-1", status: "downloading" }],
      listSessions: () => [{ id: "session-1", fileCount: 12 }],
    });

    const jobs = await request(app).get("/api/session-jobs").expect(200);
    const sessions = await request(app).get("/api/sessions").expect(200);

    expect(jobs.body).toEqual({
      items: [{ id: "job-1", status: "downloading" }],
    });
    expect(sessions.body).toEqual({
      items: [{ id: "session-1", fileCount: 12 }],
    });
  });
});
