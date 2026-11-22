import { useState } from "react";
import type { Session, TNode } from "../types.ts";
import * as T from "../lib/tree.ts";
import { Inline } from "./Markdown.tsx";

interface Props {
  session: Session;
  update: (fn: (s: Session) => Session) => void;
}

/** Sorting a breakdown into "know it" / "don't", or waiting for the next breakdown to arrive. */
export function Mapping({ session, step, update }: Props & { step: T.Step }) {
  const failed = Object.values(session.nodes).filter((n) => n.expansion === "error");
  return (
    <>
      {step.kind === "triage" && <Triage key={step.node.id} session={session} node={step.node} update={update} />}
      {failed.map((n) => (
        <div key={n.id} className="card note error">
          Couldn't break down <b><Inline text={n.title || "your topic"} /></b>: {n.error}{" "}
          <button className="link-btn" onClick={() => update((s) => T.setExpansion(s, n.id, "none"))}>Try again</button>
        </div>
      ))}
      {step.kind === "wait" && step.node.expansion !== "error" && (
        <div className="card">
          <p className="thinking">
            {step.node.title ? <>Breaking down <Inline text={step.node.title} />…</> : <>Working out what "{session.goal}" is built from…</>}
          </p>
        </div>
      )}
    </>
  );
}

function Triage({ session, node, update }: Props & { node: TNode }) {
  const children = T.kids(session, node.id);
  // Components settled on an earlier pass (possible after a re-breakdown) are not asked about again.
  const open = children.filter((c) => c.status === "pending" && c.expansion === "none");
  const [known, setKnown] = useState<Set<string>>(new Set());
  const isRoot = node.id === session.rootId;
  const toggle = (id: string) =>
    setKnown((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });

  return (
    <article className="card triage">
      {!isRoot && <div className="crumbs">{[...T.ancestors(session, node.id), node].map((a, i) => <span key={a.id}>{i > 0 && "  ›  "}<Inline text={a.title} /></span>)}</div>}
      <h1><Inline text={node.title} /></h1>
      {node.description && <p className="lede"><Inline text={node.description} /></p>}
      <p>
        {isRoot ? "It's built from these pieces. " : "To understand this, you need these pieces. "}
        <b>Tick the ones you already understand</b>. You'll work through the rest one at a time, each broken down as far as it needs.
      </p>
      <ul className="choices">
        {open.map((c) => (
          <li key={c.id}>
            <label className={known.has(c.id) ? "checked" : ""}>
              <input type="checkbox" checked={known.has(c.id)} onChange={() => toggle(c.id)} />
              <span>
                <b><Inline text={c.title} /></b>
                <small><Inline text={c.description} /></small>
              </span>
            </label>
          </li>
        ))}
      </ul>
      <div className="actions">
        <button className="btn primary" onClick={() => update((s) => T.applyTriage(s, node.id, [...known]))}>
          {known.size === 0 ? "I don't know any of these yet" : known.size === open.length ? "I know all of these" : `Continue (${known.size} known)`}
        </button>
      </div>
    </article>
  );
}
