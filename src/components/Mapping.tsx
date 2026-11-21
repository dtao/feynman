import { useState } from "react";
import type { Session, TNode } from "../types.ts";
import * as T from "../lib/tree.ts";

interface Props {
  session: Session;
  update: (fn: (s: Session) => Session) => void;
}

/** The mapping phase: sort each breakdown into "know it" / "don't", until every unknown piece is found. */
export function Mapping({ session, update }: Props) {
  const queue = T.triageQueue(session);
  const all = Object.values(session.nodes);
  const loading = [...all.filter((n) => n.expansion === "loading"), ...T.nodesToExpand(session)];
  const failed = all.filter((n) => n.expansion === "error");

  return (
    <>
      {queue[0] && <Triage key={queue[0].id} session={session} node={queue[0]} remaining={queue.length - 1} update={update} />}
      {failed.map((n) => (
        <div key={n.id} className="card note error">
          Couldn't break down <b>{n.title || "your topic"}</b>: {n.error}{" "}
          <button className="link-btn" onClick={() => update((s) => T.setExpansion(s, n.id, "none"))}>Try again</button>
        </div>
      ))}
      {loading.length > 0 && (
        <div className={queue[0] ? "side-status" : "card"}>
          <p className="thinking">
            {T.root(session).title
              ? <>Breaking down {loading.map((n) => n.title).filter(Boolean).join(", ") || "the next piece"}…</>
              : <>Working out what "{session.goal}" is built from…</>}
          </p>
        </div>
      )}
    </>
  );
}

function Triage({ session, node, remaining, update }: Props & { node: TNode; remaining: number }) {
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
      {!isRoot && <div className="crumbs">{[...T.ancestors(session, node.id), node].map((a) => a.title).join("  ›  ")}</div>}
      <h1>{node.title}</h1>
      {node.description && <p className="lede">{node.description}</p>}
      <p>
        {isRoot ? "It's built from these pieces. " : "To understand this, you need these pieces. "}
        <b>Tick the ones you already understand</b>; everything else gets broken down further.
      </p>
      <ul className="choices">
        {open.map((c) => (
          <li key={c.id}>
            <label className={known.has(c.id) ? "checked" : ""}>
              <input type="checkbox" checked={known.has(c.id)} onChange={() => toggle(c.id)} />
              <span>
                <b>{c.title}</b>
                <small>{c.description}</small>
              </span>
            </label>
          </li>
        ))}
      </ul>
      <div className="actions">
        <button className="btn primary" onClick={() => update((s) => T.applyTriage(s, node.id, [...known]))}>
          {known.size === 0 ? "I don't know any of these yet" : known.size === open.length ? "I know all of these" : `Continue (${known.size} known)`}
        </button>
        {remaining > 0 && <span className="muted">{remaining} more to sort after this</span>}
      </div>
    </article>
  );
}
