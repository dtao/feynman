import { useEffect, useRef, useState } from "react";
import type { Session, TNode, ValidateResult } from "../types.ts";
import * as T from "../lib/tree.ts";
import * as api from "../lib/api.ts";
import { Inline, Markdown } from "./Markdown.tsx";

interface Props {
  session: Session;
  node: TNode;
  update: (fn: (s: Session) => Session) => void;
  onVerdict: (nodeId: string, question: string, answer: string, result: ValidateResult) => void;
  /** Open with the confirming question showing. */
  startAnswering?: boolean;
}

const STATUS_LABEL = { pending: "To learn", known: "Already knew", learned: "Understood" } as const;

/**
 * idle      – lesson shown; "I understand" / "I don't understand"
 * answering – the confirming question, with a box for the answer (skippable)
 * stuck     – ask a question about the lesson, or break the piece down
 */
type Mode = "idle" | "answering" | "stuck";

export function NodeView({ session, node, update, onVerdict, startAnswering }: Props) {
  const learnable = T.isLearnable(session, node);
  const children = T.kids(session, node.id);
  const locked = T.lockedIn(node);
  const lesson = node.chat[0] ? T.splitLesson(node.chat[0].content).body : undefined;
  const checkQuestion = T.questionFor(node);

  const [mode, setMode] = useState<Mode>(startAnswering ? "answering" : "idle");

  // ----- lesson + follow-ups (streamed) -----
  const [stream, setStream] = useState<string | null>(null);
  const [asked, setAsked] = useState<string | null>(null);
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
    setAsked(q);
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
        setAsked(null);
      });
  }

  // ----- confirming question -----
  const [answer, setAnswer] = useState("");
  const [checking, setChecking] = useState(false);
  const [checkError, setCheckError] = useState<string | null>(null);
  const [showLesson, setShowLesson] = useState(false);

  async function check(e: React.FormEvent) {
    e.preventDefault();
    const text = answer.trim();
    if (!text || checking) return;
    setChecking(true);
    setCheckError(null);
    try {
      onVerdict(node.id, checkQuestion, text, await api.validate(T.contextFor(session, node.id), lesson, checkQuestion, text));
    } catch (err) {
      setCheckError((err as Error).message);
      setChecking(false);
    }
  }

  const busy = stream !== null;
  const lessonReady = !!lesson && !(busy && node.chat.length === 0);
  const answering = mode === "answering";
  const path = T.ancestors(session, node.id);
  const breakDownButton = node.children.length === 0 && (
    <button className="btn ghost" disabled={busy} onClick={() => update((s) => T.breakDown(s, node.id))}>
      Break this down further
    </button>
  );

  return (
    <article className="card node-view">
      {path.length > 0 && <div className="crumbs">{path.map((a, i) => <span key={a.id}>{i > 0 && "  ›  "}<Inline text={a.title} /></span>)}</div>}
      <div className="node-head">
        <h1><Inline text={node.title} /></h1>
        <span className={`chip ${node.status}${locked ? " locked" : ""}`}>
          {locked ? "Confirmed ✓" : STATUS_LABEL[node.status]}
        </span>
      </div>
      {node.description && <p className="lede"><Inline text={node.description} /></p>}

      {children.length > 0 && (
        <p className="built-from">
          Built from: {children.map((c, i) => <span key={c.id}>{i > 0 && ", "}<b><Inline text={c.title} /></b></span>)}
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

      {/* While answering, the lesson is tucked away so the answer comes from understanding, not the page. */}
      {(!answering || showLesson) && (
        <div className="lesson">
          {node.chat.map((m, i) =>
            m.role === "assistant"
              ? <Markdown key={i} text={i === 0 ? T.splitLesson(m.content).body : m.content} />
              : <p key={i} className="question">{m.content}</p>,
          )}
          {asked && <p className="question">{asked}</p>}
          {busy && (stream
            ? <Markdown text={node.chat.length ? stream : T.splitLesson(stream).body} />
            : <p className="thinking">{node.chat.length ? "Thinking…" : "Preparing your lesson…"}</p>)}
        </div>
      )}

      {error && (
        <div className="note error">
          {error}{" "}
          {node.chat.length === 0 && <button className="link-btn" onClick={() => setRetry((n) => n + 1)}>Try again</button>}
        </div>
      )}

      {locked && !answering && (
        <div className="locked-box">
          <b>Your locked-in answer</b>
          {locked.question && <p className="locked-q"><Inline text={locked.question} /></p>}
          <p>{locked.text}</p>
        </div>
      )}

      {/* ----- what next ----- */}
      {answering ? (
        <form className="prompt explain" onSubmit={check}>
          <label htmlFor="answer">
            <span>{learnable ? "Answer this to confirm you've got it and lock it in. It's optional." : "Answer this to lock it in."}</span>
          </label>
          <p className="check-q"><Inline text={checkQuestion} /></p>
          <textarea
            id="answer"
            value={answer}
            onChange={(e) => setAnswer(e.target.value)}
            rows={6}
            autoFocus
            disabled={checking}
            placeholder="In your own words…"
          />
          {lesson && (
            <button type="button" className="link-btn" style={{ alignSelf: "flex-start" }} onClick={() => setShowLesson((v) => !v)}>
              {showLesson ? "Hide the lesson" : "Peek at the lesson"}
            </button>
          )}
          {checkError && <div className="note error">{checkError}</div>}
          <div className="actions">
            <button className="btn primary" disabled={checking || !answer.trim()}>
              {checking ? "Checking…" : "Check my answer"}
            </button>
            {learnable ? (
              <button type="button" className="btn" disabled={checking} onClick={() => update((s) => T.markLearned(s, node.id))}>
                Skip and continue
              </button>
            ) : (
              <button type="button" className="btn ghost" disabled={checking} onClick={() => setMode("idle")}>Cancel</button>
            )}
            {learnable && (
              <button type="button" className="btn ghost" disabled={checking} onClick={() => { setMode("idle"); setShowLesson(false); }}>
                Back to the lesson
              </button>
            )}
          </div>
        </form>
      ) : learnable ? (
        lessonReady && (
          mode === "stuck" ? (
            <div className="prompt">
              <b>What's not landing?</b>
              <form className="ask" onSubmit={ask}>
                <input
                  value={draft}
                  onChange={(e) => setDraft(e.target.value)}
                  placeholder="Ask a question about this (optional)…"
                  aria-label="Ask a question about this lesson"
                  disabled={busy}
                  autoFocus
                />
                <button className="btn" disabled={busy || !draft.trim()}>Ask</button>
              </form>
              <div className="actions">
                <button className="btn primary" disabled={busy} onClick={() => setMode("answering")}>I understand now</button>
                {breakDownButton}
              </div>
            </div>
          ) : (
            <div className="actions">
              <button className="btn primary" disabled={busy} onClick={() => setMode("answering")}>I understand</button>
              <button className="btn" disabled={busy} onClick={() => setMode("stuck")}>I don't understand</button>
            </div>
          )
        )
      ) : node.status !== "pending" ? (
        <div className="actions">
          <button className="btn primary" onClick={() => setMode("answering")}>
            {locked ? "Answer it again" : "Answer a question to lock it in"}
          </button>
          <button className="btn ghost" onClick={() => update((s) => T.markUnlearned(s, node.id))}>I need to relearn this</button>
          {breakDownButton}
        </div>
      ) : null}

      {node.attempts.length > (locked ? 1 : 0) && !answering && (
        <details className="attempts">
          <summary>Past answers ({node.attempts.length})</summary>
          {[...node.attempts].reverse().map((a) => (
            <div key={a.at} className={`attempt ${a.passed ? "pass" : "fail"}`}>
              <div className="attempt-meta">{a.passed ? "Passed" : "Not yet"} · {new Date(a.at).toLocaleString()}</div>
              {a.question && <p className="attempt-q"><Inline text={a.question} /></p>}
              <p>{a.text}</p>
              <p className="attempt-feedback"><Inline text={a.feedback} /></p>
            </div>
          ))}
        </details>
      )}
    </article>
  );
}
