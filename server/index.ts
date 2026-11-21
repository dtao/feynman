import express from "express";
import path from "node:path";
import { fileURLToPath } from "node:url";
import * as llm from "./llm.ts";
import * as mock from "./mock.ts";
import type { ChatMessage, NodeContext } from "../src/types.ts";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "..");
const isProd = process.env.NODE_ENV === "production";
const useMock = process.env.FEYNMAN_MOCK === "1";
const port = Number(process.env.PORT ?? 5173);

const app = express();
app.use(express.json({ limit: "2mb" }));

function readContext(body: unknown): NodeContext {
  const ctx = (body as { context?: NodeContext })?.context;
  if (!ctx || typeof ctx.goal !== "string" || !ctx.goal.trim() || !Array.isArray(ctx.children)) {
    throw Object.assign(new Error("Bad request: missing context."), { badRequest: true });
  }
  return ctx;
}

function fail(res: express.Response, err: unknown) {
  if ((err as { badRequest?: boolean })?.badRequest) return res.status(400).json({ error: (err as Error).message });
  const { status, message } = llm.describeError(err);
  console.error(err);
  res.status(status).json({ error: message });
}

app.get("/api/health", (_req, res) => {
  res.json({ ok: true, mock: useMock, model: useMock ? "mock" : llm.modelName() });
});

app.post("/api/decompose", async (req, res) => {
  try {
    const ctx = readContext(req.body);
    res.json(useMock ? await mock.decompose(ctx) : await llm.decompose(ctx));
  } catch (err) {
    fail(res, err);
  }
});

app.post("/api/validate", async (req, res) => {
  try {
    const ctx = readContext(req.body);
    const { explanation, lesson } = req.body as { explanation?: string; lesson?: string };
    if (!explanation?.trim()) return res.status(400).json({ error: "Write an explanation first." });
    res.json(useMock ? await mock.validate(ctx, explanation) : await llm.validate(ctx, lesson, explanation));
  } catch (err) {
    fail(res, err);
  }
});

// Streams newline-delimited JSON: {"t":"delta","text":…}* then {"t":"done"} or {"t":"error","message":…}.
app.post("/api/teach", async (req, res) => {
  let ctx: NodeContext;
  try {
    ctx = readContext(req.body);
  } catch (err) {
    return fail(res, err);
  }
  const chat = ((req.body as { chat?: ChatMessage[] }).chat ?? []).filter(
    (m) => (m.role === "user" || m.role === "assistant") && typeof m.content === "string",
  );

  res.setHeader("Content-Type", "application/x-ndjson; charset=utf-8");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("X-Accel-Buffering", "no");
  const send = (obj: object) => res.write(JSON.stringify(obj) + "\n");

  try {
    if (useMock) {
      for await (const text of mock.teach(ctx, chat)) send({ t: "delta", text });
    } else {
      const stream = llm.teachStream(ctx, chat);
      res.on("close", () => { if (!res.writableEnded) stream.abort(); });
      stream.on("text", (text) => send({ t: "delta", text }));
      const final = await stream.finalMessage();
      if (final.stop_reason === "refusal") throw new Error("The model declined to continue this lesson.");
      if (final.stop_reason === "max_tokens") throw new Error("The lesson was cut off before it finished. Try again.");
    }
    send({ t: "done" });
  } catch (err) {
    if (!res.writableEnded && !res.destroyed) {
      console.error(err);
      send({ t: "error", message: llm.describeError(err).message });
    }
  }
  res.end();
});

if (isProd) {
  const dist = path.join(root, "dist");
  app.use(express.static(dist));
  app.get(/^(?!\/api\/).*/, (_req, res) => res.sendFile(path.join(dist, "index.html")));
} else {
  const { createServer } = await import("vite");
  const vite = await createServer({ root, server: { middlewareMode: true }, appType: "spa" });
  app.use(vite.middlewares);
}

app.listen(port, () => {
  console.log(`Feynman running at http://localhost:${port}${useMock ? "  (mock mode: no API calls)" : `  (model: ${llm.modelName()})`}`);
});
