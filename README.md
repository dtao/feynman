# Feynman

An app for learning complex things by breaking them down until you hit what you already know, then building back up.

1. **Say what you want to understand.** The app identifies the topic and breaks it into components.
2. **Tick what you already understand.** Every component you don't know is broken down again, recursively, until
   every unknown piece is small enough to teach directly.
3. **Learn bottom-up.** Lessons start at the lowest pieces and work up to the topic, each one building on the
   pieces beneath it. You can ask follow-up questions, or ask for a piece to be broken down further.
4. **Watch the map light up.** The tree of everything you need starts gray and turns green as you understand
   each piece. At the end it is a picture of everything you learned.
5. **Explain it back (optional, at any level).** Write the idea in your own words and the app checks it. A pass
   locks your explanation in so you can reread it later. A fail sends you back one level: the components your
   explanation was shaky on turn gray again and are re-taught (or broken down, if you had said you already knew them).

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
