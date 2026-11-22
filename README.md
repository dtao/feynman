# Feynman

An app for learning complex things by breaking them down until you hit what you already know, then building back up.

1. **Say what you want to understand.** The app identifies the topic and breaks it into components.
2. **Tick what you already understand.** The app then goes depth-first: it takes the first component you don't
   know, breaks it down, asks again, and keeps descending until it reaches a piece small enough to teach directly.
3. **Learn bottom-up, one branch at a time.** Lessons start at the lowest pieces and work up, each building on
   the pieces beneath it. A component is fully understood before the next one is even broken down.
4. **Say whether it landed.** After each lesson you choose "I understand" or "I don't understand". If you don't,
   you can ask a question about the lesson or have the piece broken down further.
5. **Confirm it with a question (optional).** When you say you understand, the app asks one question about the
   piece. A good answer locks it in, and your answer is saved so you can reread it later. A poor one sends you
   back one level: the components your answer was shaky on turn gray again and are re-taught (or broken down,
   if you had said you already knew them). You can skip the question, and you can answer it later for any piece
   on the map, including the topic as a whole at the end.
6. **Watch the map light up.** The tree of everything you need starts gray and turns green as you understand
   each piece. At the end it is a picture of everything you learned.

## Run it

Requires Node 22+ and an [Anthropic API key](https://console.anthropic.com/).

```bash
npm install
npm run dev               # http://localhost:5173
```

The app asks for your key the first time and keeps it in the browser. To try the interface without a key,
`npm run dev:mock` uses canned breakdowns and lessons.

## Host it

Feynman is a static site with no server. `npm run build` writes it to `dist/`, which can be served from any static
host and from any folder (asset paths are relative).

`.github/workflows/deploy.yml` builds and publishes it to GitHub Pages on every push to `main`. For that to work,
the repository's Pages source (Settings → Pages) must be set to "GitHub Actions".

Set `VITE_FEYNMAN_MODEL` at build time to use a model other than `claude-opus-5-5`.

## Your API key

The browser calls the Anthropic API directly, so each person uses their own key and pays for their own usage.
The key is stored in that browser's `localStorage` and sent only to `api.anthropic.com`. Any script that runs
on the page could read it, so:

- Use a dedicated key with a spend limit, and revoke it if in doubt. "API key → Forget key" removes it from the browser.
- The production build ships a Content-Security-Policy that allows only the app's own scripts and connections
  only to the Anthropic API. Model-written lesson text is sanitized before it is rendered.
- Host it on its own origin (its own domain or subdomain). `localStorage` is shared by everything on an origin,
  so on a shared one such as `username.github.io`, other sites under that name could read the key.

## How it's built

- `src/lib/llm.ts` holds the three Claude calls and their prompts: `decompose` (structured output), `teach`
  (streamed) and `validate` (structured output). `mock.ts` is the canned stand-in.
- `src/lib/tree.ts` is the whole learning model as pure functions over a session: mapping, lesson order,
  what a failed check resets, and the tree layout. `tree.test.ts` covers it (`npm test`).
- `src/components/` is the React UI. Topics, lessons and your explanations are stored in the browser's
  `localStorage`.
