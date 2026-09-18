# Security

- The Nansen API key is server-only: read from `NANSEN_API_KEY` in the CLI process or the Vercel function and sent only as the `apikey` header. `packages/core/test/guard.test.ts` asserts nothing key-shaped ever appears in a verdict, a stream event, the provenance, a cache key or an error message, and that malformed input is rejected before any network call (10,000 generated cases).
- The public routes carry a spend guard (`apps/web/lib/guard.ts`): 10 checks per IP per minute, 2,000 live credits per day, then labelled fixture replays; the 200-credit agent route is POST-only, 2 per IP and 4 per day.
- Fixtures contain raw Nansen responses and never a key (`npm run check` verifies each file and the whole git history).
- Report a vulnerability by opening a private security advisory on this repository or emailing edy.cu.tjong@gmail.com. Expect a reply within 72 hours.
