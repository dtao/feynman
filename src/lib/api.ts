import type { ChatMessage, DecomposeResult, NodeContext, ValidateResult } from "../types.ts";

async function post<T>(url: string, body: unknown): Promise<T> {
  let res: Response;
  try {
    res = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  } catch {
    throw new Error("Could not reach the app's server. Is it still running?");
  }
  const data = await res.json().catch(() => null);
  if (!res.ok) throw new Error(data?.error ?? `Request failed (${res.status}).`);
  return data as T;
}

export const decompose = (context: NodeContext) => post<DecomposeResult>("/api/decompose", { context });

export const validate = (context: NodeContext, lesson: string | undefined, explanation: string) =>
  post<ValidateResult>("/api/validate", { context, lesson, explanation });

export const health = () => fetch("/api/health").then((r) => r.json() as Promise<{ mock: boolean; model: string }>);

/** Streams a lesson (or a follow-up answer when `chat` is non-empty). Resolves with the full text. */
export async function teach(context: NodeContext, chat: ChatMessage[], onDelta: (text: string) => void, signal: AbortSignal): Promise<string> {
  const res = await fetch("/api/teach", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ context, chat }),
    signal,
  });
  if (!res.ok || !res.body) {
    const data = await res.json().catch(() => null);
    throw new Error(data?.error ?? `Request failed (${res.status}).`);
  }
  const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
  let buffer = "";
  let full = "";
  let finished = false;
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += value;
    const lines = buffer.split("\n");
    buffer = lines.pop()!;
    for (const line of lines) {
      if (!line) continue;
      const msg = JSON.parse(line) as { t: "delta"; text: string } | { t: "done" } | { t: "error"; message: string };
      if (msg.t === "delta") {
        full += msg.text;
        onDelta(msg.text);
      } else if (msg.t === "error") {
        throw new Error(msg.message);
      } else {
        finished = true;
      }
    }
  }
  if (!finished) throw new Error("The connection dropped before the lesson finished.");
  return full;
}
