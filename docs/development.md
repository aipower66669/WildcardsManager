# Development guide

## Prerequisites

- Node.js 22.12+
- npm
- Git
- A desktop environment capable of running Electron

Install exactly from the lockfile:

```powershell
npm ci
```

## Commands

| Command | Purpose |
| --- | --- |
| `npm run dev` | Electron-Vite development mode |
| `npm run build` | Build main, preload, and renderer into `out/` |
| `npm run preview` | Preview the production Electron bundle |
| `npm run typecheck` | Strict TypeScript check without output |
| `npm test` | Run all domain tests once |
| `npm run check` | Same gates as GitHub `tests.yml` / build: typecheck then vitest |
| `npm run test:watch` | Run Vitest interactively |
| `npm run dist` | Build/package for the current OS |
| `npm run dist:win` | Windows x64 NSIS (the installer GitHub publishes) |
| `npm run dist:mac` | macOS DMG target in the electron-builder config; untested, not published |
| `npm run dist:linux` | Linux AppImage target in the electron-builder config; untested, not published |

Generated directories (`node_modules/`, `out/`, `release/`, `dist/`) are
gitignored.

## Source map

```text
src/
  domain/      pure parser, resolver, graph, expansion, simulation, plans
  main/        Electron window, IPC, filesystem, watcher, settings, mutations
  preload/     typed contextBridge implementation
  renderer/    React UI, React Flow graph, CodeMirror editor
  shared/      IPC names and DTO/API contracts
```

Important files:

- `src/shared/contracts.ts` — stable IPC vocabulary and cross-process types.
- `src/main/ipc.ts` — runtime argument checks and service dispatch.
- `src/main/libraryService.ts` — authorized root and filesystem operations.
- `src/main/mutationService.ts` — grouped writes, backups, undo/redo.
- `src/main/refactorService.ts` — pure-plan-to-mutation orchestration.
- `src/main/libraryLocalState.ts` — sibling `<basename>.wcm/library.json`.
- `src/main/libraryDataMigration.ts` — AppData → folder-sidecar migration.
- `src/main/wildcardsSidecarMigration.ts` — in-tree `!.wcm`/`!Cache` → sibling.
- `src/domain/librarySidecarPaths.ts` — wildcards sibling `.wcm` + model-root
  `!.wcm` / `!Thumbnails` paths.
- `src/domain/buildGraph.ts` — dependency traversal and diagnostics.
- `src/domain/expand.ts` — exhaustive/random expansion and simulation.
- `src/renderer/App.tsx` — main product workflow.
- `src/renderer/WildcardEditor.tsx` — editor integration.
- `src/renderer/CivitaiBrowserModal.tsx` — Civitai browse / download UI.

See [architecture.md](architecture.md) before changing process boundaries.
Schema changes to library sidecars need an idempotent migration (in-app and/or
`scripts/`) — see project Cursor rules for the access + migration policy.

## Development workflow

1. Create a focused branch.
2. Run `npm ci`.
3. Start `npm run dev`.
4. Put reusable behavior in `src/domain` whenever it does not require Electron.
5. Add/update tests for behavior changes.
6. Run:

   ```powershell
   npm run check
   npm run build
   ```

7. For renderer changes, exercise a healthy sample and broken fixture manually.
8. Describe why the PR is needed, behavioral effects, test evidence, and
   screenshots for UI changes.

## Domain conventions

### Pure planning

Potentially broad refactors should calculate a complete plan before touching
disk. Plans should contain:

- `canX` and a human-readable blocking reason;
- normalized source/target keys and paths;
- per-file replacement text and occurrence counts;
- aggregate impact;
- warnings for ambiguity (especially globs).

The main service should run/validate the plan again when applying it and use one
`applyMutation` call.

### Paths and keys

- DTO paths use `/` separators.
- Keys omit `.txt`, `.yaml`, `.yml`, `.json`.
- Never use string-prefix containment for filesystem authorization.
- Do not bypass `libraryService` for user-library writes.
- Refuse unsupported extensions.

### Diagnostics

Use issue codes from `domain/types.ts` and `shared/contracts.ts`. Preserve
one-based line/column and a concise snippet whenever available. Keep issues
navigable from the renderer.

### Compatibility

Do not assume all Dynamic Prompts implementations behave identically. Add
documented tests for each supported construct and note semantic differences in
[syntax.md](syntax.md).

## Tests

Vitest is configured for:

```text
src/domain/**/*.test.ts
```

Current suites cover:

- parsing, validation, normalization, resolution, graph/cycles;
- YAML/JSON mapping keys, source locations, expansion, simulation, and host
  refactor semantics;
- random/exhaustive expansion and Monte Carlo statistics;
- rename/delete/consolidate/absorb/reference cleanup;
- cycle grouping, ranking, and source edits;
- deterministic sample-library validity and SFW vocabulary checks.

Use small `LibraryFile` fixtures and assert plans/results rather than touching
disk in domain tests.

Gaps worth contributing:

- renderer component tests;
- IPC/service integration tests with temporary roots;
- path containment/symlink tests;
- Electron startup and packaged-app smoke tests;
- cross-platform watcher behavior;
- collision/precedence compatibility tests across multiple upstream versions.

## Sample library

`scripts/generate-sample-wildcards.mjs` deletes and deterministically rewrites
`sample_wildcards/`. Treat edits inside the generated folder as disposable;
update the generator, run it, then run tests.

```powershell
node scripts/generate-sample-wildcards.mjs
npm test
```

`sampleWildcards.test.ts` requires more than 50 files, `0main`, no missing/cycle
issues from `0main`, no invalid files, required concept branches, and no obvious
NSFW terms.

## Build architecture

`electron.vite.config.ts` builds:

- main as ESM;
- preload as CommonJS (`index.cjs`);
- renderer as React/Vite static assets.

Electron Builder reads `package.json#build`, includes only `out/**/*` and
`package.json` in the app archive, and places `sample_wildcards/` in packaged
resources.

Artifacts follow:

```text
WildcardsManager-<version>-<os>-<arch>.<ext>
```

Local `npm run dist` / `dist:win` / `dist:mac` / `dist:linux` **auto-increment
the patch** (`0.9.0` → `0.9.1`) before building so in-app **Check for update**
sees a newer installer, then **delete older** `WildcardsManager-*` artifacts in
`release/` (keeps only the current version’s `.exe` / `.blockmap` / etc.). CI
skips the bump (`GITHUB_ACTIONS` / `CI`) so tagged releases keep the version
that matches the tag. To package the current version without bumping:
`npm run dist:nobump`.

There is currently no signing certificate for the Windows installer. In-app
updates download that Windows build from GitHub Releases when Settings →
App updates has no folder. A configured `release/` folder still overrides
that and launches the installer already on disk.

## CI and releases

`.github/workflows/tests.yml` runs `npm ci`, typecheck, and tests on Windows and
Ubuntu only when a version tag (`v*`) is pushed. Branch pushes and pull
requests do not start it.

`.github/workflows/release.yml` runs on those same version tags (`v*`) and on
manual dispatch. A tag push typechecks and tests, then builds the Windows NSIS
installer (`npm run build:win`, no version bump) and attaches
`WildcardsManager-*.exe`, the blockmap, and `latest.yml` to that GitHub
Release, using `RELEASE_NOTES.md` as the body. Manual dispatch only runs the
check. macOS and Linux are not built or tested. There is no installer to
download for those systems. Running from source there might work.

Before tagging:

1. set `package.json` version to the release you want (or rely on local
   `npm run dist` patch bumps during dogfooding, then set the final
   Major.Minor.0 / .Z explicitly before the tag);
2. run tests/typecheck locally if you want them before the tag (the tag workflow
   runs them again, then builds the Windows installer);
3. move completed entries from `CHANGELOG.md`'s Unreleased section into the new
   version and update `RELEASE_NOTES.md`;
4. commit and push (include the version bump);
5. create and push the tag:

   ```powershell
   git tag v0.9.0
   git push origin v0.9.0
   ```

`CHANGELOG.md` is the permanent version history and follows Keep a Changelog.
`RELEASE_NOTES.md` is the user-facing overview for the current public release.

## Documentation

Documentation lives in `docs/`; repository-facing summary/contribution guidance
lives in `README.md`. Keep links relative. When behavior changes:

- update [user-guide.md](user-guide.md);
- update [syntax.md](syntax.md) for language semantics;
- update [architecture.md](architecture.md) for boundaries/data flow;
- move roadmap items from planned to shipped;
- rebuild [all-in-one.md](all-in-one.md) in the same change.

`all-in-one.md` is the ultimate user help file: one copy of the docs plus the
**Information for LLM models** section. Every `<!-- source: docs/... -->` block
must stay a verbatim copy of that source. Update the LLM section when a
mechanical rule (paths, seeds, settings keys, updates, generation fields)
would otherwise be wrong. A behavior or docs change is incomplete until this
file matches.

When a change adds a menu command, a persisted settings key, a diagnostic code,
or an error string a user can see, name it in the docs in that same change.
`npm test` runs `src/domain/docsCoverage.test.ts`, which fails when an
`IssueCode`, a custom application-menu label, or a library/settings field
outside that file’s UI-chrome list is missing from `docs/`. Add a new geometry
or one-time flag to the chrome list. Add a new behavior key to the key tables
in [architecture.md](architecture.md#settings-library-sidecars-and-filesystem-watching).

The README image is `docs/screenshot.png`; replacing that file preserves the
link.

## Licensing

Code and docs use PolyForm Noncommercial 1.0.0. `sample_wildcards/` uses
CC BY-NC-SA 4.0. Contributions are accepted under those applicable terms. See
[`../LICENSE.md`](../LICENSE.md).
