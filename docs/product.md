# Product

## Purpose

Wildcards Manager is a local desktop tool for people who maintain large
[Stable Diffusion WebUI Dynamic Prompts](https://github.com/adieyal/sd-dynamic-prompts)
or [ComfyUI Dynamic Prompts](https://github.com/adieyal/comfyui-dynamicprompts)
wildcard libraries.

Text files are easy to start and difficult to govern at scale. A mature library
can contain hundreds of nested references, globs, forwarders, variants, and
weights. Renaming one file can silently break callers; a recursion can hide
several levels deep; and uncommon branches can become effectively unreachable.
Wildcards Manager makes those relationships inspectable and changes safer.

## Who it is for

- prompt-library authors who organize reusable concepts in nested files;
- creators migrating or cleaning inherited wildcard packs;
- maintainers who need to rename, move, or remove concepts without searching by
  hand;
- users who want to understand prompt reach and balance before generating
  images;
- contributors testing wildcard syntax and tooling.

It assumes users are comfortable with plain-text wildcard files. Optional
**Generation** (ComfyUI) and **Prompts** folders support day-to-day prompting,
but the primary product surface remains library graphing, validation, and safe
refactoring.

## Core workflows

### Understand a library

Open any folder, select a wildcard as the root, and inspect direct callers,
transitive dependencies, globs, missing targets, and recursion in a focused
graph. File-role filters expose roots, leaves, standalone entries, invalid
files, and files that contain LoRA tags across the library. Optional LoRA-folder
validation warns when `<lora:…>` tags cannot be resolved. Dedicated **LoRA
files** and **Checkpoint files** tabs list installed models (including symlink
subfolders), show AutoV2 / Civitai identity, and for LoRAs reverse-link into
wildcard callers. The Civitai browser searches and downloads LoRAs/checkpoints
from **civitai.com** (SFW) or **civitai.red** (NSFW); browse works without a
key, while gated downloads need an API key from the selected site. LoRA
download categories append snippets to a chosen wildcard; Shift+click reuses
the last category. A **Search** tab covers wildcards and model filenames; a
**Prompts** tab manages prompt folders; a **Generation** tab drives ComfyUI
from typed prompts or `!gen.txt` folders. Each library is Krea 2 or SDXL.
SDXL, Pony, and Illustrious share one checkpoint graph with a replaceable
VAE, CLIP skip, and a hires pass.

### Diagnose and repair

Diagnostics keep source line, column, and token context. Users can jump to the
editor, create a missing target, remove an unresolved name throughout the
library, or use a ranked Cycle Resolver.

### Refactor safely

The app supports editing, creating, rename/move, deleting with inbound-reference
cleanup, forwarder consolidation, and target absorption. Plans are previewed;
exact references are rewritten as a grouped operation; each file write uses
atomic replace, changes are backed up on a best-effort basis, and many
mutations remain undoable within the session (see the user guide for which
operations currently clear history).

### Preview behavior

Bounded exhaustive expansion answers “what can this prompt produce?” Seeded
random expansion makes examples reproducible. Monte Carlo simulation answers
“how often does this branch get reached?” and highlights imbalanced siblings.

## Product principles

1. **Local-first.** The selected folder is the canonical library. No account,
   cloud service, or central database is required. Archive, Maybe, Notify, and
   LoRA categories travel in `categories.json` inside that library’s shelf folder,
   sibling `<basename>.wcm/libraries/<library id>/`. Archive, Maybe, and Notify
   are the other files in that folder. Each library’s Civitai catalog is
   `<basename>.wcm/cache/civitai-catalog/<library id>/`. Those files are not
   in AppData. LoRA/checkpoint roots use in-tree `!.wcm/` / `!Thumbnails/`.
2. **Explain before changing.** Mutating refactors show impact, affected files,
   and warnings before confirmation.
3. **Reversible by default.** App writes use per-file atomic replace, attempt
   a pre-change backup, and keep an in-session undo stack where the UI does
   not reopen the library afterward.
4. **Analysis remains useful at scale.** Validation runs over the full
   dependency graph while the UI draws a focused, depth- and breadth-capped view.
5. **Be precise about compatibility.** The app documents its Dynamic Prompts
   subset rather than claiming parity with every A1111/ComfyUI implementation.
6. **Keep domain logic portable.** Parsing, analysis, expansion, simulation,
   and refactor planning remain pure TypeScript outside Electron/React.

## Current scope

Shipped today:

- recursive `.txt` indexing plus parsed YAML/JSON global mapping keys;
- dependency graph with direct callers and focused navigation;
- missing, glob, cycle, variant, wildcard, and empty-file diagnostics;
- CodeMirror source viewing/editing and issue navigation;
- create, rename/move, delete, consolidate, absorb, and targeted quick fixes;
- 50-entry session undo/redo and disk backups;
- seeded random and bounded exhaustive text/YAML/JSON expansion;
- seeded Monte Carlo reach/balance analysis;
- persisted recent roots, last file, panel width, and simulation defaults;
- Windows x64 NSIS installer, built and attached by the tagged release workflow
  (macOS and Linux are not published or tested);
- Civitai browser for LoRAs/checkpoints (`civitai.com` SFW / `civitai.red` NSFW;
  API key required for many gated downloads; queued downloads, categories,
  Shift+click, extra comment/prompt, download console);
- LoRA and Checkpoint file managers (list, filters, identity, embedded page,
  LoRA reverse-refs and training-step series; symlink-aware folder walk);
- Global search across wildcards and model folders; Prompts workspace; Generation
  tab (ComfyUI + LT node pack, per-library and per-style KSampler options,
  reproducible seeds). Each library chooses Krea 2 or SDXL. The SDXL graph is
  one checkpoint for SDXL, Pony, and Illustrious, with VAE override, CLIP skip,
  and hires fix;
- Civitai Images / Videos Download all with feed frontiers and Browse catch-up;
- Library Manager (multiple libraries, path migration), LoRA training-series
  previews, LM Studio prompt assist, checkpoint ratings, blocked authors;
- Per-library sidecars (shelf files under `.wcm/libraries/<library id>/`,
  a catalog folder per library id, model-root `!.wcm` / `!Thumbnails`);
- a deterministic, validated, SFW sample library.

See [roadmap.md](roadmap.md) for planned work.

## Boundaries and non-goals

- It does not claim to be a full ComfyUI or AUTOMATIC1111 front-end; Generation
  is a focused queue + workflow helper, not a studio replacement.
- It is not a ComfyUI custom node or AUTOMATIC1111 extension.
- It does not claim complete `sd-dynamic-prompts` syntax compatibility.
- YAML/JSON nested keys cannot yet be renamed or edited as independent
  refactor targets.
- It does not silently modify a library or rewrite ambiguous glob expressions.
- It is not a hosted library synchronization or collaboration service.
- It does not currently provide persistent undo history, signed installers,
  auto-update, folder-level refactors, split/merge, or bulk cleanup.

## Success criteria

The product succeeds when a maintainer can open an unfamiliar library, identify
its structure and faults, perform a broad rename or cleanup confidently, verify
that the graph remains valid, and undo if the result is wrong—without resorting
to manual global search/replace.
