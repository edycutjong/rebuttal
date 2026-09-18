# Contributing

1. `npm install`, `export NANSEN_API_KEY=…`, `npm run rebuttal -- "<claim>" --explain`.
2. Every rule change needs (a) a test in `packages/core/test/decide.test.ts` with live-shaped evidence, (b) `npm run verify -- --update` if a recorded verdict legitimately changes (the recorded responses are never edited), and (c) a line in `docs/SCORING.md`.
3. `npm run ci` (typecheck core + web, tests with coverage, `verify`, readiness) and `npm run build` must be green before a PR.
4. No Nansen or Groq key ever enters the tree — `.env` is ignored, fixtures are scanned.
5. **Commit messages are [Conventional Commits](https://www.conventionalcommits.org/)** — they drive the version number: `feat:` → minor, `fix:` / `perf:` → patch, a `!` after the type or a `BREAKING CHANGE:` footer → major; `docs:`, `chore:`, `ci:`, `build:`, `test:`, `refactor:` → no release. Scopes are free (`fix(resolve): …`).

## Releases

Two paths, one algorithm (`.github/workflows/release.yml` and `scripts/release.mjs` are the same steps):

- **Automatic** — `release.yml` runs after the *CI/CD Pipeline* workflow succeeds on `main`: last `v*` tag → Conventional-Commit scan → `scripts/bump-version.mjs` bumps the root, every workspace `package.json` and the lockfile → `npm ci --ignore-scripts` proves the lockfile → commit `chore(release): vX.Y.Z [skip ci]` → annotated tag → GitHub Release with generated notes. `[skip ci]` keeps the bump commit from re-running CI.
- **Local** — `npm run release` runs the identical steps from a clean checkout of `main` (`main == origin/main`, `gh` authenticated); `npm run release -- --dry-run` prints the computed bump and the releasable commits without changing anything. Use it whenever Actions is unavailable to the repo.

The web footer reads `package.json` at build time, so the deployed site shows the tag it was built from. `release.yml` dispatches the CI/CD Pipeline on the version commit, so production carries the new tag; after a local `npm run release`, redeploy yourself (`vercel build --prod && vercel deploy --prebuilt --prod`, then re-alias) so the footer matches the latest tag.
