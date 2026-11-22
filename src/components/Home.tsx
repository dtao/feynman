import { useState } from "react";
import type { Session } from "../types.ts";
import * as T from "../lib/tree.ts";
import { Inline } from "./Markdown.tsx";

interface Props {
  sessions: Session[];
  onStart: (goal: string) => void;
  onOpen: (id: string) => void;
  onDelete: (id: string) => void;
}

export function Home({ sessions, onStart, onOpen, onDelete }: Props) {
  const [goal, setGoal] = useState("");
  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (goal.trim()) onStart(goal);
  };
  return (
    <main className="home">
      <h1>What do you want to understand?</h1>
      <p className="lede">
        Name something complex. We'll break it down until we reach pieces you already know, then build back up, one idea at a time.
      </p>
      <form onSubmit={submit}>
        <textarea
          value={goal}
          onChange={(e) => setGoal(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) submit(e); }}
          rows={3}
          autoFocus
          placeholder="e.g. How does public-key cryptography work?"
          aria-label="What do you want to understand?"
        />
        <button className="btn primary" disabled={!goal.trim()}>Break it down</button>
      </form>

      {sessions.length > 0 && (
        <section className="topics">
          <h2>Your topics</h2>
          <ul>
            {[...sessions].sort((a, b) => b.updatedAt - a.updatedAt).map((s) => {
              const st = T.stats(s);
              const ph = T.phase(s);
              return (
                <li key={s.id}>
                  <button className="topic" onClick={() => onOpen(s.id)}>
                    <b><Inline text={T.root(s).title || s.goal} /></b>
                    <small>
                      {ph === "complete" ? "Understood" : ph === "mapping" ? "Mapping" : "Learning"} · {st.known + st.learned} of {st.total} pieces
                    </small>
                  </button>
                  <button
                    className="link-btn"
                    aria-label={`Delete ${T.root(s).title || s.goal}`}
                    onClick={() => { if (confirm(`Delete "${T.root(s).title || s.goal}" and everything you recorded in it?`)) onDelete(s.id); }}
                  >
                    Delete
                  </button>
                </li>
              );
            })}
          </ul>
        </section>
      )}
    </main>
  );
}
