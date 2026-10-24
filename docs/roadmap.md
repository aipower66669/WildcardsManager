# Roadmap

The project has moved well beyond its original read-only MVP. This roadmap is
organized by current product value rather than preserving obsolete phase labels.

Status key: **Shipped**, **Next**, **Later**, **Considering**.

## Shipped

### Library browsing and graph

- Recursive indexing of `.txt`, `.yaml`, `.yml`, and `.json`.
- Recent roots, startup restoration, and last-root-file persistence.
- Root selection, direct-caller nodes, transitive dependency graph.
- Focused view with ancestor path, depth/breadth-capped cone, `+N more` frontiers
  nodes, minimap, pan/zoom, and click-to-center without zoom changes.
- Persisted Default grid and optimized Dagre layered graph layouts.
- Filters for all, roots, leaves, standalone, empty/invalid files, and files
  with LoRA tags.
- Optional user-configured LoRA folder with `<lora:name:weight>` existence
  warnings.
- Debounced filesystem refresh and manual Rebuild.
- Civitai browser (v0.2+): `civitai.com` (SFW) / `civitai.red` (NSFW) site
  picker; optional API key for gated downloads; detachable window; category and
  architecture filters; Archive / Maybe / Notify me lists; download
  categories, queue UI, LoRA clipboard snippets, Shift+click quick queue,
  optional extra comment/prompt, and download console.
- Large-catalog browse (v0.3+): paged on-disk cache, windowed cards, local
  search, AutoV2 installed matching, Archive shown, card size control; slim
  AutoV2 index; cover-crop thumbs with full CDN bytes kept for new downloads.
- LoRA / Checkpoint file managers (main tabs): folder lists with symlink /
  junction follow-through; used/unused and Civitai filters; identity + previews;
  embedded model page; LoRA reverse-refs into wildcards; training-step series;
  checkpoint hash `.txt` sidecars for AutoV2.
- LoRA download categories (v0.4): folder + wildcard + weights; Set/Edit as
  Category from a selected wildcard.
- Persistent download queue with Queued tab and pause/resume (v0.4).
- Library sidecars: wildcards data in sibling `<basename>.wcm/` (outside the
  ComfyUI DP scan tree); LoRA/checkpoint `!.wcm` / `!Thumbnails`; AppData holds
  pointers only.
- Global **Search** tab / launcher (wildcards + models).
- **Prompts** workspace — folder CRUD, `!gen.txt` validation, collapsible
  samples (v0.6).
- **Generation** tab — ComfyUI queue, Edit/Save Workflow, style profiles,
  categorize into prompts (v0.6). v0.8 adds per-style Options (CLIP, VAE,
  KSampler), a fixed seed that repeats on Once and Infinite, and an optional
  New output subfolder. v0.9 puts style, checkpoint, seed, and size on the
  Prompts title bar (synced with Generation), steps width and height to
  common sizes whose sides are multiples of 16, and samples prompt coverage
  the way a real run does (folder-uniform walks, Rare tab, Simulation
  iteration count). v0.9 also stores `generationFamily` per library (`krea2`
  or `sdxl`). SDXL, Pony, and Illustrious share one checkpoint graph: VAE
  override, CLIP skip (default 2), upscaler, scale factor, and hires denoise.
  Sampler and Scheduler show the Comfy name, underscores included. Generation
  parameters and Options are saved per library and per style.
- **Civitai Images and Videos** browse/download/archive + background Download
  all (v0.5); feed frontiers / Browse catch-up (v0.6).
- **Library Manager** with multiple libraries, per-style generation output
  roots, a per-library generation family (Krea 2 or SDXL), checkpoint
  benchmark folder, LoRA training library, and path migration when a tree
  moves (documented in v0.7; family in v0.9).
- **LM Studio** prompt assist on the wildcard editor (local server; writes only
  after you apply a proposal).
- Checkpoint half-star ratings; blocked Civitai authors.
- **Hugging Face Hub** browser and download queue (v0.5). v0.9 matches the
  Civitai download dialog (category, extra categories, weights, extra comment,
  extra prompt), stores the Hub page on the downloaded file, and shows a
  portrait sample image on the card when the repo has one.
- **In-app updates** from GitHub Releases by default, with **What's new**
  release notes before install. A local electron-builder `release/` folder
  still overrides that, including **What's new**, which then reads
  `RELEASE_NOTES.md` and does not contact GitHub (folder support shipped in
  v0.5; GitHub in v0.8).

### Validation and diagnostics

- Missing exact references and unmatched globs.
- Direct and indirect cycle detection using active traversal paths.
- Unclosed wildcard, unbalanced brace, malformed multiselect, orphan pipe, and
  empty/comment-only file diagnostics.
- Source line/column navigation.
- First-line `# NO VALIDATION` escape hatch.
- Create-missing and remove-missing-reference actions.
- Cycle Resolver with SCC grouping, ranked edge removals, impact estimates,
  reachability warnings, and before/after preview.

### Editing and refactoring

- CodeMirror editor with `.txt`, YAML, and JSON highlighting, search, and
  wildcard-key completion after `__`.
- Atomic writes constrained to the authorized root.
- Create and delete with exact inbound-reference cleanup.
- Rename/move with collision checks and exact reference rewriting.
- Consolidate forwarder and Absorb target/keep name workflows.
- Glob-impact warnings; ambiguous globs are never rewritten silently.
- Grouped undo/redo (50 entries per session).
- Best-effort timestamped pre-mutation backups with manifests.

### Analysis

- Seeded random `.txt` expansion with weights.
- Bounded exhaustive expansion, nested variants/wildcards, globs, multi-select,
  custom separators, recursion protection, and copy-out.
- Saturating combination estimates and 2,000-result cap.
- Seeded Monte Carlo simulation (up to 1,000,000 runs).
- Node hit/visit/reach statistics, parent shares, and sibling-balance overlay.

### Structured YAML/JSON

- Strict document parsing and validation with source-aware diagnostics.
- Global nested mapping paths as first-class graph nodes, independent of the
  physical filename.
- Exact key-path verification and duplicate-key detection across documents.
- Scalar/list expansion and Monte Carlo simulation, including nested references.
- Defined host-file refactor semantics: rename preserves mapping keys; delete
  cleans references to owned keys; nested-key edits remain manual.
- Manual fixtures and domain compatibility tests for YAML and JSON.

### Quality, samples, and distribution

- Domain tests for parsing/graph, expansion/simulation, refactors, cycle fixes,
  and the shipped sample library.
- Deterministic 69-file SFW `sample_wildcards/` with `0main`.
- Windows NSIS packaging. electron-builder also lists macOS DMG and Linux
  AppImage targets; those are not built, not tested, and not published.
- Test workflow on Windows and Ubuntu when a version tag (`v*`) is pushed.
  Branch pushes and pull requests do not start it.
- Tagged `v*` release workflow: Windows NSIS installer attached to the GitHub
  Release (`RELEASE_NOTES.md` is the body).
- User/developer documentation and README screenshot.
- PolyForm Noncommercial licensing for code and CC BY-NC-SA for sample content.

## Next priorities

### 1. Dedicated library health report

- Unused/unreachable files from one or more chosen roots.
- Root candidates and disconnected components.
- Forwarder chains and redundant aliases.
- Cycle groups independent of a selected root.
- Missing-reference summary grouped by target and caller.
- Exportable report (JSON/Markdown) for CI or issue attachments.

The existing file-role filters and simulation data provide much of the domain
foundation but not a single report.

### 2. Refactor breadth

- Split selected lines into a new wildcard and insert a reference.
- Merge multiple files with caller rewrites and deduplication preview.
- Rename/move a folder prefix across all contained keys.
- Multi-file selection and batch operations.
- Opt-in cleanup actions: trim, remove blank duplicates, sort, normalize EOL.
- Preview every operation as a diff before applying.

### 3. Recovery and history

- Persist undo/redo metadata across restarts.
- In-app backup browser and restore workflow.
- Configurable backup retention/cleanup.
- Surface backup failures instead of silently continuing with only a best-effort
  guarantee.
- Optional library change log.

### 4. Compatibility test matrix

- Golden fixtures from supported A1111/ComfyUI syntax.
- Explicit tests for known semantic differences (especially globbing).
- Versioned compatibility document by extension.
- Optional compatibility mode where semantics can be selected.
- Better diagnostics for recognized-but-unsupported constructs.

## Later improvements

### User experience

- Adjustable graph depth settings.
- Further large-library graph profiling (depth/breadth caps, viewport culling,
  and dagre/minimap thresholds already shipped).
- Better keyboard navigation and accessibility audit.
- Tabs or history for recently inspected roots/nodes.
- In-app find callers/find references (global Search covers filename/content;
  dedicated callers UX still later).
- Configurable themes and font sizes.
- Replace placeholder screenshot and add short animated demonstrations.
- Deeper Generation UX (batch presets, history browser, multi-workflow profiles).

### Analysis and validation

- Distribution comparison between expected weights and Monte Carlo results.
- Seeded prompt snapshots for regression testing a library.
- Library-level lint configuration.
- Duplicate/near-duplicate content detection.

### Integration

- Command-line validator/report generator using the pure domain engine.
- CI action for wildcard-library repositories.
- Import/export helpers for common collection layouts.
- Optional extension APIs, without turning the desktop app itself into a
  ComfyUI/A1111 plugin.

## Release and project readiness

Already available: Windows installer workflow, artifacts, README, detailed
docs, dual licensing, contribution guidance, changelog, and v0.2 release notes.

Still needed for a polished public release:

- replace the placeholder copyright holder with the legal name/organization;
- finish Windows icon packaging and signing (icons landed in-tree);
- code-sign the Windows build;
- test first tagged artifacts on clean machines;
- add issue and PR templates;
- optionally add dependency/update automation;
- consider auto-update only after signing and release channels are stable.

## Explicit non-goals

- Image generation or model execution.
- Becoming a ComfyUI custom node or AUTOMATIC1111 extension.
- Claiming support for every Dynamic Prompts/Jinja/extension feature.
- Silent mutation or automatic glob rewriting.
- Cloud-hosted library storage, accounts, or collaboration.
- Commercial use under the repository's current license without a separate
  agreement.

## Safety invariants

Future write features should preserve the current rules:

1. user action and a readable preview before broad mutation;
2. paths constrained to the selected real root;
3. supported wildcard extensions only;
4. atomic writes;
5. one grouped history entry per user operation;
6. pre-change backup attempt;
7. graph/list refresh and revalidation after mutation;
8. ambiguous patterns reported, never guessed.
