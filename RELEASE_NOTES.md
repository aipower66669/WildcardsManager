# Wildcards Manager v0.11

Package version: **0.11.0**  
Release date: **October 29, 2026**

v0.11 puts the missing civitai.red models back in Browse. Civitai’s `nsfw`
flag is now only the top tier, so R and X LoRAs and checkpoints were left out
and the morning Newest check stopped early. Those models are kept. Generation
also stays responsive while images are running.

The [user guide](docs/user-guide.md) is the complete reference. This note is the
map.

## Browse on civitai.red

Browse lists **R and above**. PG and PG-13 stay out, including when the `nsfw`
flag is off. **Include NSFW** does not add PG or PG-13.

**All** + **Newest** uses the same type, base model, and Newest query as the
website. The head of that list follows the website order. **+N new** counts
models that were not already in that catalog. Open **LoRAs** and **Checkpoints**
once after upgrading so each index walks the current tip. Images and Videos
already request R, X, and XXX by browsing level.

## Generation

The window stays clickable while images run. The wildcard index is reused, the
Comfy prompt is built off the UI thread, and the Generation form stays put
while status updates.

**Single prompt**, under **Use this prompt** and **Use selected prompt
folder**, sends the whole box as one prompt. A prompt can already span several
lines. Unticked, the box is read like a `!gen.txt` file and one prompt is
chosen. **Additional Positive** is appended to that prompt either way.

Opening a locally trained LoRA no longer freezes the window on “Looking up
validation sets”.

## Also in this version

- Saving a wildcard while typing no longer jumps the caret to the start of the
  file. Undo keeps the characters just typed.
- A version tag attaches `comfyui-custom-save-node.zip` (`SaveImageToFolder`)
  next to `comfyui-lora-training.zip` and the two workflow files.
  `WildcardsManager-*.exe.blockmap` is not uploaded. Check for update still
  downloads the full installer.
- SDXL generation, Browse family chips, and per-library shelves from v0.10 are
  unchanged.

## Installation

Download an installer from the
[GitHub release](https://github.com/aipower66669/WildcardsManager/releases/tag/v0.11.0)
when one is attached, or build it yourself. Installers are unsigned.

From source (Node.js 22.12+):

```powershell
git clone https://github.com/aipower66669/WildcardsManager.git
cd WildcardsManager
npm ci
npm run dev
```

Pushing a version tag (`v0.11.0`) runs the checks, builds
`WildcardsManager-<version>-win-x64.exe`, and attaches it to that GitHub
Release. Settings → App updates checks that release when the update folder
is empty. **Check for update** only reports a newer installer. **What's new**
is a separate button for these notes. **Install** downloads and installs.
`npm run dist` still bumps the patch and builds a local installer into
`release/`. A folder set under App updates uses that folder instead of GitHub.

## Upgrading

Quit Wildcards Manager completely, including the tray icon, then start 0.11.0.
Closing the window is not enough while the tray icon is still running.

Then open Browse on **LoRAs** and on **Checkpoints** so each catalog picks up
the models the old check skipped. The first pass can take a bit, and **+N**
can be large. Those cards show at the top of **All**.

Libraries do not need a hand-edited `library.json`. If you moved model or
wildcard folders onto another drive, use Library Manager → **Migrate library
paths…**.

The release assets include `comfyui-lora-training.zip` and
`comfyui-custom-save-node.zip`. Unzip both into ComfyUI `custom_nodes/`
(`custom_nodes/comfyui-lora-training/` and
`custom_nodes/comfyui-custom-save-node/`), restart ComfyUI, load the matching
workflow JSON, and **Save Workflow**. The save-node zip is `SaveImageToFolder`.

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
