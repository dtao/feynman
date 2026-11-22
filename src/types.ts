/** pending = still to learn (gray) · known = I said I already understand it · learned = understood here (green) */
export type Status = "pending" | "known" | "learned";

/**
 * none    – not broken down (yet). Pending nodes in this state are queued for breakdown.
 * loading – breakdown request in flight
 * triage  – has components; waiting for me to say which I already understand
 * done    – components triaged
 * leaf    – small enough to teach directly
 * error   – breakdown failed; can be retried
 */
export type Expansion = "none" | "loading" | "triage" | "done" | "leaf" | "error";

export interface ChatMessage {
  role: "user" | "assistant";
  content: string;
}

export interface Attempt {
  /** The question that was answered. */
  question?: string;
  text: string;
  passed: boolean;
  feedback: string;
  gaps: string[];
  at: number;
}

export interface TNode {
  id: string;
  parentId: string | null;
  title: string;
  description: string;
  children: string[];
  status: Status;
  expansion: Expansion;
  /** chat[0] is the lesson (with its confirming question after CHECK_MARK); the rest are follow-ups. */
  chat: ChatMessage[];
  /** Every answer to a confirming question. The latest passing one is the locked-in answer. */
  attempts: Attempt[];
  /** Feedback from a failed check, used to focus the next lesson. */
  reviewNote?: string;
  /** I asked for this to be broken down, so the model should not call it atomic. */
  forceSplit?: boolean;
  error?: string;
}

export interface Session {
  id: string;
  /** What I typed, verbatim. */
  goal: string;
  rootId: string;
  nodes: Record<string, TNode>;
  createdAt: number;
  updatedAt: number;
}

// ---- API payloads ----

export interface Component {
  title: string;
  description: string;
}

/** Everything the model needs to know about where a node sits in the tree. */
export interface NodeContext {
  goal: string;
  /** Titles from the root down to (not including) this node. */
  path: string[];
  title: string;
  description: string;
  depth: number;
  children: { title: string; description: string; status: Status; explanation?: string }[];
  /** Titles of things the learner said they already understand. */
  known: string[];
  /** Titles already in the tree, to avoid duplicates when breaking down. */
  existing: string[];
  reviewNote?: string;
  forceSplit?: boolean;
}

export interface DecomposeResult {
  title: string;
  description: string;
  atomic: boolean;
  components: Component[];
}

export interface ValidateResult {
  passed: boolean;
  feedback: string;
  gaps: string[];
  /** Indexes into NodeContext.children that the explanation shows are shaky. */
  weakComponents: number[];
}
