# Getting started

This guide takes you from installation to opening a library, reading its graph,
editing a file, and producing a packaged desktop app.

## Choose how to run it

### Downloaded release

Tagged releases are built for:

- Windows x64 (`.exe`, NSIS installer)
- macOS Intel and Apple silicon (`.dmg`)
- Linux x64 (`.AppImage`)

Release builds are currently unsigned. Windows SmartScreen or macOS Gatekeeper
may warn before first launch.

### Run from source

Requirements:

- Node.js 22.12 or newer
- npm
- Git (recommended)

```powershell
git clone <repository-url>
cd WildcardsManager
npm ci
npm run dev
```

Use `npm install` instead of `npm ci` only when intentionally updating
dependencies.

## Open your first library

1. Click **Open folder**.
2. Choose the directory that acts as the wildcard root. References are resolved
   relative to this directory.
3. Select a file in the left sidebar to make it the graph root.
4. Click nodes to inspect their source and dependencies.

The app indexes `.txt`, `.yaml`, `.yml`, and `.json` recursively. Hidden entries
whose names start with `.` are skipped.

For a known-good demonstration:

1. Open the repository's `sample_wildcards/` directory.
2. Select `0main.txt` for the broad graph or `portrait-focus.txt` for a smaller
   graph.
3. Confirm that the header reports no errors or warnings.

The leading `0` keeps `0main` near the top of sorted file lists without using
`!`, which some ComfyUI Dynamic Prompts setups reject in filenames.

## Understand the workspace

The main window has these top-level tabs:

| Tab | Purpose |
| --- | --- |
| **Wildcard files** | Graph editor for your Dynamic Prompts library |
| **LoRA files** | Browse the configured LoRA folder, match Civitai, see which wildcards use each model |
| **Checkpoint files** | Browse the configured checkpoint folder and Civitai match |
| **Prompts** | Prompt folders (`!gen.txt` + samples); rename / delete / add folders; validate gens |
| **Generation** | ComfyUI generation from a typed prompt or prompt folder (Settings → AI) |
| **Search** | Find wildcard names/content and LoRA / checkpoint filenames |

The toolbar **Search** (magnifying glass) opens a quick launcher into the same
search. Wildcards lists (Archive, Maybe, Notify, LoRA download categories) and
caches live in a sibling `<wildcardsBasename>.wcm/` folder beside your wildcards
root (not inside it). LoRA / checkpoint apps data use `!.wcm/` and
`!Thumbnails/` next to those folders. Civitai community image downloads use a
configured **images folder** (Settings) and an AppData download registry.

### Civitai / updates extras

- Top bar **Civitai** → **Images** or **Videos** for community gallery
  browse/download. Set the matching folder in Settings first.
- **Hugging Face** button for Hub search/downloads (token under Settings → AI
  when a repo is gated).
- **Settings → General → App updates** to install a newer build from your local
  `release/` folder without launching the installer by hand.

### Generation

The app queues ComfyUI. It does not ship a ComfyUI install. Nodes and a sample
graph are in [`ComfyUI-Workflow/`](../ComfyUI-Workflow/). The
[user guide](user-guide.md#install-the-nodes-and-the-sample-graph) has the full
list of extra packs the sample graph needs.

1. Unzip `ComfyUI-Workflow/comfyui-lora-training.zip` into ComfyUI
   `custom_nodes/` so you get `custom_nodes/comfyui-lora-training/`. Restart
   ComfyUI. (A clone can copy the repo’s `comfyui-lora-training/` folder
   instead of the zip.)
2. Install the other custom nodes that graph uses (Dynamic Prompts, LoRA tag
   loader, Corza LoRA loader, Krea 2 enhancer, and `SaveImageToFolder`), then
   restart ComfyUI again. See the user guide for the pack names.
3. In ComfyUI, open
   `ComfyUI-Workflow/WildcardManager-ComfyUI-Generation-Workflow.json`. The
   sample expects Krea 2 UNET / CLIP / VAE filenames — change those loader
   widgets if your models differ.
4. In the app: **Settings → AI** host, port, **Test**, **Check install**.
   Library Manager: prompts folder and a Generation output folder per style.
5. **Generation → Save Workflow** (this stores the graph the app will queue),
   then generate from **Use this prompt** or a prompt folder with `!gen.txt`.

### Wildcard files (three columns)

- **Files:** search the library, filter by graph role, create a file, or choose a
  new root.
- **Graph:** inspect callers, dependencies, missing references, cycles, and
  branches hidden by the depth/breadth display limits.
- **Details:** read node statistics, manage files, inspect diagnostics, and edit
  source.

The graph is deliberately a focused view, not an attempt to draw every node at
readable size. Click a node to make it the focus; it is panned to the center
without changing the current zoom. Dashed frontier nodes indicate branches that
continue beyond the visible cone. **Reset focus** returns to the root view.

### LoRA / Checkpoint files

Configure **LoRA folder** and **checkpoint folder** in Settings (or Library
manager). Each model tab lists files under that root — including **folder
symlinks / junctions** to other drives — with search and filters. Selecting a
model shows identity (AutoV2 hash, size, folder preview image, Civitai cover)
and an embedded Civitai page when a catalog match exists. On **LoRA files**, you
also see which wildcard files reference the model and can open/edit those
callers in the middle panel.

See the [user guide](user-guide.md#lora-and-checkpoint-file-managers) for
filters and hash sidecars.

## Try validation and quick fixes

Open `fixtures/wildcards/` to see intentional problems:

- `root.txt` demonstrates a missing reference.
- `loop-a.txt` demonstrates a recursive cycle through `loop-b.txt`.
- `structured.yaml` and `structured-data.json` demonstrate valid global mapping
  keys; `structured-invalid.yaml` demonstrates a parse error.

Clicking an issue selects the relevant node and jumps to its source line.
Missing references can be resolved by creating the file or removing every exact
occurrence. Cycle issues open the Cycle Resolver, which ranks candidate edge
removals and previews the before/after text.

## Optional: browse Civitai

After opening a library, use the toolbar **Civitai** button to search LoRAs and
checkpoints.

1. In **Settings**, set **Site** to **civitai.com** (SFW catalog) or
   **civitai.red** (NSFW catalog).
2. Set **LoRA folder** / **checkpoint folder** for downloads.
3. Add an **API key** from the same site if you need gated downloads (browse
   works without a key; many downloads return 401 without one).

See the [user guide](user-guide.md#civitai-browser) for Archive / Queued /
Notify lists, LoRA download categories, Shift+click download, detachable window,
filters, and clipboard snippets.

## Edit safely

1. Select a real file node.
2. Click **Edit** in the Source section.
3. Make changes. `Ctrl+F` opens editor search.
4. Click **Save**.

Saving is an undoable mutation. The graph and issue list rebuild immediately.
Use the toolbar buttons or:

- `Ctrl+Z` — undo
- `Ctrl+Y` or `Ctrl+Shift+Z` — redo

Undo history stores up to 50 operations for the current app session and resets
when another library is opened. Best-effort pre-mutation backups are written
under Electron's per-user `userData/backups/` directory and survive restarts.

## Preview prompts

With a text or structured root selected, click **Expand**:

- **Random:** generate repeatable samples from a numeric seed; weights affect
  selection.
- **Exhaustive:** enumerate combinations until the requested result limit.

The requested count is clamped to 1–2,000. Combination estimates saturate at one
billion, and the dialog marks truncated output. YAML/JSON scalar/list values use
the same nested-reference and variant expansion pipeline as text values.

## Simulate reach and balance

Click the settings button beside **Simulate** to choose an iteration count and
seed. The defaults (10,000 runs, seed 1) are persisted. **Simulate** overlays:

- each node's overall reach rate;
- hits and total visits;
- parent-relative selection share;
- a red-to-green sibling-balance color.

Simulation accepts 1–1,000,000 iterations. It follows the same expansion rules
for text and structured scalar/list values and stops safely at recursion.

## Build locally

```powershell
npm run typecheck
npm test
npm run build
```

Package for the current or a named platform:

```powershell
npm run dist
npm run dist:win
npm run dist:mac
npm run dist:linux
```

Cross-platform packages should be produced on their native operating systems.
Artifacts are written to `release/`.

## Next reading

- [User guide](user-guide.md)
- [Supported syntax and compatibility](syntax.md)
- [Troubleshooting](troubleshooting.md)
- [Development guide](development.md)
