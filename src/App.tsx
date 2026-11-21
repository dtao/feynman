import { useCallback, useEffect, useRef, useState } from "react";
import type { Session, ValidateResult } from "./types.ts";
import * as T from "./lib/tree.ts";
import * as api from "./lib/api.ts";
import { loadCurrent, loadKey, loadSessions, saveCurrent, saveKey, saveSessions } from "./lib/store.ts";
import { KeyDialog } from "./components/KeyDialog.tsx";
import { Home } from "./components/Home.tsx";
import { Mapping } from "./components/Mapping.tsx";
import { NodeView } from "./components/NodeView.tsx";
import { TreeView } from "./components/TreeView.tsx";

const MAX_PARALLEL_BREAKDOWNS = 4;

interface Verdict {
  title: string;
  result: ValidateResult;
  sentBackTo: string[];
}

export function App() {
  const [sessions, setSessions] = useState<Session[]>(loadSessions);
  const [currentId, setCurrentId] = useState<string | null>(loadCurrent);
  const [selected, setSelected] = useState<{ id: string; explain?: boolean } | null>(null);
  const [verdict, setVerdict] = useState<Verdict | null>(null);
  /** On a phone the lesson and the map are separate tabs; on a wide screen both are always visible. */
  const [tab, setTab] = useState<"main" | "map">("main");
  const [apiKey, setApiKey] = useState(loadKey);
  const [keyOpen, setKeyOpen] = useState(!api.isMock && !loadKey());
  const mock = api.isMock;
  /** Model calls can be made: there is a key, or responses are canned. */
  const ready = mock || !!apiKey;

  const session = sessions.find((s) => s.id === currentId) ?? null;

  useEffect(() => saveSessions(sessions), [sessions]);
  useEffect(() => saveCurrent(currentId), [currentId]);

  const updateById = useCallback(
    (id: string, fn: (s: Session) => Session) => setSessions((all) => all.map((s) => (s.id === id ? fn(s) : s))),
    [],
  );
  const update = useCallback((fn: (s: Session) => Session) => { if (currentId) updateById(currentId, fn); }, [currentId, updateById]);

  // Break down every unknown piece as soon as it is identified.
  const inFlight = useRef(new Set<string>());
  useEffect(() => {
    if (!session || !ready) return;
    const sid = session.id;
    for (const n of T.nodesToExpand(session)) {
      if (inFlight.current.size >= MAX_PARALLEL_BREAKDOWNS) break;
      if (inFlight.current.has(n.id)) continue;
      inFlight.current.add(n.id);
      const ctx = T.contextFor(session, n.id);
      updateById(sid, (s) => T.setExpansion(s, n.id, "loading"));
      api.decompose(ctx).then(
        (r) => { inFlight.current.delete(n.id); updateById(sid, (s) => T.applyDecomposition(s, n.id, r)); },
        (e: Error) => { inFlight.current.delete(n.id); updateById(sid, (s) => T.setExpansion(s, n.id, "error", e.message)); },
      );
    }
  }, [session, ready, updateById]);

  function open(id: string | null) {
    setCurrentId(id);
    setTab("main");
    setSelected(null);
    setVerdict(null);
  }

  function start(goal: string) {
    if (!ready) return setKeyOpen(true);
    const s = T.newSession(goal);
    setSessions((all) => [...all, s]);
    open(s.id);
  }

  function changeKey(key: string) {
    saveKey(key);
    setApiKey(key);
    setKeyOpen(false);
  }
  const keyDialog = <KeyDialog open={keyOpen} current={apiKey} onSave={changeKey} onClose={() => setKeyOpen(false)} />;
  const onKey = mock ? undefined : () => setKeyOpen(true);

  function onVerdict(nodeId: string, text: string, result: ValidateResult) {
    if (!session) return;
    const { session: next, sentBackTo } = T.applyValidation(session, nodeId, text, result);
    updateById(session.id, () => next);
    setVerdict({ title: session.nodes[nodeId].title, result, sentBackTo: sentBackTo.map((id) => session.nodes[id].title) });
    setSelected(null);
  }

  if (!session) {
    return (
      <div className="shell">
        <TopBar mock={mock} hasKey={!!apiKey} onKey={onKey} />
        <Home sessions={sessions} onStart={start} onOpen={open} onDelete={(id) => setSessions((all) => all.filter((s) => s.id !== id))} />
        {keyDialog}
      </div>
    );
  }

  const step = T.nextStep(session);
  const ph = T.phase(session);
  const rootNode = T.root(session);
  const next = step.kind === "learn" ? step.node : undefined;
  const picked = selected && session.nodes[selected.id] ? session.nodes[selected.id] : undefined;
  const shown = picked ?? next;
  const st = T.stats(session);

  let main: React.ReactNode;
  if (verdict) {
    main = <VerdictCard verdict={verdict} onContinue={() => setVerdict(null)} />;
  } else if (shown) {
    main = (
      <>
        {picked && (
          <button className="link-btn back" onClick={() => setSelected(null)}>
            ← {ph === "complete" ? "Back to the summary" : ph === "mapping" ? "Back to where I was" : "Back to the current lesson"}
          </button>
        )}
        {!picked && <div className="step">Lesson</div>}
        <NodeView
          key={`${shown.id}:${selected?.explain ? "x" : ""}`}
          session={session}
          node={shown}
          update={update}
          onVerdict={onVerdict}
          startExplaining={picked ? selected?.explain : false}
        />
      </>
    );
  } else if (ph === "mapping") {
    main = (
      <>
        <div className="step">{step.kind === "triage" ? "What do you already know?" : "Breaking it down"}</div>
        <Mapping session={session} step={step} update={update} />
      </>
    );
  } else {
    const locked = T.lockedIn(rootNode);
    main = (
      <article className="card summary">
        <div className="step">Complete</div>
        <h1>You've built up to {rootNode.title}</h1>
        <p className="lede">
          {st.learned} {st.learned === 1 ? "piece" : "pieces"} learned here, {st.known} you already knew, {st.locked} explained back and locked in.
          The map shows everything you now understand; select any piece to revisit it or explain it back.
        </p>
        {locked ? (
          <div className="locked-box">
            <b>Your locked-in explanation of {rootNode.title}</b>
            <p>{locked.text}</p>
          </div>
        ) : (
          <p>
            <b>One optional last step:</b> explain {rootNode.title} in your own words. If the explanation has gaps, you'll be sent back
            one level to shore them up.
          </p>
        )}
        <div className="actions">
          <button className="btn primary" onClick={() => setSelected({ id: rootNode.id, explain: true })}>
            {locked ? "Explain it again" : `Explain ${rootNode.title}`}
          </button>
          <button className="btn ghost" onClick={() => open(null)}>Start another topic</button>
        </div>
      </article>
    );
  }

  return (
    <div className="shell">
      <TopBar mock={mock} hasKey={!!apiKey} onKey={onKey} title={rootNode.title || session.goal} onHome={() => open(null)} />
      {!ready && (
        <div className="banner">
          Add your Anthropic API key to continue. <button className="link-btn" onClick={() => setKeyOpen(true)}>Add key</button>
        </div>
      )}
      {keyDialog}
      <nav className="tabs" role="tablist" aria-label="View">
        <button role="tab" aria-selected={tab === "main"} onClick={() => setTab("main")}>
          {ph === "complete" && !picked ? "Summary" : "Lesson"}
        </button>
        <button role="tab" aria-selected={tab === "map"} onClick={() => setTab("map")}>
          Map <span className="tab-count">{st.known + st.learned}/{st.total}</span>
        </button>
      </nav>
      <div className={`workspace ${ph} show-${tab}`}>
        <main className="main">{main}</main>
        <TreeView
          session={session}
          visible={tab === "map"}
          activeId={verdict ? undefined : (shown ?? (step.kind !== "done" ? step.node : undefined))?.id}
          onSelect={(id) => { setVerdict(null); setSelected({ id }); setTab("main"); }}
        />
      </div>
    </div>
  );
}

function TopBar({ mock, hasKey, onKey, title, onHome }: { mock: boolean; hasKey: boolean; onKey?: () => void; title?: string; onHome?: () => void }) {
  return (
    <header className="topbar">
      <button className="brand" onClick={onHome} disabled={!onHome}>Feynman</button>
      <span className="topbar-title">{title}</span>
      {mock && <span className="chip warn" title="Canned lessons, no AI calls (VITE_MOCK=1)">Mock mode</span>}
      {onHome && <button className="link-btn" onClick={onHome}>All topics</button>}
      {onKey && <button className="link-btn" onClick={onKey}>{hasKey ? "API key" : "Add API key"}</button>}
    </header>
  );
}

function VerdictCard({ verdict, onContinue }: { verdict: Verdict; onContinue: () => void }) {
  const { result, title, sentBackTo } = verdict;
  return (
    <article className={`card verdict ${result.passed ? "pass" : "fail"}`}>
      <div className="step">{result.passed ? "Locked in" : "Not quite yet"}</div>
      <h1>{result.passed ? `You understand ${title}` : `Let's shore up ${title}`}</h1>
      <p>{result.feedback}</p>
      {result.gaps.length > 0 && (
        <ul>{result.gaps.map((g) => <li key={g}>{g}</li>)}</ul>
      )}
      {!result.passed && (
        <p className="note">
          {sentBackTo.length
            ? <>Going back one level to review <b>{sentBackTo.join(", ")}</b>, then {title} again.</>
            : <>You'll go through {title} again with these gaps in focus. If it still doesn't land, break it down further.</>}
        </p>
      )}
      <p className="muted">Your explanation is saved with this piece either way.</p>
      <div className="actions">
        <button className="btn primary" autoFocus onClick={onContinue}>Continue</button>
      </div>
    </article>
  );
}
