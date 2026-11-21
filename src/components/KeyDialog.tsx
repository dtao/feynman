import { useEffect, useRef, useState } from "react";

interface Props {
  open: boolean;
  current: string;
  onSave: (key: string) => void;
  onClose: () => void;
}

const mask = (key: string) => `${key.slice(0, 10)}…${key.slice(-4)}`;

export function KeyDialog({ open, current, onSave, onClose }: Props) {
  const ref = useRef<HTMLDialogElement>(null);
  const [draft, setDraft] = useState("");

  useEffect(() => {
    const d = ref.current!;
    if (open && !d.open) {
      setDraft("");
      d.showModal();
    } else if (!open && d.open) {
      d.close();
    }
  }, [open]);

  const trimmed = draft.trim();
  const looksWrong = trimmed !== "" && !trimmed.startsWith("sk-ant-");

  return (
    <dialog ref={ref} className="key-dialog" onClose={onClose}>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (trimmed) onSave(trimmed);
        }}
      >
        <h2>Anthropic API key</h2>
        <p>
          This app has no server. Breakdowns, lessons and checks are requested straight from your browser to the Anthropic API, using
          your key and billed to your account.
        </p>
        <p className="muted">
          The key is kept in this browser's local storage and sent only to api.anthropic.com. Anything that can run scripts on this
          page, such as a browser extension, could read it, so use a dedicated key with a spend limit that you can revoke.
        </p>
        {current && <p className="note">Saved key: <code>{mask(current)}</code></p>}
        <input
          type="password"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder={current ? "Paste a new key to replace it" : "sk-ant-…"}
          aria-label="Anthropic API key"
          autoComplete="off"
          spellCheck={false}
          autoFocus
        />
        {looksWrong && <p className="muted">Anthropic keys normally start with "sk-ant-". You can save it anyway.</p>}
        <div className="actions">
          <button className="btn primary" disabled={!trimmed}>Save key</button>
          {current && <button type="button" className="btn ghost" onClick={() => onSave("")}>Forget key</button>}
          <button type="button" className="btn ghost" onClick={onClose}>{current ? "Close" : "Not now"}</button>
        </div>
      </form>
    </dialog>
  );
}
