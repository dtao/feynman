import { useEffect, useMemo, useRef } from "react";
import type { Session, TNode } from "../types.ts";
import * as T from "../lib/tree.ts";

const W = 172, H = 46, GAP_X = 44, GAP_Y = 12, PAD = 16;

export function nodeClass(n: TNode): string {
  if (n.status === "pending") return n.expansion === "loading" ? "pending loading" : "pending";
  return `${n.status}${T.lockedIn(n) ? " locked" : ""}`;
}

interface Props {
  session: Session;
  /** The node the main panel is showing. */
  activeId?: string;
  onSelect: (id: string) => void;
  /** Whether the map tab is showing (phones). Used to re-centre on the active node when it opens. */
  visible?: boolean;
}

export function TreeView({ session, activeId, onSelect, visible }: Props) {
  const { placed, cols, rows } = useMemo(() => T.layout(session), [session]);
  const pos = useMemo(
    () => new Map(placed.map((p) => [p.node.id, { x: PAD + p.col * (W + GAP_X), y: PAD + p.row * (H + GAP_Y) }])),
    [placed],
  );
  const width = PAD * 2 + cols * W + (cols - 1) * GAP_X;
  const height = PAD * 2 + rows * H + (rows - 1) * GAP_Y;

  const activeRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    activeRef.current?.scrollIntoView({ block: "center", inline: "center", behavior: "smooth" });
  }, [activeId, placed.length, visible]);

  const st = T.stats(session);
  const done = st.known + st.learned;

  return (
    <section className="tree-panel" aria-label="Map of the topic">
      <header className="tree-head">
        <div className="progress" role="progressbar" aria-valuemin={0} aria-valuemax={st.total} aria-valuenow={done}>
          <div className="progress-bar" style={{ width: `${st.total ? (done / st.total) * 100 : 0}%` }} />
        </div>
        <div className="tree-meta">
          <span>{done} of {st.total} understood</span>
          <span className="legend">
            <span><i className="dot pending" /> to learn</span>
            <span><i className="dot known" /> already knew</span>
            <span><i className="dot learned" /> understood</span>
            <span><i className="dot learned locked" /> confirmed</span>
          </span>
        </div>
      </header>
      <div className="tree-scroll">
        <div className="tree" style={{ width, height }}>
          <svg width={width} height={height} aria-hidden="true">
            {placed.filter((p) => p.node.parentId).map((p) => {
              const a = pos.get(p.node.parentId!)!;
              const b = pos.get(p.node.id)!;
              const x1 = a.x + W, y1 = a.y + H / 2, x2 = b.x, y2 = b.y + H / 2, mx = (x1 + x2) / 2;
              return (
                <path
                  key={p.node.id}
                  className={`link ${p.node.status === "pending" ? "pending" : "lit"}`}
                  d={`M${x1},${y1} C${mx},${y1} ${mx},${y2} ${x2},${y2}`}
                />
              );
            })}
          </svg>
          {placed.map(({ node }) => {
            const { x, y } = pos.get(node.id)!;
            const active = node.id === activeId;
            return (
              <button
                key={node.id}
                ref={active ? activeRef : undefined}
                className={`tnode ${nodeClass(node)}${active ? " active" : ""}`}
                style={{ left: x, top: y, width: W, height: H }}
                onClick={() => onSelect(node.id)}
                title={node.description || node.title}
              >
                <span className="tnode-title">{node.title || "…"}</span>
                {T.lockedIn(node) && <span className="badge" aria-label="confirmed">✓</span>}
              </button>
            );
          })}
        </div>
      </div>
    </section>
  );
}
