// Canned responses so the app can be developed and tested without a key or API calls (VITE_MOCK=1).
import type { ChatMessage, DecomposeResult, NodeContext, ValidateResult } from "../types.ts";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const DELAY = Number(import.meta.env.VITE_MOCK_DELAY ?? 300);

export async function decompose(ctx: NodeContext): Promise<DecomposeResult> {
  await sleep(DELAY);
  const title = ctx.title || ctx.goal.replace(/^i want to (understand|learn)( about)?\s*/i, "").replace(/[.?!]$/, "") || "Topic";
  const description = ctx.description || `Everything involved in ${title}.`;
  if (ctx.depth >= 2 && !ctx.forceSplit) return { title, description, atomic: true, components: [] };
  const n = ctx.depth === 0 ? 4 : 2;
  return {
    title,
    description,
    atomic: false,
    components: Array.from({ length: n }, (_, i) => ({
      title: `${title} · part ${i + 1}`,
      description: `The ${["first", "second", "third", "fourth"][i]} idea that ${title} is built from.`,
    })),
  };
}

export async function teach(ctx: NodeContext, chat: ChatMessage[], onDelta: (text: string) => void, signal: AbortSignal): Promise<string> {
  const text = chat.length
    ? `Good question. In short: it follows from how **${ctx.title}** is put together.`
    : [
        ctx.reviewNote ? `Let's revisit the gap from your last check: *${ctx.reviewNote}*` : "",
        ctx.children.length
          ? `You now know ${ctx.children.map((c) => `**${c.title}**`).join(", ")}. Together they give you this idea.`
          : `This is a building block, so we start from scratch.`,
        `Think of it like a recipe: each step is simple, and the dish is what you get when they run in order. In symbols, $a^2 + b^2 = c^2$.`,
        `===CHECK===\nWhy would ${ctx.title} fail if one step were missing?`,
      ].filter(Boolean).join("\n\n");
  for (const word of text.split(/(?<=\s)/)) {
    await sleep(DELAY / 30);
    if (signal.aborted) throw new DOMException("Aborted", "AbortError");
    onDelta(word);
  }
  return text;
}

/** Passes unless the answer is very short or contains "wrong". */
export async function validate(ctx: NodeContext, _lesson: string | undefined, _question: string, explanation: string): Promise<ValidateResult> {
  await sleep(DELAY);
  const passed = explanation.trim().length >= 40 && !/wrong/i.test(explanation);
  return passed
    ? { passed, feedback: "You captured the core idea and how the parts connect.", gaps: [], weakComponents: [] }
    : {
        passed,
        feedback: "You named the idea but did not show how it works.",
        gaps: ["does not explain the mechanism"],
        weakComponents: ctx.children.length ? [0] : [],
      };
}
