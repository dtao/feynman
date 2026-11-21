// Pure functions over a Session. Every mutation returns a new Session.
import type { Attempt, ChatMessage, DecomposeResult, NodeContext, Session, TNode, ValidateResult } from "../types.ts";

/** Components at this depth or deeper are taught directly rather than broken down again. */
export const MAX_DEPTH = 4;

const uid = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);

function makeNode(parentId: string | null, title: string, description: string): TNode {
  return { id: uid(), parentId, title, description, children: [], status: "pending", expansion: "none", chat: [], attempts: [] };
}

export function newSession(goal: string): Session {
  const root = makeNode(null, "", "");
  const now = Date.now();
  return { id: uid(), goal: goal.trim(), rootId: root.id, nodes: { [root.id]: root }, createdAt: now, updatedAt: now };
}

function patch(s: Session, id: string, changes: Partial<TNode>): Session {
  return { ...s, updatedAt: Date.now(), nodes: { ...s.nodes, [id]: { ...s.nodes[id], ...changes } } };
}

// ---------- reading ----------

export const root = (s: Session) => s.nodes[s.rootId];
export const kids = (s: Session, id: string) => s.nodes[id].children.map((c) => s.nodes[c]);

export function ancestors(s: Session, id: string): TNode[] {
  const out: TNode[] = [];
  for (let p = s.nodes[id].parentId; p; p = s.nodes[p].parentId) out.unshift(s.nodes[p]);
  return out;
}

export const depth = (s: Session, id: string) => ancestors(s, id).length;

/** Parents after their children, siblings in order: the order lessons run in. */
export function postOrder(s: Session, id: string = s.rootId): TNode[] {
  return [...s.nodes[id].children.flatMap((c) => postOrder(s, c)), s.nodes[id]];
}

/** Parents before their children, siblings in order. */
export function preOrder(s: Session, id: string = s.rootId): TNode[] {
  return [s.nodes[id], ...s.nodes[id].children.flatMap((c) => preOrder(s, c))];
}

/** The latest passing explanation, if any: the "locked in" one. */
export function lockedIn(n: TNode): Attempt | undefined {
  const last = n.attempts[n.attempts.length - 1];
  return last?.passed && n.status !== "pending" ? last : undefined;
}

export function contextFor(s: Session, id: string): NodeContext {
  const n = s.nodes[id];
  const all = Object.values(s.nodes);
  return {
    goal: s.goal,
    path: ancestors(s, id).map((a) => a.title),
    title: n.title,
    description: n.description,
    depth: depth(s, id),
    children: kids(s, id).map((c) => ({
      title: c.title,
      description: c.description,
      status: c.status,
      explanation: lockedIn(c)?.text,
    })),
    known: all.filter((x) => x.status === "known").map((x) => x.title),
    existing: all.filter((x) => x.title && x.id !== id).map((x) => x.title),
    reviewNote: n.reviewNote,
    forceSplit: n.forceSplit,
  };
}

// ---------- what happens next ----------

/**
 * The single next thing to do, found depth-first: go down into the first component I don't
 * understand, sort its pieces, and keep descending until something can be taught. Only when a
 * component is fully understood does the walk move on to its next sibling. So one branch is
 * mapped and learned to the top before the next branch is even broken down.
 *
 * triage – tell the app which of this node's components I already understand
 * wait   – this node is being broken down (or failed to, and can be retried)
 * learn  – everything beneath this node is understood: teach it
 * done   – nothing left
 */
export type Step = { kind: "triage" | "wait" | "learn"; node: TNode } | { kind: "done" };

export function nextStep(s: Session, id: string = s.rootId): Step {
  const n = s.nodes[id];
  if (n.status === "pending") {
    if (n.expansion === "triage") return { kind: "triage", node: n };
    if (n.expansion !== "done" && n.expansion !== "leaf") return { kind: "wait", node: n };
  }
  for (const c of n.children) {
    const step = nextStep(s, c);
    if (step.kind !== "done") return step;
  }
  return n.status === "pending" ? { kind: "learn", node: n } : { kind: "done" };
}

export type Phase = "mapping" | "learning" | "complete";

export function phase(s: Session): Phase {
  const kind = nextStep(s).kind;
  return kind === "done" ? "complete" : kind === "learn" ? "learning" : "mapping";
}

/**
 * Pending nodes that need a breakdown request. Children wait until their parent has been triaged,
 * and triage happens depth-first, so this only ever reaches the siblings along the current branch.
 */
export function nodesToExpand(s: Session): TNode[] {
  return preOrder(s).filter(
    (n) => n.status === "pending" && n.expansion === "none" && (!n.parentId || s.nodes[n.parentId].expansion === "done"),
  );
}

export const isLearnable = (s: Session, n: TNode) =>
  n.status === "pending" && (n.expansion === "leaf" || n.expansion === "done") && kids(s, n.id).every((c) => c.status !== "pending");

export function stats(s: Session) {
  const all = Object.values(s.nodes);
  return {
    total: all.length,
    known: all.filter((n) => n.status === "known").length,
    learned: all.filter((n) => n.status === "learned").length,
    pending: all.filter((n) => n.status === "pending").length,
    locked: all.filter((n) => lockedIn(n)).length,
  };
}

// ---------- mapping ----------

export const setExpansion = (s: Session, id: string, expansion: TNode["expansion"], error?: string) =>
  patch(s, id, { expansion, error });

export function applyDecomposition(s: Session, id: string, r: DecomposeResult): Session {
  const n = s.nodes[id];
  const isRoot = id === s.rootId;
  const named: Partial<TNode> = {
    title: isRoot || !n.title ? r.title : n.title,
    description: n.description || r.description,
    forceSplit: undefined,
    error: undefined,
  };
  if (r.atomic || r.components.length === 0) return patch(s, id, { ...named, expansion: "leaf" });

  const children = r.components.map((c) => makeNode(id, c.title, c.description));
  const next = patch(s, id, { ...named, expansion: "triage", children: children.map((c) => c.id) });
  return { ...next, nodes: { ...next.nodes, ...Object.fromEntries(children.map((c) => [c.id, c])) } };
}

/** Record which of a node's components I already understand. The rest get broken down in turn. */
export function applyTriage(s: Session, id: string, knownIds: string[]): Session {
  const tooDeep = depth(s, id) + 1 >= MAX_DEPTH;
  let next = patch(s, id, { expansion: "done" });
  for (const c of kids(s, id)) {
    if (c.status !== "pending" || c.expansion !== "none") continue; // already settled on an earlier pass
    next = knownIds.includes(c.id)
      ? patch(next, c.id, { status: "known" })
      : tooDeep ? patch(next, c.id, { expansion: "leaf" }) : next;
  }
  return next;
}

/** Ask for a node to be split into smaller pieces, even if it was judged small enough to teach directly. */
export const breakDown = (s: Session, id: string) =>
  patch(s, id, { status: "pending", expansion: "none", forceSplit: true, chat: [] });

/** Stale in-flight markers after a reload. */
export function normalize(s: Session): Session {
  let next = s;
  for (const n of Object.values(s.nodes)) if (n.expansion === "loading") next = patch(next, n.id, { expansion: "none" });
  return next;
}

// ---------- learning ----------

export const setChat = (s: Session, id: string, chat: ChatMessage[]) => patch(s, id, { chat });

export const markLearned = (s: Session, id: string) => patch(s, id, { status: "learned", reviewNote: undefined });

/** "I don't understand this after all": relearn it (or break it down, if it never was). */
export const markUnlearned = (s: Session, id: string, note?: string) =>
  patch(s, id, { status: "pending", chat: [], reviewNote: note });

/**
 * Record an "explain it back" attempt. A pass locks the explanation in. A fail sends me back one
 * level: the node and the components the check found shaky turn gray again and are re-taught.
 * Returns the ids I was sent back to.
 */
export function applyValidation(s: Session, id: string, text: string, r: ValidateResult): { session: Session; sentBackTo: string[] } {
  const n = s.nodes[id];
  const attempt: Attempt = { text, passed: r.passed, feedback: r.feedback, gaps: r.gaps, at: Date.now() };
  let next = patch(s, id, { attempts: [...n.attempts, attempt] });
  if (r.passed) return { session: markLearned(next, id), sentBackTo: [] };

  const note = [r.feedback, ...r.gaps.map((g) => `- ${g}`)].join("\n");
  next = markUnlearned(next, id, note);
  const weak = r.weakComponents.map((i) => n.children[i]).filter(Boolean);
  for (const c of weak) {
    next = markUnlearned(next, c, `While explaining "${n.title}", these gaps showed up:\n${r.gaps.map((g) => `- ${g}`).join("\n") || r.feedback}`);
  }
  return { session: next, sentBackTo: weak };
}

// ---------- layout ----------

export interface Placed {
  node: TNode;
  /** Column (depth) and row (fractional, in leaf units). */
  col: number;
  row: number;
}

/** Left-to-right tidy tree: leaves take one row each, parents sit at the middle of their children. */
export function layout(s: Session): { placed: Placed[]; cols: number; rows: number } {
  const placed: Placed[] = [];
  let leaf = 0;
  let cols = 0;
  const place = (id: string, col: number): number => {
    const n = s.nodes[id];
    cols = Math.max(cols, col + 1);
    const rows = n.children.map((c) => place(c, col + 1));
    const row = rows.length ? (rows[0] + rows[rows.length - 1]) / 2 : leaf++;
    placed.push({ node: n, col, row });
    return row;
  };
  place(s.rootId, 0);
  return { placed, cols, rows: leaf };
}
