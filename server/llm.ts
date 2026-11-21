import Anthropic from "@anthropic-ai/sdk";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import { z } from "zod";
import type { ChatMessage, DecomposeResult, NodeContext, ValidateResult } from "../src/types.ts";

const MODEL = process.env.FEYNMAN_MODEL || "claude-opus-5-5";
// If a safety classifier declines a request, let the API retry it on a fallback model.
const BETAS = ["server-side-fallback-2026-07-01"];

let _client: Anthropic | undefined;
const client = () => (_client ??= new Anthropic());

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
      if (c.explanation) lines.push(`   The learner's own explanation of it: """${c.explanation}"""`);
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
- Component titles are short noun phrases (a few words). Descriptions are one plain sentence saying what the component is, written so the learner can judge honestly whether they already understand it.
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
- Keep the lesson to roughly 250–450 words. Use short paragraphs; use a list or a small table only where the content has that shape. Write maths with $…$ and $$…$$.
- End with one question, under the heading "Check yourself", that the learner could only answer by understanding the idea rather than recalling a phrase. Do not answer it.
- If you are given notes from a failed understanding check, open by addressing those gaps directly and take a different angle from a standard textbook explanation.

After the lesson the learner may ask follow-up questions. Answer them directly and briefly, staying on this concept and at this level.`;

export function teachStream(ctx: NodeContext, chat: ChatMessage[]) {
  let first = `${describeContext(ctx)}\n\nTeach me: ${ctx.title}`;
  if (ctx.reviewNote) {
    first += `\n\nI tried to explain this back and did not pass. Notes from that check: """${ctx.reviewNote}"""`;
  }
  return client().beta.messages.stream({
    model: MODEL,
    max_tokens: 64000,
    betas: BETAS,
    fallbacks: "default",
    output_config: { effort: "medium" },
    system: TEACH_SYSTEM,
    messages: [{ role: "user", content: first }, ...chat],
  });
}

// ---------- validate ----------

const ValidateSchema = z.object({
  passed: z.boolean(),
  feedback: z.string(),
  gaps: z.array(z.string()),
  weakComponents: z.array(z.number().int()),
});

const VALIDATE_SYSTEM = `You check whether a learner really understands a concept, based on their own written explanation of it. This is the final step of the Feynman technique: if they can explain it simply and correctly, they understand it.

Judge understanding, not polish:
- Pass an explanation that gets the core idea right, covers the essential parts at the level this concept sits at in the tree, and shows how those parts connect. Informal wording, missing jargon, and omitted side details are fine.
- Fail an explanation that contains a real misconception, leaves out something essential to the idea, only restates the name or definition without showing how it works, or is too vague to tell.
- Judge against what the concept actually is. The lesson the learner was given is included for reference when there is one, but a correct explanation that differs from the lesson passes.

Return:
- "passed": your verdict.
- "feedback": two to four sentences addressed to the learner as "you". Say what they got right, then, if they failed, exactly what is wrong or missing. Do not give away the full correct explanation when they failed; point at the gap.
- "gaps": the specific misunderstandings or omissions, one short phrase each. Empty when they passed cleanly.
- "weakComponents": the index numbers of the listed components that the explanation shows the learner is shaky on. When the learner failed and the concept has components, name at least one, choosing the component most responsible for the failure; the app sends the learner back to review those. Empty when they passed or when the concept has no components.`;

export async function validate(ctx: NodeContext, lesson: string | undefined, explanation: string): Promise<ValidateResult> {
  const parts = [describeContext(ctx)];
  if (lesson) parts.push(`The lesson the learner was given:\n"""${lesson}"""`);
  parts.push(`The learner's explanation of "${ctx.title}":\n"""${explanation}"""`);

  const response = await client().beta.messages.parse({
    model: MODEL,
    max_tokens: 16000,
    betas: BETAS,
    fallbacks: "default",
    output_config: { effort: "high", format: betaZodOutputFormat(ValidateSchema) },
    system: VALIDATE_SYSTEM,
    messages: [{ role: "user", content: parts.join("\n\n") }],
  });
  if (response.stop_reason === "refusal") throw new Error("The model declined to check this explanation.");
  const out = response.parsed_output;
  if (!out) throw new Error("The model returned a verdict the app could not read. Try again.");
  const weak = out.passed ? [] : [...new Set(out.weakComponents)].filter((i) => i >= 0 && i < ctx.children.length);
  return { ...out, weakComponents: weak };
}

/** A message safe to show in the UI. */
export function describeError(err: unknown): { status: number; message: string } {
  if (err instanceof Anthropic.AuthenticationError) {
    return { status: 401, message: "No valid Anthropic credentials. Set ANTHROPIC_API_KEY in .env (see .env.example) and restart." };
  }
  if (err instanceof Anthropic.RateLimitError) {
    return { status: 429, message: "Rate limited by the Anthropic API. Wait a moment and try again." };
  }
  if (err instanceof Anthropic.APIConnectionError) {
    return { status: 502, message: "Could not reach the Anthropic API. Check your connection and try again." };
  }
  if (err instanceof Anthropic.APIError) {
    return { status: err.status ?? 500, message: `Anthropic API error: ${err.message}` };
  }
  if (err instanceof Error) {
    // The SDK throws a plain error when no credentials can be found at all.
    if (/api[_ ]?key|auth/i.test(err.message)) {
      return { status: 401, message: "No Anthropic credentials found. Set ANTHROPIC_API_KEY in .env (see .env.example) and restart." };
    }
    return { status: 500, message: err.message };
  }
  return { status: 500, message: "Something went wrong." };
}
