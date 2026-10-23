# Wildcards Manager v0.9

Package version: **0.9.0**  
Release date: **October 24, 2026**

v0.9 is a Prompts and Hugging Face release. The Prompts title bar drives the
same Generation style, checkpoint, seed, and size as the Generation tab.
Coverage samples prompt folders the way a real run does. Hugging Face
downloads use the Civitai dialog and keep the Hub page on the file.

The [user guide](docs/user-guide.md) is the complete reference. This note is the
map.

## What’s new in v0.9

- **Prompts title bar.** On the same line as Once, Infinite, and Cancel:
  Realistic / Anime / 3D (icons), checkpoint, seed (dice and shuffle), and
  width × height. A change on Prompts or Generation updates the other.
  Switching style does not change the open `!gen.txt`. Once and Infinite
  queue that folder with the values shown there.
- **Width and Height.** Swap exchanges the two numbers. Decrease and Increase
  step to a nearby common size with a close aspect ratio. Both sides of a
  stepped size are multiples of 16. The tooltip shows the size the button
  will write.
- **Coverage matches a real run.** Each walk picks a prompt folder at random
  (every `!gen.txt` folder is equally likely), then a decoded line in that
  folder, then one wildcard walk. The count is Settings → Simulation →
  Iterations (1–1,000,000, default 10,000), with the Simulation seed. A
  **Rare** tab sits between Ignored and Hot. Each tab lists every match.
  Cancel stops the run.
- **Missing-file search.** Clicking a “missing wildcard file” issue fills the
  editor search with that wildcard.
- **Comment / Uncomment.** The editor context menu puts or removes `# ` on
  the selected lines.
- **Hugging Face download dialog** matches Civitai: category, extra
  categories, weights, extra comment, and extra prompt. The Hub URL is saved
  on the downloaded LoRA or checkpoint, so its page URL opens that repo.
  Cards show a sample image when the repo has one, cropped to a portrait 2:3
  frame.
- **Benchmark rating** uses the Checkpoint-tab catalog rating when a sample
  folder has no ADS rating. Five stars weigh the same as an ADS rating of 10.

## Upgrading from v0.8

Libraries and sidecars do not need a migration. Generation settings you already
saved stay on Realistic, Anime, and 3D.

Re-run Coverage to replace a report that walked every decoded line. A Hugging
Face file already on disk keeps its previous page link until you download it
again.

If Generation still reports missing KSampler nodes, replace
`custom_nodes/comfyui-lora-training` with
`ComfyUI-Workflow/comfyui-lora-training.zip`, restart ComfyUI, and **Save
Workflow**.

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
| **Prompts** | `!gen.txt` folders, validation, coverage, samples, and the Generation controls for the open folder |
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
- Hugging Face Hub search and download queue. The download dialog matches
  Civitai, including extra comment and extra prompt. The Hub page is stored
  on the downloaded file. Cards show a sample image when the repo has one.
  Gated repos need a token under Settings → AI.

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
  The Prompts title bar edits the same style, checkpoint, seed, and size.
- Width and Height can swap or step to a common 16-aligned size.
- **Benchmark** walks checkpoint files and records timings. Rating order can
  use the catalog stars when a sample folder has no ADS rating.
- **Edit Workflow** / **Save Workflow**. The toolbar stays quiet when the
  graph is ready and names missing nodes when it is not.
- **Categorize** appends a prompt into a folder’s `!gen.txt`.
- **Substitutions** replace prompt text for a checkpoint name before wildcards
  expand. Rules stay in that library’s `library.json`.

**LM Studio** (local server) can propose edits to the open wildcard file.
Nothing is saved until you apply the proposal.

## Prompts coverage

**Coverage** runs one simulated generation per Simulation iteration (default
10,000, up to 1,000,000). Each walk picks a prompt folder at random, then a
decoded line in that folder, then one wildcard walk. Results stay in the
library sidecar. Tabs are Never, Ignored, Rare, Hot, All, and By prompt.
Ignore a file to keep it off the “never used” list.

## Installation

Download an installer from the
[GitHub release](https://github.com/aipower66669/WildcardsManager/releases/tag/v0.9.0)
when one is attached, or build it yourself. Installers are unsigned.

From source (Node.js 22.12+):

```powershell
git clone https://github.com/aipower66669/WildcardsManager.git
cd WildcardsManager
npm ci
npm run dev
```

Pushing a version tag (`v0.9.0`) runs the checks, builds
`WildcardsManager-<version>-win-x64.exe`, and attaches it to that GitHub
Release. Settings → App updates checks that release when the update folder
is empty. **Check for update** only reports a newer installer. **What's new**
is a separate button for these notes. **Install** downloads and installs.
`npm run dist` still bumps the patch and builds a local installer into
`release/`. A folder set under App updates uses that folder instead of GitHub.

## Upgrading from v0.6

If you skipped v0.7 or v0.8, libraries and sidecars still do not need a manual
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
