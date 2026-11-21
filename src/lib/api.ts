// The three model calls the app makes, routed to the Anthropic API or to canned responses.
import type { ChatMessage, DecomposeResult, NodeContext, ValidateResult } from "../types.ts";
import * as llm from "./llm.ts";
import * as mock from "./mock.ts";

export const isMock = import.meta.env.VITE_MOCK === "1";
const impl = isMock ? mock : llm;

async function friendly<T>(call: () => Promise<T>): Promise<T> {
  try {
    return await call();
  } catch (err) {
    throw llm.describeError(err);
  }
}

export const decompose = (ctx: NodeContext): Promise<DecomposeResult> => friendly(() => impl.decompose(ctx));

export const validate = (ctx: NodeContext, lesson: string | undefined, explanation: string): Promise<ValidateResult> =>
  friendly(() => impl.validate(ctx, lesson, explanation));

/** Streams a lesson (or a follow-up answer when `chat` is non-empty). Resolves with the full text. */
export const teach = (ctx: NodeContext, chat: ChatMessage[], onDelta: (text: string) => void, signal: AbortSignal): Promise<string> =>
  friendly(() => impl.teach(ctx, chat, onDelta, signal));
