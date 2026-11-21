import { useEffect, useRef, useState } from "react";
import type { Session, TNode, ValidateResult } from "../types.ts";
import * as T from "../lib/tree.ts";
import * as api from "../lib/api.ts";
import { Markdown } from "./Markdown.tsx";

interface Props {
  session: Session;
  node: TNode;
  update: (fn: (s: Session) => Session) => void;
  onVerdict: (nodeId: string, text: string, result: ValidateResult) => void;
  /** Open with the "explain it back" box showing. */
  startExplaining?: boolean;
}

const STATUS_LABEL = { pending: "To learn", known: "Already knew", learned: "Understood" } as const;

export function NodeView({ session, node, update, onVerdict, startExplaining }: Props) {
  const learnable = T.isLearnable(session, node);
  const children = T.kids(session, node.id);
  const locked = T.lockedIn(node);
  const lesson = node.chat[0]?.content;

  // ----- lesson + follow-ups (streamed) -----
  const [stream, setStream] = useState<string | null>(null);
  const [question, setQuestion] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [retry, setRetry] = useState(0);
  const abortRef = useRef<AbortController | null>(null);
  useEffect(() => () => abortRef.current?.abort(), []);

  const needsLesson = learnable && node.chat.length === 0;
  useEffect(() => {
    if (!needsLesson) return;
    const ac = new AbortController();
    setStream("");
    setError(null);
    api
      .teach(T.contextFor(session, node.id), [], (d) => setStream((t) => (t ?? "") + d), ac.signal)
      .then((full) => {
        update((s) => T.setChat(s, node.id, [{ role: "assistant", content: full }]));
        setStream(null);
      })
      .catch((e: Error) => {
        if (ac.signal.aborted) return;
        setStream(null);
        setError(e.message);
      });
    return () => ac.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [needsLesson, node.id, retry]);

  function ask(e: React.FormEvent) {
    e.preventDefault();
    const q = draft.trim();
    if (!q || stream !== null) return;
    const ac = new AbortController();
    abortRef.current = ac;
    setDraft("");
    setQuestion(q);
    setStream("");
    setError(null);
    const chat = [...node.chat, { role: "user" as const, content: q }];
    api
      .teach(T.contextFor(session, node.id), chat, (d) => setStream((t) => (t ?? "") + d), ac.signal)
      .then((full) => update((s) => T.setChat(s, node.id, [...chat, { role: "assistant", content: full }])))
      .catch((e: Error) => {
        if (ac.signal.aborted) return;
        setDraft(q);
        setError(e.message);
      })
      .finally(() => {
        setStream(null);
        setQuestion(null);
      });
  }

  // ----- explain it back -----
  const [explaining, setExplaining] = useState(!!startExplaining);
  const [explanation, setExplanation] = useState("");
  const [checking, setChecking] = useState(false);
  const [checkError, setCheckError] = useState<string | null>(null);
  const [showLesson, setShowLesson] = useState(true);

  async function check(e: React.FormEvent) {
    e.preventDefault();
    const text = explanation.trim();
    if (!text || checking) return;
    setChecking(true);
    setCheckError(null);
    try {
      onVerdict(node.id, text, await api.validate(T.contextFor(session, node.id), lesson, text));
    } catch (err) {
      setCheckError((err as Error).message);
      setChecking(false);
    }
  }

  const busy = stream !== null;
  const canExplain = learnable ? !!lesson && !busy : node.status !== "pending";
  const path = T.ancestors(session, node.id);

  return (
    <article className="card node-view">
      {path.length > 0 && <div className="crumbs">{path.map((a) => a.title).join("  ›  ")}</div>}
      <div className="node-head">
        <h1>{node.title}</h1>
        <span className={`chip ${node.status}${locked ? " locked" : ""}`}>
          {locked ? "Explained back ✓" : STATUS_LABEL[node.status]}
        </span>
      </div>
      {node.description && <p className="lede">{node.description}</p>}

      {children.length > 0 && (
        <p className="built-from">
          Built from: {children.map((c, i) => <span key={c.id}>{i > 0 && ", "}<b>{c.title}</b></span>)}
        </p>
      )}

      {node.status === "pending" && !learnable && (
        <p className="note">
          {children.some((c) => c.status === "pending")
            ? "You'll come back to this once you understand the pieces it's built from."
            : "This is still being broken down."}
        </p>
      )}

      {node.reviewNote && node.status === "pending" && (
        <div className="note warn">
          <b>From your last check</b>
          <Markdown text={node.reviewNote} />
        </div>
      )}

      {/* While explaining, the lesson is hidden so the explanation comes from memory. */}
      {explaining && lesson ? (
        <button className="link-btn" onClick={() => setShowLesson((v) => !v)}>
          {showLesson ? "Hide the lesson while I write" : "Peek at the lesson"}
        </button>
      ) : null}

      {(!explaining || showLesson) && (
        <div className="lesson">
          {node.chat.map((m, i) =>
            m.role === "assistant" ? <Markdown key={i} text={m.content} /> : <p key={i} className="question">{m.content}</p>,
          )}
          {question && <p className="question">{question}</p>}
          {busy && (stream ? <Markdown text={stream} /> : <p className="thinking">{node.chat.length ? "Thinking…" : "Preparing your lesson…"}</p>)}
        </div>
      )}

      {error && (
        <div className="note error">
          {error}{" "}
          {node.chat.length === 0 && <button className="link-btn" onClick={() => setRetry((n) => n + 1)}>Try again</button>}
        </div>
      )}

      {learnable && lesson && !explaining && (
        <form className="ask" onSubmit={ask}>
          <input
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder="Ask a question about this…"
            aria-label="Ask a follow-up question"
            disabled={busy}
          />
          <button className="btn ghost" disabled={busy || !draft.trim()}>Ask</button>
        </form>
      )}

      {locked && !explaining && (
        <div className="locked-box">
          <b>Your locked-in explanation</b>
          <p>{locked.text}</p>
        </div>
      )}

      {explaining ? (
        <form className="explain" onSubmit={check}>
          <label htmlFor="explanation">
            <b>Explain {node.title} in your own words</b>
            <span>Write as if teaching someone new to it. Your explanation is saved, and if it holds up it's locked in.</span>
          </label>
          <textarea
            id="explanation"
            value={explanation}
            onChange={(e) => setExplanation(e.target.value)}
            rows={7}
            autoFocus
            disabled={checking}
            placeholder="In plain language: what is it, how does it work, and why does it matter?"
          />
          {checkError && <div className="note error">{checkError}</div>}
          <div className="actions">
            <button className="btn primary" disabled={checking || !explanation.trim()}>
              {checking ? "Checking…" : "Check my explanation"}
            </button>
            <button type="button" className="btn ghost" disabled={checking} onClick={() => setExplaining(false)}>Cancel</button>
          </div>
        </form>
      ) : (
        <div className="actions">
          {learnable && (
            <button className="btn primary" disabled={!lesson || busy} onClick={() => update((s) => T.markLearned(s, node.id))}>
              I understand this
            </button>
          )}
          {canExplain && (
            <button className={`btn ${learnable ? "" : "primary"}`} onClick={() => { setExplaining(true); setShowLesson(false); }}>
              {locked ? "Explain it again" : "Explain it back to lock it in"}
            </button>
          )}
          {node.children.length === 0 && (learnable || node.status !== "pending") && (
            <button className="btn ghost" disabled={busy} onClick={() => update((s) => T.breakDown(s, node.id))}>
              Break this down further
            </button>
          )}
          {node.status !== "pending" && (
            <button className="btn ghost" onClick={() => update((s) => T.markUnlearned(s, node.id))}>
              I need to relearn this
            </button>
          )}
        </div>
      )}

      {node.attempts.length > (locked ? 1 : 0) && !explaining && (
        <details className="attempts">
          <summary>Past explanations ({node.attempts.length})</summary>
          {[...node.attempts].reverse().map((a) => (
            <div key={a.at} className={`attempt ${a.passed ? "pass" : "fail"}`}>
              <div className="attempt-meta">{a.passed ? "Passed" : "Not yet"} · {new Date(a.at).toLocaleString()}</div>
              <p>{a.text}</p>
              <p className="attempt-feedback">{a.feedback}</p>
            </div>
          ))}
        </details>
      )}
    </article>
  );
}
