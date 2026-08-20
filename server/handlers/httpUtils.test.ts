import express from "express";
import request from "supertest";
import { describe, expect, test } from "vitest";
import { applyByteRange } from "./httpUtils.js";

describe("applyByteRange", () => {
  test("applies full, partial, and unsatisfiable byte responses", async () => {
    const app = express();
    app.get("/file/:mode", (req, res) => {
      const range = applyByteRange(
        res,
        req.params.mode === "partial"
          ? { start: 2, end: 5 }
          : req.params.mode === "invalid"
            ? "invalid"
            : null,
        10,
      );
      if (range === null) return;
      res.end(range ? "2345" : "0123456789");
    });

    const full = await request(app).get("/file/full");
    expect(full.status).toBe(200);
    expect(full.headers["accept-ranges"]).toBe("bytes");
    expect(full.headers["content-length"]).toBe("10");

    const partial = await request(app).get("/file/partial");
    expect(partial.status).toBe(206);
    expect(partial.headers["content-range"]).toBe("bytes 2-5/10");
    expect(partial.headers["content-length"]).toBe("4");

    const invalid = await request(app).get("/file/invalid");
    expect(invalid.status).toBe(416);
    expect(invalid.headers["content-range"]).toBe("bytes */10");
  });
});
