# Wildcards Manager v0.7

Package version: **0.7.0**  
Release date: **October 15, 2026**

v0.7 is the first public release. It documents the full desktop app — wildcard
graph, model libraries, Civitai, generation — and fixes the test failures that
showed up on GitHub Actions.

The [user guide](docs/user-guide.md) is the complete reference. This note is the
map.

## What the app is

A desktop manager for Dynamic Prompts wildcard libraries used by
[Stable Diffusion WebUI Dynamic Prompts](https://github.com/adieyal/sd-dynamic-prompts)
and [ComfyUI Dynamic Prompts](https://github.com/adieyal/comfyui-dynamicprompts).

Open a folder. See dependencies as a graph. Fix missing files and cycles. Edit
in place. Refactor references with undo. Browse and download models. Generate
through ComfyUI from prompt folders.

Noncommercial only. See [LICENSE.md](LICENSE.md).

## Workspaces

| Tab | What you do there |
| --- | --- |
| **Wildcard files** | Graph, filters, diagnostics, editor, refactors, expansion, simulation |
| **LoRA files** | Installed LoRAs, Civitai match, wildcard callers, training-step series |
| **Checkpoint files** | Installed checkpoints, hash, rating, benchmark samples, Civitai page |
| **Prompts** | `!gen.txt` folders, validation, coverage, samples |
| **Generation** | ComfyUI queue from a typed prompt or a prompt folder |
| **Search** | Wildcard names/content and LoRA / checkpoint filenames |

## Library Manager

One app, many libraries. Each library stores its own:

- wildcards, LoRA, and checkpoint folders
- LoRA training library (`dataset.json` previews for multi-step series)
- prompts folder and separate Generation output roots for **Realistic**,
  **Hentai**, and **3D**
- checkpoint benchmark folder
- Civitai site (`civitai.com` or `civitai.red`) and validation platform

**Migrate library paths…** rewrites those pointers after you relocate a tree
(drive or parent change). It does not move the files. Preview first; override
any folder that should not follow the prefix.

Wildcard lists live in a sibling `<name>.wcm/` folder so ComfyUI Dynamic
Prompts does not scan them. Model hashes, ratings, and thumbnails stay next to
the model roots (`!.wcm/`, `!Thumbnails/`).

## Civitai and Hugging Face

- LoRA and checkpoint browse, queue, Archive / Maybe / Notify, download
  categories, Shift+click download.
- **Images** and **Videos** community feeds, Download all, and per-feed
  catch-up. Each needs its own folder in Settings.
- **Blocked authors** hide a creator’s cards for that library.
- Early-access models sit on **Notify me** until you check that they unlocked.
- Hugging Face Hub search and download queue. Gated repos need a token under
  Settings → AI.

Browse works without an API key. Many model downloads do not.

## Generation and LM Studio

Generation talks to ComfyUI through the `comfyui-lora-training` node pack in
this repo (`custom_nodes/`). Settings → AI holds the host, a launch shortcut,
and Test / Check install.

- Typed prompt or prompt-folder `!gen.txt` (optional recursive sub-folders).
- Style profiles with separate output folders.
- **Benchmark** walks checkpoint files and records timings.
- **Edit Workflow** / **Save Workflow**.
- **Categorize** appends a prompt into a folder’s `!gen.txt`.

**LM Studio** (local server) can propose edits to the open wildcard file.
Nothing is saved until you apply the proposal.

## Prompts coverage

**Coverage** expands every decoded `!gen.txt` line and reports wildcards that
are never reached or over-used. Results stay in the library sidecar. Ignore a
file to keep it off the “never used” list.

## Installation

Download an installer from the
[GitHub release](https://github.com/aipower66669/WildcardsManager/releases/tag/v0.7.0)
when one is attached, or build it yourself. Installers are unsigned.

From source (Node.js 22.12+):

```powershell
git clone https://github.com/aipower66669/WildcardsManager.git
cd WildcardsManager
npm ci
npm run dev
```

`npm run check` is the typecheck and test gate used in GitHub Actions.
`npm run dist` bumps the patch, builds a local installer into `release/`, and
drops older installers. Point **Settings → App updates** at that folder to
install from inside the app. Updates do not download from GitHub.

## Upgrading from v0.6

Libraries and sidecars do not need a manual migration for this release. If you
moved model or wildcard folders onto another drive, use Library Manager →
**Migrate library paths…** instead of editing paths by hand in every field.

Install or update `comfyui-lora-training` in ComfyUI if Generation reports
missing LT nodes.

## Known limitations

- Documented Dynamic Prompts subset only. Fuzzy globs and extension-only syntax
  can differ from A1111 or ComfyUI.
- Undo/redo does not survive a restart.
- Nested YAML/JSON keys are not independent refactor targets.
- No folder-level refactor, split/merge, bulk cleanup, or single library-health
  report yet.
- Generation is a queue plus a saved workflow, not a ComfyUI replacement.
- In-app update only runs an installer you already built into the configured
  folder.
- Installers are unsigned.

## Licensing

- Software: PolyForm Noncommercial License 1.0.0.
- `sample_wildcards/`: CC BY-NC-SA 4.0.
