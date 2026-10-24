# Wildcards Manager v0.10

Package version: **0.10.0**  
Release date: **October 25, 2026**

v0.10 generates images with **SDXL**. Pony and Illustrious use that same
checkpoint. Krea 2 stays as it was. Browse can filter those SDXL families, and
each library keeps its own catalog, shelves, and Generation settings.

The [user guide](docs/user-guide.md) is the complete reference. This note is the
map.

## SDXL generation

**Library Manager** sets Generation family to **Krea 2** or **SDXL** (default
Krea 2). Krea 2 keeps Load Diffusion Model, Load CLIP, and Load VAE. An SDXL
library uses one checkpoint file for SDXL, Pony, and Illustrious. CLIP comes
from that file, so the CLIP field is hidden. **Options → VAE** replaces the
packed VAE; blank keeps it. **CLIP skip** defaults to 2. **Upscaler**,
**Upscale factor** (default 1.5), and **Hires denoise** (default 0.5) run a
second pass after the base sample. Sampler and Scheduler list every name Comfy
reports, underscores included. Realistic, Anime, and 3D each keep their own
checkpoint, size, and Options.

Open `ComfyUI-Workflow/WildcardManager-ComfyUI-SDXL-Generation-Workflow.json`
in ComfyUI, set the library’s family to SDXL, then **Save Workflow**. Krea 2
keeps its own graph and its own saved file.

## SDXL families in Browse

On an SDXL library, Civitai Browse adds family chips: **All**, **SDXL**,
**Pony**, **Illustrious**, and **NoobAI**. Library Manager chooses which of
those families this library includes. **NoobAI** is a Browse family on that
same SDXL graph.

**+N new** counts models for the base model, family chip, and category you
have open. Those cards are placed at the front of that grid. A Pony count is
Pony. Illustrious, NoobAI, and plain SDXL stay in the catalog and show when
that chip is selected. Category chips work the same way. Installed, archived,
Maybe, and Notify stay off Browse.

## Libraries

**Library Manager** holds more than one library. Each library has its own:

- wildcards root, LoRA folder, checkpoint folder, prompts folder, and
  Generation output roots
- Civitai site (`civitai.com` or `civitai.red`) and validation platform
- Generation family, and the Generation form for Realistic, Anime, and 3D
- **Base models to manage**, **SDXL families**, and **Civitai categories**

Two libraries that share a wildcards folder keep separate checkboxes. Switching
libraries reloads that library’s catalog and Generation screen.

On disk, next to the wildcards folder (not in AppData):

- Catalog: `<wildcards folder name>.wcm/cache/civitai-catalog/<library id>/`
- Shelves: `<wildcards folder name>.wcm/libraries/<library id>/` — Civitai
  LoRAs, checkpoints, images, and videos are separate files, Hugging Face has
  its own file, LoRA download categories are `categories.json`, and filters
  stay in that folder’s `library.json`

The first launch after an upgrade copies an old combined `library.json` into
`backups/pre-migrate-<timestamp>/` before it writes those shelf files. If that
copy fails, the file is left as it is. Quit completely, including the tray,
and start **0.10.0** so that launch can run. A build from before the shelf
split does not read the shelf files.

If Archive, Maybe, Notify, or LoRA categories disappear, see
[Troubleshooting](docs/troubleshooting.md#archive-maybe-notify-or-lora-categories-disappeared).

**Migrate library paths…** rewrites stored pointers when a tree changes drive
or parent. It does not move the files.

## Also in this version

- **Mark as Downloaded** asks **This version** or **All current versions** when
  a card lists more than one downloadable version. Early access is left out of
  All. A version published later stays unmarked. The download button still
  downloads.
- Fixing one wildcard issue removes that row. The details list does not redraw
  every issue and then drop the fixed one.
- Prompt coverage, the Prompts title bar, and Hugging Face downloads behave as
  in v0.9. v0.9.3 stopped one library’s Archive, Maybe, Notify, or categories
  from replacing another’s when they shared a wildcards folder.

## Installation

Download an installer from the
[GitHub release](https://github.com/aipower66669/WildcardsManager/releases/tag/v0.10.0)
when one is attached, or build it yourself. Installers are unsigned.

From source (Node.js 22.12+):

```powershell
git clone https://github.com/aipower66669/WildcardsManager.git
cd WildcardsManager
npm ci
npm run dev
```

Pushing a version tag (`v0.10.0`) runs the checks, builds
`WildcardsManager-<version>-win-x64.exe`, and attaches it to that GitHub
Release. Settings → App updates checks that release when the update folder
is empty. **Check for update** only reports a newer installer. **What's new**
is a separate button for these notes. **Install** downloads and installs.
`npm run dist` still bumps the patch and builds a local installer into
`release/`. A folder set under App updates uses that folder instead of GitHub.

## Upgrading

Quit Wildcards Manager completely, including the tray icon, then start 0.10.0.
Closing the window is not enough while the tray icon is still running.

Libraries do not need a hand-edited `library.json`. If you moved model or
wildcard folders onto another drive, use Library Manager → **Migrate library
paths…**.

Install `ComfyUI-Workflow/comfyui-lora-training.zip` into ComfyUI
`custom_nodes/` if Generation reports missing LT nodes, then load the matching
workflow JSON and **Save Workflow**.

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
