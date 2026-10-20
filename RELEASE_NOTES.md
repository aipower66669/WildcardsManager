# Wildcards Manager v0.8

Package version: **0.8.0**  
Release date: **October 20, 2026**

v0.8 is a Generation release. A fixed seed now repeats the same image on Once
and Infinite, each style has its own Options (CLIP, VAE, and KSampler), and
the New output subfolder is optional.

The [user guide](docs/user-guide.md) is the complete reference. This note is the
map.

## What’s new in v0.8

- **Same seed, same image.** Once and Infinite use one pick. The seed chooses
  the prompt folder (when the dropdown is Select… [Randomize], or Recursive is
  on) and the `!gen.txt` line. The Last output crosshair copies only the seed.
- **Seed 0 or below** rolls from the clock on every image, so a failed Infinite
  run does not repeat the same seed. The dice sets −1. The shuffle button
  writes one fixed random number.
- **Empty `!gen.txt`** names the folder. Infinite skips that image and
  continues.
- **Generation and Options** sit under Realistic, Anime, and 3D. Options holds
  CLIP, VAE, Steps, CFG, Sampler, Scheduler, and Denoise. Each style keeps its
  own values.
- New LT nodes: **LT · Steps**, **LT · CFG**, **LT · Sampler**,
  **LT · Scheduler**. **LT · Denoise** fills KSampler denoise. Replace
  `custom_nodes/comfyui-lora-training`, restart ComfyUI, wire those inputs,
  then **Save Workflow**. A blank Sampler or Scheduler leaves the name already
  on the node.
- **Settings → AI → Save folder-mode images in a New subfolder** is off by
  default. Folder mode writes `{style output}/{prompt folder}`, plus `/New`
  only when that option is on. The ComfyUI save node creates the folder.
- Labels and the Once / Infinite / Cancel buttons have tooltips. Recursive
  sits on the Prompt folder line. Workflow status sits next to Edit Workflow.

## Upgrading from v0.7

Libraries and sidecars do not need a migration. Generation settings you already
saved stay on Realistic, Anime, and 3D. New sampler fields start at 20 steps,
CFG 7, and denoise 1 until you set them.

Replace the ComfyUI `comfyui-lora-training` folder with
`ComfyUI-Workflow/comfyui-lora-training.zip` and restart ComfyUI before using
the KSampler nodes. The sample graph does not wire those five inputs yet.

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

Generation talks to a ComfyUI you already run. Settings → AI holds the host,
a launch shortcut, and Test / Check install. The node pack and a ready graph
are in [`ComfyUI-Workflow/`](ComfyUI-Workflow/):

The sample graph is a Krea 2 example. Another architecture needs the graph
adapted in ComfyUI before you save it.

1. Unzip `comfyui-lora-training.zip` and `comfyui-custom-save-node.zip`
   (`SaveImageToFolder`) into ComfyUI `custom_nodes/` and restart.
2. Install the other packs that sample graph uses (Dynamic Prompts,
   [LoRA tag loader](https://github.com/badjeff/comfyui_lora_tag_loader),
   [Corza LoRA loader](https://github.com/CoreyCorza/comfyui-lora-loader),
   [Krea 2 enhancer](https://github.com/capitan01R/ComfyUI-Krea2T-Enhancer)).
3. Open `WildcardManager-ComfyUI-Generation-Workflow.json` in ComfyUI. Change
   the UNET, CLIP, and VAE filenames if your Krea 2 files differ.
4. In the app, **Test** (server only), **Generation → Save Workflow**, then
   **Check install** (saved graph only). Queue a typed prompt or a prompt
   folder.

Step-by-step: [user guide](docs/user-guide.md#install-the-nodes-and-the-sample-graph).

- Typed prompt or prompt-folder `!gen.txt`. Recursive includes sub-folders.
  A fixed seed repeats the folder and the line.
- Style profiles (Realistic, Anime, 3D), each with Generation and Options.
- **Benchmark** walks checkpoint files and records timings.
- **Edit Workflow** / **Save Workflow**. The toolbar stays quiet when the
  graph is ready and names missing nodes when it is not.
- **Categorize** appends a prompt into a folder’s `!gen.txt`.
- **Substitutions** replace prompt text for a checkpoint name before wildcards
  expand. Rules stay in that library’s `library.json`.

**LM Studio** (local server) can propose edits to the open wildcard file.
Nothing is saved until you apply the proposal.

## Prompts coverage

**Coverage** expands every decoded `!gen.txt` line and reports wildcards that
are never reached or over-used. Results stay in the library sidecar. Ignore a
file to keep it off the “never used” list.

## Installation

Download an installer from the
[GitHub release](https://github.com/aipower66669/WildcardsManager/releases/tag/v0.8.0)
when one is attached, or build it yourself. Installers are unsigned.

From source (Node.js 22.12+):

```powershell
git clone https://github.com/aipower66669/WildcardsManager.git
cd WildcardsManager
npm ci
npm run dev
```

Pushing a version tag (`v0.8.0`) runs the checks, builds
`WildcardsManager-<version>-win-x64.exe`, and attaches it to that GitHub
Release. Settings → App updates checks that release when the update folder
is empty, opens **What's new** with these notes, then downloads and installs.
`npm run dist` still bumps the patch and builds a local installer into
`release/`. A folder set under App updates uses that folder instead of GitHub.

## Upgrading from v0.6

If you skipped v0.7, libraries and sidecars still do not need a manual
migration. If you moved model or wildcard folders onto another drive, use
Library Manager → **Migrate library paths…** instead of editing paths by hand.

Install `ComfyUI-Workflow/comfyui-lora-training.zip` into ComfyUI
`custom_nodes/` if Generation reports missing LT nodes, then load
`WildcardManager-ComfyUI-Generation-Workflow.json` and **Save Workflow**.

## Known limitations

- Documented Dynamic Prompts subset only. Fuzzy globs and extension-only syntax
  can differ from A1111 or ComfyUI.
- Undo/redo does not survive a restart.
- Nested YAML/JSON keys are not independent refactor targets.
- No folder-level refactor, split/merge, bulk cleanup, or single library-health
  report yet.
- Generation is a queue plus a saved workflow, not a ComfyUI replacement.
- In-app update installs the GitHub Release for this operating system, or the
  installer in a folder you set under App updates.
- Installers are unsigned.

## Licensing

- Software: PolyForm Noncommercial License 1.0.0.
- `sample_wildcards/`: CC BY-NC-SA 4.0.
