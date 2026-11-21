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
cp .env.example .env      # then put your key in ANTHROPIC_API_KEY
npm run dev               # http://localhost:5173
```

For a production build: `npm run build && npm start`.

To try the interface without a key or API calls, `npm run dev:mock` serves canned breakdowns and lessons.

| Variable | Default | |
|---|---|---|
| `ANTHROPIC_API_KEY` | | Read by the Anthropic SDK. |
| `FEYNMAN_MODEL` | `claude-opus-5-5` | Model used for breakdowns, lessons and checks. |
| `PORT` | `5173` | |
| `FEYNMAN_MOCK` | | `1` for canned responses. |

## How it's built

- `server/` is a small Express server. `llm.ts` holds the three Claude calls and their prompts: `decompose`
  (structured output), `teach` (streamed) and `validate` (structured output). `mock.ts` is the canned stand-in.
- `src/lib/tree.ts` is the whole learning model as pure functions over a session: mapping, lesson order,
  what a failed check resets, and the tree layout. `tree.test.ts` covers it (`npm test`).
- `src/components/` is the React UI. Topics, lessons and your explanations are stored in the browser's
  `localStorage`; the server keeps no state.
