import type { RequestHandler } from "express";
import { request } from "node:http";

export function proxyApp(baseURL: string): RequestHandler {
  return (req, res) => {
    const upstream = request(
      new URL(req.originalUrl, baseURL),
      {
        method: req.method,
        headers: { ...req.headers, host: new URL(baseURL).host },
      },
      (response) => {
        res.writeHead(response.statusCode ?? 502, response.headers);
        response.pipe(res);
      },
    );
    upstream.on("error", () => {
      if (!res.headersSent) res.status(502);
      res.end();
    });
    req.pipe(upstream);
  };
}
