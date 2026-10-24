# Documentation

Welcome to the Wildcards Manager documentation. Start with the path that matches
what you are trying to do.

## Using the app

- **[Getting started](getting-started.md)** — install, open the sample library,
  understand the workspace tabs (wildcards / LoRAs / checkpoints / prompts /
  generation / search), edit safely, and build a package.
- **[User guide](user-guide.md)** — complete guide to the graph, filters,
  diagnostics, editor, refactors, undo/backups, expansion, simulation,
  LoRA/checkpoint managers, Prompts / Generation, Civitai browse (models +
  Images), Hugging Face, library sidecars, and in-app updates.
- **[Supported syntax](syntax.md)** — exact wildcard, glob, variant, weight,
  multi-select, comment, and `# NO VALIDATION` behavior; compatibility limits.
- **[Troubleshooting](troubleshooting.md)** — common startup, graph, validation,
  editing, Civitai (SFW/NSFW site + API key, Images, downloads), model folders /
  symlinks, library sidecars, in-app updates, watcher, packaging, and platform
  problems.

## Understanding the project

- **[Product](product.md)** — audience, problems, principles, current scope, and
  non-goals.
- **[Architecture](architecture.md)** — Electron trust boundaries, domain
  pipeline, IPC, data flow, graph model, write safety, settings, and backups.
- **[Development](development.md)** — source layout, commands, tests,
  contribution workflow, packaging, and tagged releases.
- **[Roadmap](roadmap.md)** — shipped capabilities, current priorities, later
  opportunities, and release readiness.

## Repository resources

- [`../ComfyUI-Workflow/`](../ComfyUI-Workflow/) — `comfyui-lora-training` zip
  and the sample Generation graphs (Krea 2, and SDXL / Pony / Illustrious).
  Install steps are in the
  [user guide](user-guide.md#install-the-nodes-and-the-sample-graph).
- [`../sample_wildcards/`](../sample_wildcards/) — healthy SFW example library.
- [`../fixtures/wildcards/`](../fixtures/wildcards/) — intentionally broken
  examples for diagnostics.
- [`screenshot.png`](screenshot.png) — README image; replace with a better
  capture without changing links.
- [`../RELEASE_NOTES.md`](../RELEASE_NOTES.md) — current public release (v0.9)
  overview, installation, and known limitations.
- [`../CHANGELOG.md`](../CHANGELOG.md) — version-by-version notable changes.
- [`../LICENSE.md`](../LICENSE.md) — software and sample-library licenses.

## Accuracy policy

Documentation describes the behavior in the current source tree, not every
feature available in A1111 or ComfyUI wildcard implementations. When docs and
code disagree, treat the tests and source as authoritative and please open a PR
to correct the docs.

[all-in-one.md](all-in-one.md) bundles these documents into the single help
file. Rebuild it whenever a source document changes so that copy stays current.
Its opening index is for that one file. Links such as `user-guide.md` are for
this folder; inside the bundle, follow the heading with the same title. When
this text and the source code disagree, the code wins.
