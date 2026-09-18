# Contributing

1. `npm install`, `export NANSEN_API_KEY=…`, `npm run rebuttal -- "<claim>" --explain`.
2. Every rule change needs (a) a test in `packages/core/test/decide.test.ts` with live-shaped evidence, (b) `npm run verify -- --update` if a recorded verdict legitimately changes (the recorded responses are never edited), and (c) a line in `docs/SCORING.md`.
3. `npm run typecheck && npm test && npm run verify && npm run check` must be green before a PR.
4. No Nansen or Groq key ever enters the tree — `.env` is ignored, fixtures are scanned.
