import { describe, expect, it } from "vitest";
import * as T from "./tree.ts";
import type { DecomposeResult, Session } from "../types.ts";

const split = (title: string, parts: string[]): DecomposeResult => ({
  title, description: `${title}.`, atomic: false,
  components: parts.map((p) => ({ title: p, description: `${p}.` })),
});
const atomic = (title: string): DecomposeResult => ({ title, description: "", atomic: true, components: [] });
const byTitle = (s: Session, t: string) => Object.values(s.nodes).find((n) => n.title === t)!;

/** Root → [A (known), B → [B1, B2], C (leaf)] */
function mapped(): Session {
  let s = T.newSession("I want to understand X");
  s = T.applyDecomposition(s, s.rootId, split("X", ["A", "B", "C"]));
  s = T.applyTriage(s, s.rootId, [byTitle(s, "A").id]);
  s = T.applyDecomposition(s, byTitle(s, "B").id, split("B", ["B1", "B2"]));
  s = T.applyDecomposition(s, byTitle(s, "C").id, atomic("C"));
  s = T.applyTriage(s, byTitle(s, "B").id, []);
  s = T.applyDecomposition(s, byTitle(s, "B1").id, atomic("B1"));
  s = T.applyDecomposition(s, byTitle(s, "B2").id, atomic("B2"));
  return s;
}

describe("mapping", () => {
  it("starts by breaking down the root", () => {
    const s = T.newSession("x");
    expect(T.phase(s)).toBe("mapping");
    expect(T.nodesToExpand(s).map((n) => n.id)).toEqual([s.rootId]);
  });

  it("waits for triage before breaking down components, then skips the known ones", () => {
    let s = T.newSession("x");
    s = T.applyDecomposition(s, s.rootId, split("X", ["A", "B"]));
    expect(T.root(s).title).toBe("X");
    expect(T.nodesToExpand(s)).toEqual([]);
    expect(T.nextStep(s)).toMatchObject({ kind: "triage", node: { title: "X" } });
    s = T.applyTriage(s, s.rootId, [byTitle(s, "A").id]);
    expect(T.nodesToExpand(s).map((n) => n.title)).toEqual(["B"]);
    expect(byTitle(s, "A").status).toBe("known");
  });

  it("stops recursing at the depth cap", () => {
    let s = T.newSession("x");
    let id = s.rootId;
    for (let d = 0; d < T.MAX_DEPTH; d++) {
      s = T.applyDecomposition(s, id, split(`L${d}`, [`L${d + 1}`]));
      s = T.applyTriage(s, id, []);
      id = s.nodes[id].children[0];
    }
    expect(s.nodes[id].expansion).toBe("leaf");
    expect(T.phase(s)).toBe("learning");
  });

  it("goes depth-first: finishes one component before breaking down the next", () => {
    let s = T.newSession("x");
    s = T.applyDecomposition(s, s.rootId, split("X", ["A", "B"]));
    s = T.applyTriage(s, s.rootId, []);
    // Both siblings are requested, but A's breakdown is what the learner waits for.
    expect(T.nodesToExpand(s).map((n) => n.title)).toEqual(["A", "B"]);
    expect(T.nextStep(s)).toMatchObject({ kind: "wait", node: { title: "A" } });

    // B arriving first does not jump the queue.
    s = T.applyDecomposition(s, byTitle(s, "B").id, split("B", ["B1"]));
    expect(T.nextStep(s)).toMatchObject({ kind: "wait", node: { title: "A" } });

    s = T.applyDecomposition(s, byTitle(s, "A").id, split("A", ["A1", "A2"]));
    expect(T.nextStep(s)).toMatchObject({ kind: "triage", node: { title: "A" } });
    s = T.applyTriage(s, byTitle(s, "A").id, [byTitle(s, "A2").id]);
    s = T.applyDecomposition(s, byTitle(s, "A1").id, atomic("A1"));

    // A1 is taught while B is still unsorted, then A itself, and only then B.
    expect(T.nextStep(s)).toMatchObject({ kind: "learn", node: { title: "A1" } });
    expect(T.phase(s)).toBe("learning");
    s = T.markLearned(s, byTitle(s, "A1").id);
    expect(T.nextStep(s)).toMatchObject({ kind: "learn", node: { title: "A" } });
    s = T.markLearned(s, byTitle(s, "A").id);
    expect(T.nextStep(s)).toMatchObject({ kind: "triage", node: { title: "B" } });
    expect(T.phase(s)).toBe("mapping");
  });

  it("finds unlearned pieces beneath something already understood", () => {
    let s = mapped();
    for (let st = T.nextStep(s); st.kind === "learn"; st = T.nextStep(s)) s = T.markLearned(s, st.node.id);
    s = T.markUnlearned(s, byTitle(s, "B1").id);
    expect(T.nextStep(s)).toMatchObject({ kind: "learn", node: { title: "B1" } });
  });
});

describe("learning", () => {
  it("teaches bottom-up and finishes at the root", () => {
    let s = mapped();
    const order: string[] = [];
    for (let st = T.nextStep(s); st.kind === "learn"; st = T.nextStep(s)) {
      order.push(st.node.title);
      s = T.markLearned(s, st.node.id);
    }
    expect(order).toEqual(["B1", "B2", "B", "C", "X"]);
    expect(T.phase(s)).toBe("complete");
    expect(T.stats(s)).toMatchObject({ total: 6, known: 1, learned: 5, pending: 0 });
  });

  it("gives the model the node's place in the tree", () => {
    const s = mapped();
    const ctx = T.contextFor(s, byTitle(s, "B1").id);
    expect(ctx.path).toEqual(["X", "B"]);
    expect(ctx.depth).toBe(2);
    expect(ctx.known).toEqual(["A"]);
    expect(ctx.existing).not.toContain("B1");
  });
});

describe("confirming with a question", () => {
  const learnAll = (s: Session) => {
    for (let st = T.nextStep(s); st.kind === "learn"; st = T.nextStep(s)) s = T.markLearned(s, st.node.id);
    return s;
  };
  const fail = (weak: number[]) => ({ passed: false, feedback: "Not quite.", gaps: ["gap"], weakComponents: weak });

  it("locks in a passing explanation", () => {
    let s = mapped();
    const id = byTitle(s, "B1").id;
    s = T.applyValidation(s, id, "Q?", "my words", { passed: true, feedback: "Yes.", gaps: [], weakComponents: [] }).session;
    expect(s.nodes[id].status).toBe("learned");
    expect(T.lockedIn(s.nodes[id])?.text).toBe("my words");
  });

  it("sends me back one level on a fail", () => {
    let s = learnAll(mapped());
    const b = byTitle(s, "B");
    const r = T.applyValidation(s, b.id, "Q?", "hmm", fail([1]));
    s = r.session;
    expect(r.sentBackTo).toEqual([byTitle(s, "B2").id]);
    expect(byTitle(s, "B").status).toBe("pending");
    expect(byTitle(s, "B2").status).toBe("pending");
    expect(byTitle(s, "B1").status).toBe("learned");
    expect(T.lockedIn(byTitle(s, "B"))).toBeUndefined();
    expect(byTitle(s, "B").attempts).toHaveLength(1);
    expect(T.phase(s)).toBe("learning");
    expect(T.nextStep(s)).toMatchObject({ kind: "learn", node: { title: "B2" } });
  });

  it("breaks down a component I claimed to know when the check shows I don't", () => {
    let s = learnAll(mapped());
    s = T.applyValidation(s, s.rootId, "Q?", "hmm", fail([0])).session;
    expect(byTitle(s, "A").status).toBe("pending");
    expect(T.phase(s)).toBe("mapping");
    expect(T.nodesToExpand(s).map((n) => n.title)).toEqual(["A"]);
  });

  it("re-teaches a leaf with the feedback as a note", () => {
    let s = learnAll(mapped());
    const id = byTitle(s, "C").id;
    s = T.applyValidation(s, id, "Q?", "hmm", fail([])).session;
    expect(s.nodes[id]).toMatchObject({ status: "pending", expansion: "leaf", chat: [] });
    expect(s.nodes[id].reviewNote).toContain("Not quite.");
    expect(T.nextStep(s)).toMatchObject({ kind: "learn", node: { id } });
  });

  it("can break a leaf down further on request", () => {
    let s = mapped();
    const id = byTitle(s, "C").id;
    s = T.breakDown(s, id);
    expect(T.nodesToExpand(s).map((n) => n.title)).toEqual(["C"]);
    expect(T.contextFor(s, id).forceSplit).toBe(true);
    s = T.applyDecomposition(s, id, split("C", ["C1"]));
    expect(s.nodes[id].forceSplit).toBeUndefined();
  });
});

describe("lesson questions", () => {
  it("splits the confirming question off the lesson", () => {
    expect(T.splitLesson("Body text.\n\n===CHECK===\nWhy does it work?")).toEqual({ body: "Body text.", question: "Why does it work?" });
  });
  it("hides a marker that is still streaming in", () => {
    expect(T.splitLesson("Body text.\n===CH").body).toBe("Body text.");
    expect(T.splitLesson("Body text.\n===CHECK===").body).toBe("Body text.");
  });
  it("reads the question from older lessons", () => {
    expect(T.splitLesson("Body.\n\n### Check yourself\nWhy?")).toEqual({ body: "Body.", question: "Why?" });
  });
  it("falls back to asking for an explanation", () => {
    const s = mapped();
    expect(T.questionFor(byTitle(s, "A"))).toContain("Explain A in your own words");
    const withLesson = T.setChat(s, byTitle(s, "C").id, [{ role: "assistant", content: "Body.\n===CHECK===\nWhy C?" }]);
    expect(T.questionFor(byTitle(withLesson, "C"))).toBe("Why C?");
  });
});

describe("layout", () => {
  it("gives each leaf a row and centres parents", () => {
    const s = mapped();
    const { placed, cols, rows } = T.layout(s);
    expect(cols).toBe(3);
    expect(rows).toBe(4);
    const at = (t: string) => placed.find((p) => p.node.title === t)!;
    expect(at("B").row).toBe((at("B1").row + at("B2").row) / 2);
    expect(at("X").col).toBe(0);
  });
});
