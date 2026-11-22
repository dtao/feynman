import Anthropic from "@anthropic-ai/sdk";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import { z } from "zod";
import type { ChatMessage, DecomposeResult, NodeContext, ValidateResult } from "../types.ts";
import { loadKey } from "./store.ts";
import { CHECK_MARK } from "./tree.ts";

const MODEL = import.meta.env.VITE_FEYNMAN_MODEL || "claude-opus-5-5";
// If a safety classifier declines a request, let the API retry it on a fallback model.
const BETAS = ["server-side-fallback-2026-07-01"];

export class MissingKeyError extends Error {
  constructor() {
    super("Add your Anthropic API key first (API key, top right).");
  }
}

// The app has no server: the browser calls the Anthropic API directly with the key the user stored.
let cached: { key: string; client: Anthropic } | undefined;
function client(): Anthropic {
  const key = loadKey();
  if (!key) throw new MissingKeyError();
  if (cached?.key !== key) cached = { key, client: new Anthropic({ apiKey: key, dangerouslyAllowBrowser: true }) };
  return cached.client;
}

export const modelName = () => MODEL;

// ---------- shared context ----------

function describeContext(ctx: NodeContext): string {
  const lines: string[] = [];
  lines.push(`What the learner said they want to understand: """${ctx.goal}"""`);
  if (ctx.path.length) {
    lines.push(`Where this concept sits (overall topic first): ${[...ctx.path, ctx.title].join(" → ")}`);
  }
  if (ctx.title) {
    lines.push(`Concept: ${ctx.title}`);
    if (ctx.description) lines.push(`What it covers: ${ctx.description}`);
  }
  if (ctx.children.length) {
    lines.push("", "Its components (the learner works through these before this concept):");
    ctx.children.forEach((c, i) => {
      const how =
        c.status === "known" ? "learner says they already knew this" :
        c.status === "learned" ? "just learned" : "not yet learned";
      lines.push(`${i}. ${c.title} — ${c.description} [${how}]`);
      if (c.explanation) lines.push(`   The learner's own confirmed answer about it: """${c.explanation}"""`);
    });
  }
  if (ctx.known.length) {
    lines.push("", `Things the learner says they already understand: ${ctx.known.join("; ")}`);
  }
  return lines.join("\n");
}

// ---------- decompose ----------

const DecomposeSchema = z.object({
  title: z.string(),
  description: z.string(),
  atomic: z.boolean(),
  components: z.array(z.object({ title: z.string(), description: z.string() })),
});

const DECOMPOSE_SYSTEM = `You help someone learn a complex topic by mapping out what they would need to understand first. The app shows your breakdown as a tree; the learner ticks off the components they already understand, and the app asks you to break down each remaining component in turn, until every piece is small enough to teach directly. Lessons then run bottom-up, so each concept is taught right after its components.

Given a concept, return the components someone must understand in order to understand it.

- Components are the ideas the concept is built from or depends on: its prerequisites and its parts. Each must be clearly simpler than the concept itself, so that the recursion bottoms out.
- Give 2 to 6 components, in a sensible learning order. Prefer fewer, well-chosen ones; a learner has to work through every one.
- Make them distinct from each other, and do not repeat the concept's ancestors or anything in the list of concepts already in the tree.
- Component titles are short noun phrases (a few words) in plain text. In descriptions, write any maths with $…$ and a literal dollar sign as \\$. Descriptions are one plain sentence saying what the component is, written so the learner can judge honestly whether they already understand it.
- Set "atomic" to true, with an empty component list, when the concept can be taught in a single short lesson to a curious adult using only everyday knowledge plus the things the learner says they already understand. The deeper a concept is in the tree, the more readily it should be atomic; do not decompose down to trivia.
- "title" is a concise name for the concept and "description" is one sentence on what it covers. When you are given the learner's raw request rather than a named concept, identify the topic they mean and name it; otherwise keep the given title, tidying it only if needed.`;

export async function decompose(ctx: NodeContext): Promise<DecomposeResult> {
  const isRoot = ctx.path.length === 0 && !ctx.title;
  const ask = isRoot
    ? "Identify the topic the learner wants to understand and break it into components."
    : `Break down the concept "${ctx.title}" (depth ${ctx.depth} in the tree).` +
      (ctx.forceSplit
        ? " The learner tried to learn this in one go and found it too big, so do break it into smaller components: atomic must be false."
        : "");
  const existing = ctx.existing.length
    ? `\n\nConcepts already in the tree (do not repeat): ${ctx.existing.join("; ")}`
    : "";

  const response = await client().beta.messages.parse({
    model: MODEL,
    max_tokens: 16000,
    betas: BETAS,
    fallbacks: "default",
    output_config: { effort: "medium", format: betaZodOutputFormat(DecomposeSchema) },
    system: DECOMPOSE_SYSTEM,
    messages: [{ role: "user", content: `${describeContext(ctx)}${existing}\n\n${ask}` }],
  });
  if (response.stop_reason === "refusal") throw new Error("The model declined to break down this topic.");
  const out = response.parsed_output;
  if (!out) throw new Error("The model returned a breakdown the app could not read. Try again.");
  if (out.atomic || out.components.length === 0) return { ...out, atomic: true, components: [] };
  return out;
}

// ---------- teach ----------

const TEACH_SYSTEM = `You are a patient, clear teacher in a learning app built around the Feynman technique. The learner picked a complex topic; the app broke it into a tree of components and is teaching them bottom-up, one concept at a time. You are teaching one concept from that tree.

How to teach it:
- Explain the single concept you are given, in plain language, to an intelligent adult who does not know the field. Define any term you need the first time you use it.
- When the concept has components, the learner has just worked through them (or said they already knew them). Do not re-teach them. Show how they fit together to produce this concept; that connection is the lesson.
- When it has no components, teach it from the ground up, relying only on everyday knowledge and whatever the learner says they already understand.
- Use one concrete example or analogy that carries real explanatory weight, and say where the analogy stops being accurate if it does.
- Say why the concept matters for the topic the learner is ultimately after.
- The app already shows the concept's name as the page heading, so start with the explanation itself rather than a title.
- Keep the lesson to roughly 250–450 words. Use short paragraphs; use a list or a small table only where the content has that shape. Write maths with $…$ and $$…$$ (the closing question included), and write a literal dollar sign as \\$ so that prices are not read as maths.
- After the lesson, on a line of its own, write exactly ${CHECK_MARK} and then one question. The app hides this question while the learner reads; once they say they understand, it asks them to answer it in writing and checks the answer, and a good answer is what confirms their understanding. So choose a question that can only be answered well by someone who understands this concept: asking them to explain why or how, predict what happens in a new case, or apply the idea, never to recall a phrase from the lesson. It must be answerable in a few sentences from this lesson and its components alone. Do not mention the question in the lesson and do not answer it.
- If you are given notes from a failed understanding check, open by addressing those gaps directly and take a different angle from a standard textbook explanation.

After the lesson the learner may ask follow-up questions because something did not land. Answer them directly and briefly, staying on this concept and at this level, without giving away the answer to your closing question. Follow-up answers have no closing question and no ${CHECK_MARK} line.`;

/** Streams a lesson, or a follow-up answer when `chat` is non-empty. Resolves with the full text. */
export async function teach(ctx: NodeContext, chat: ChatMessage[], onDelta: (text: string) => void, signal: AbortSignal): Promise<string> {
  let first = `${describeContext(ctx)}\n\nTeach me: ${ctx.title}`;
  if (ctx.reviewNote) {
    first += `\n\nI answered a question about this and did not pass. Notes from that check: """${ctx.reviewNote}"""`;
  }
  const stream = client().beta.messages.stream(
    {
      model: MODEL,
      max_tokens: 64000,
      betas: BETAS,
      fallbacks: "default",
      output_config: { effort: "medium" },
      system: TEACH_SYSTEM,
      messages: [{ role: "user", content: first }, ...chat],
    },
    { signal },
  );
  let full = "";
  stream.on("text", (text) => {
    full += text;
    onDelta(text);
  });
  const final = await stream.finalMessage();
  if (final.stop_reason === "refusal") throw new Error("The model declined to continue this lesson.");
  if (final.stop_reason === "max_tokens") throw new Error("The lesson was cut off before it finished. Try again.");
  return full;
}

// ---------- validate ----------

const ValidateSchema = z.object({
  passed: z.boolean(),
  feedback: z.string(),
  gaps: z.array(z.string()),
  weakComponents: z.array(z.number().int()),
});

const VALIDATE_SYSTEM = `You check whether a learner really understands a concept, based on their written answer to one question about it. The learner has just said they understand the concept; answering this question well is how they confirm it, and the app then records their answer as "locked in". Sometimes the question is simply a request to explain the concept in their own words.

Judge understanding, not polish:
- Pass an answer that responds to the question correctly and shows the learner grasps the idea behind it: the reasoning is sound and the essential parts are there. Informal wording, missing jargon, and omitted side details are fine.
- Fail an answer that contains a real misconception, misses something the question depends on, restates the question or a definition without showing how the idea works, or is too vague to tell.
- Judge against what the concept actually is. The lesson the learner was given is included for reference when there is one, but a correct answer that differs from the lesson passes.

Return:
- "passed": your verdict.
- "feedback": two to four sentences addressed to the learner as "you". Say what they got right, then, if they failed, exactly what is wrong or missing. Do not give away the full correct answer when they failed; point at the gap.
- In "feedback" and "gaps", write any maths with $…$ and a literal dollar sign as \\$.
- "gaps": the specific misunderstandings or omissions, one short phrase each. Empty when they passed cleanly.
- "weakComponents": the index numbers of the listed components that the answer shows the learner is shaky on. When the learner failed and the concept has components, name at least one, choosing the component most responsible for the failure; the app sends the learner back to review those. Empty when they passed or when the concept has no components.`;

export async function validate(ctx: NodeContext, lesson: string | undefined, question: string, answer: string): Promise<ValidateResult> {
  const parts = [describeContext(ctx)];
  if (lesson) parts.push(`The lesson the learner was given:\n"""${lesson}"""`);
  parts.push(`The question the learner was asked about "${ctx.title}":\n"""${question}"""`);
  parts.push(`The learner's answer:\n"""${answer}"""`);

  const response = await client().beta.messages.parse({
    model: MODEL,
    max_tokens: 16000,
    betas: BETAS,
    fallbacks: "default",
    output_config: { effort: "high", format: betaZodOutputFormat(ValidateSchema) },
    system: VALIDATE_SYSTEM,
    messages: [{ role: "user", content: parts.join("\n\n") }],
  });
  if (response.stop_reason === "refusal") throw new Error("The model declined to check this answer.");
  const out = response.parsed_output;
  if (!out) throw new Error("The model returned a verdict the app could not read. Try again.");
  const weak = out.passed ? [] : [...new Set(out.weakComponents)].filter((i) => i >= 0 && i < ctx.children.length);
  return { ...out, weakComponents: weak };
}

/** Turns an SDK failure into a message worth showing. */
export function describeError(err: unknown): Error {
  if (err instanceof MissingKeyError) return err;
  if (err instanceof Anthropic.AuthenticationError || err instanceof Anthropic.PermissionDeniedError) {
    return new Error("Anthropic rejected your API key. Check or replace it under API key, top right.");
  }
  if (err instanceof Anthropic.RateLimitError) return new Error("Rate limited by the Anthropic API. Wait a moment and try again.");
  if (err instanceof Anthropic.APIConnectionError) return new Error("Could not reach the Anthropic API. Check your connection and try again.");
  if (err instanceof Anthropic.APIError) return new Error(`Anthropic API error: ${err.message}`);
  return err instanceof Error ? err : new Error("Something went wrong.");
}
