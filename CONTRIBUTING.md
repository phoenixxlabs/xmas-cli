# Contributing

```
npm install
npm run build
npm test
```

The end-to-end tests spawn xmas inside a ConPTY, so they run on Windows. Everything else is
platform-neutral.

- Format with `npm run format` before committing; CI runs `format:check`.
- Keep effects subtle. They must never cover text, and there is no emoji and no garland strip.
- Changes to how something looks should come with a screenshot from `node scripts/shot.mjs`.
- Scene detection (`src/scene.ts`) is advisory: if it fails, an effect should go quiet rather than break
  the session.
- A change to the agent's argv belongs in `src/agent.ts` with a case in `test/config.test.ts`.
