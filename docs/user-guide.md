# User guide

## Library model

A library is one user-selected directory. Text-file paths become wildcard keys;
YAML/JSON files contribute keys from their nested mappings:

```text
library/
  colors.txt              -> colors
  clothing/hats.txt       -> clothing/hats
  collections.yaml        -> keys declared inside the document

library.wcm/              -> sibling app-data folder (not scanned by ComfyUI DP)
  library.json            -> per-library lists, download categories, prompt substitutions
  validation.json
  prompt-coverage.json    -> Prompts Coverage simulation report
  backups/
  cache/                  -> catalog / hash caches
```

References omit extensions: `__colors__`, `__clothing/hats__`. Both `/` and `\`
inside references are normalized to `/`.

The selected directory remains the source of truth for wildcard **content**.
Wildcards Manager does not copy the library into a database. Wildcards app data
lives in a **sibling** `<basename>.wcm/` folder so ComfyUI Dynamic Prompts (which
recursively scans the wildcards root) never sees it. LoRA and checkpoint roots
still use in-tree `!.wcm` / `!Thumbnails` for models.json, download queues, and
previews.

**AppData** (`%AppData%/Roaming/wildcards-manager` on Windows) stores path
pointers, UI preferences, and the Civitai API key — not Archive / Maybe /
Notify lists or category definitions. `npm run dev` and the installed app
share that folder: startup pins it, and if an older build left files under
`Wildcards Manager`, files the shared folder does not already have are copied
in once. Opening an older install migrates library datasets into the folder
sidecars automatically (including moving any legacy in-tree `!.wcm` / `!Cache`
under wildcards into the sibling layout).

## Library Manager

**Library Manager** (toolbar) holds more than one library. Each library has its
own wildcards root, model folders, Civitai site (`civitai.com` or
`civitai.red`), and validation platform (ComfyUI or Stable Diffusion). Switching
libraries reloads that library’s sidecar lists; it does not mix them.

Folder pointers on a library:

| Pointer | Used for |
| --- | --- |
| **Wildcards folder** | Dynamic Prompts library (the graph) |
| **LoRA folder** | Installed LoRAs, existence checks, downloads |
| **Checkpoint folder** | Installed checkpoints and benchmark source files |
| **LoRA training library** | Dataset folders with `dataset.json` for multi-step LoRA series previews |
| **Prompts folder** | `!gen.txt` trees and sample images (shared by every Generation style) |
| **Generation output (Realistic / Hentai / 3D)** | Where that style writes images. Realistic may fall back to the Prompts folder. Hentai and 3D need their own roots before you generate with that style |
| **Checkpoint Benchmark folder** | WCG samples and `benchmark-stats.json` from Generation → Benchmark |
| **Images folder** / **Videos folder** | Civitai community downloads (`<folder>/<base model>/…`), set in Settings |

**Migrate library paths…** rewrites those pointers when a whole tree
changes drive or parent — for example `D:\ComfyUI\…` to `E:\AI\ComfyUI\…`.
Preview the plan first. Paths outside the old prefix stay put unless you set an
override for that field. The tool rewrites folder pointers and stored absolute
paths (master images, recent roots, training root). It does not move the files
on disk; move the folders yourself, then apply the plan.

## Files sidebar

Typing in **Filter files…** matches keys/paths. The mode selector narrows the
whole library using distinct file-to-file references:

- **All files:** every indexed wildcard.
- **Roots · no parents:** no other file references the file.
- **Leaves · no children:** the file references no existing file.
- **Standalone:** neither inbound nor outbound references.
- **Empty / invalid:** syntax, empty-file, or unresolved-reference issues are
  owned by the file.
- **Has LoRA tags:** the file contains at least one complete
  `<lora:name:weight>` tag (comment lines ignored).

Self-references do not affect root/leaf classification. The plus button creates
a file relative to the open root; `.txt` is added when no supported extension is
provided.

Selecting a file performs a complete dependency analysis from that root and
remembers it for the next launch.

## Dependency graph

### Nodes

- **Root:** the file selected in the sidebar.
- **File:** a resolved `.txt` dependency.
- **YAML/JSON key:** a validated global mapping path from a structured file.
- **Glob:** an intermediate node that fans out to every matching file.
- **Missing:** an unresolved exact reference or glob with no matches.
- **Caller:** a synthetic level `-1` node for a file that directly references
  the current root.

Caller nodes make it possible to move upward through a library. Clicking one
reanalyzes that caller as the new root.

### Edges

Each edge preserves the source line, column, and wildcard token that produced
it. Cycle edges are highlighted and animated. The graph header reports full
analysis totals even when the drawing is focused.

### Layout styles

Open **Settings** from the toolbar to choose a persisted graph layout:

- **Default:** the original fixed, alphabetical grid.
- **Optimized:** Dagre's layered layout, which reduces crossings and keeps
  connected nodes closer while retaining top-to-bottom dependency flow.

Optimized is selected by default for new user profiles.

Settings also let you choose an optional **LoRA models** folder. When set,
Wildcards Manager recursively indexes `.safetensors`, `.ckpt`, and `.pt` files
(following folder symlinks/junctions) and warns when an A1111/Forge
`<lora:name:weight>` tag cannot be resolved by relative path or basename
(case-insensitive). The folder path is stored only in your user profile
settings, not in the repository. A separate **checkpoint folder** setting is
used for downloads and the Checkpoint files workspace. An **images folder** is
required for Civitai community Images downloads.

**Settings → General → App updates** checks the public
[GitHub Releases](https://github.com/aipower66669/WildcardsManager/releases)
when the folder is empty. **Check for update** only looks for a newer installer
and does not open a window. **What's new** is a separate button that opens that
version's release notes. **Install** downloads the installer, closes the app, and runs it
(leave **Run** checked to relaunch). A folder you choose overrides GitHub:
check, download, and **What's new** stay on that folder and do not contact
GitHub. **What's new** reads `RELEASE_NOTES.md` in the folder or in the folder
above it. Installers are `latest.yml` or
`WildcardsManager-<version>-win-x64.exe`.

### LoRA and Checkpoint file managers

Use the main-window tabs **LoRA files** and **Checkpoint files** (alongside
**Wildcard files**) after configuring the matching folders in Settings.

#### Shared layout

- **Left:** searchable model list with filters and a rescan control.
- **Middle:** identity for the selected file — relative path, AutoV2 hash, size,
  Civitai link when matched, folder preview (same-stem `.jpg` / `.png`), and
  Civitai cover (from catalog / preview cache). Hover titles for short help.
- **Right:** embedded Civitai model page when a page URL is known (same
  `persist:civitai-preview` session as the Browse preview webview).

Folder indexing **follows directory symlinks and Windows junctions**, so models
stored on another drive but linked under the configured root appear in the list.

#### LoRA files

Filters: all · referenced in wildcards · unused · has image/JSON sidecar ·
matched on Civitai.

Also shows:

- reference count / unused badge in the list;
- issues for the selected LoRA (e.g. unused);
- **Referencing wildcards** — open a caller and edit it in the middle panel.

Companion `.json` sidecars are not shown in the LoRA details panel (they are
rarely useful for LoRAs).

**Training-step series:** basenames like `Character_000250` / `Character_000500`
(or `-` separators) are treated as one series. You can ignore unused for the
whole series, and the UI can build a compact Dynamic Prompts pick such as
`<lora:Character_000000{250|500}:…>` when copying a local series snippet.

#### Checkpoint files

Filters: all · has image/JSON sidecar · matched on Civitai · missing AutoV2
hash.

Shows companion sidecar JSON when present. Before hashing large weight files,
the app reads a sibling **`ModelName.txt`** (same stem as the model file — not
`ModelName.safetensors.txt`) for `HASH256` / `SHA256` / `AutoV2` lines and
derives AutoV2 from those when available.

Checkpoints can take a local **half-star rating** stored in that model root’s
`!.wcm/models.json` (not in AppData). Each file has a **Use in this library**
tick, on by default. Untick a model this library should not run: it leaves
that library’s Generation checkpoint list and is skipped by its Benchmark.
Another library that shares the same checkpoint folder keeps its own tick.
Those paths are `ignoredCheckpoints` in the library’s `library.json` (the
sibling `<wildcards folder name>.wcm` next to the wildcards root). A bare
filename matches that file in any subfolder. The right pane has a **Benchmark** tab
when Generation → Benchmark has written samples for that file, and a
**Website** tab for the embedded Civitai page.

#### LoRA training series

Point **LoRA training library** at the dataset root. A multi-step series
(`Name_000250`, `Name_000500`, …) can show the validation images recorded in
that dataset’s `dataset.json`. Open a thumb to view the file. This is a
preview of training output, not a trainer.

### Prompts workspace

The **Prompts** tab manages prompt folders under the configured prompts root
(`!gen.txt` plus sample images where present):

- Browse the folder tree; right-click for **Rename**, **Delete** (confirmed),
  and **Add sub-folder** (creates `New folder` then inline rename). Use **+**
  beside the root path for a top-level folder.
- Edit `!gen.txt` with the same wildcard editor; **Validate** checks every gen
  file for missing / invalid wildcards. Prefix a line with `[TESTING]` to force
  Generation to always pick that prompt (tag is stripped before expand) so you
  can debug one line without commenting out the others. Prefix with `[xN]`,
  `[W=N]`, or `[WEIGHT=N]` (integer N) to weigh that prompt — decode expands it
  into N copies so it is relatively more likely to be picked (tag stripped).
- **Coverage** (toolbar) switches to **Generation** and runs a background
  simulation over **every** decoded prompt line in every `!gen.txt`: each line
  is expanded with the usual Monte Carlo wildcard walk (`iterations` times,
  same seed setting as Analyze
  simulation). It reports which wildcard **files** are never reached, which are
  hot / over-used, and which prompt folders drive them. The run uses a worker
  thread so the UI stays responsive; close the dialog anytime — the toolbar
  shows live percent until it finishes. Results persist as
  `prompt-coverage.json` in the wildcards sibling `.wcm` sidecar. Use
  **Ignore** on Never Used (or on a wildcard’s manage toolbar / context menu)
  to hide tool or rare files from that list; ignored keys survive later Coverage
  re-runs.
- The right panel switches between **Samples** (random images from the selected
  folder) and **Last output** (same live Generation preview — category, seed,
  prompts). Use Last output while editing prompts during a run without leaving
  this tab. Collapse the panel (toolbar icon) for more editor room — while
  collapsed, selecting a folder does **not** scan for samples.
- The `!gen.txt` title bar has three square buttons on the right: **Once**
  (lightning, blue), **Infinite** (infinity, the same dark button as
  Generation), and **Cancel** (square, red). Hover each one for the tooltip.
  **Once** and **Infinite** save the editor, point Generation at this folder,
  and queue that `!gen.txt` with the current Generation style, checkpoint,
  seed, and Recursive setting. **Cancel** stops the run and interrupts the
  image in progress. Style, checkpoint, seed, and Recursive stay on the
  **Generation** tab.

### Generation workspace

The **Generation** tab queues jobs against a running ComfyUI instance
(**Settings → AI**: host, **Test** for the server, **Check install** after
**Save Workflow**):

- **Use this prompt** (typed, with the same `!gen.txt` multi-line rules) or a
  selected prompt folder. **Recursive** sits on the Prompt folder line. With a
  folder selected, on includes that folder and sub-folders that have
  `!gen.txt`; off uses only that folder. **Select… [Randomize]** (no folder)
  picks a folder from the seed.
- Style profiles (**Realistic** / **Anime** / **3D**). Each profile has
  **Generation** (prompt folder, checkpoint, seed, size, additional positive,
  negative) and **Options** (CLIP, VAE, Steps, CFG, Sampler, Scheduler,
  Denoise). Values are not shared across the three styles. Hover a label for
  a short explanation. Additional Positive and Negative resize vertically, and
  that height is remembered.
- Seed **1 or higher** repeats the same image on **Once** and **Infinite**:
  the same dropdown and the same Recursive setting pick the same folder and
  the same line. Seed **0 or below** (the dice) rolls a new seed from the
  clock on every image. The shuffle button writes one random number into Seed
  and keeps that number. The crosshair on Last output copies only the seed.
  An empty `!gen.txt` error names the folder; Infinite skips that image and
  continues.
- Each style has its own Generation output root in **Library Manager**
  (Realistic defaults to the Prompts folder). Folder mode writes
  `{styleOutput}/{prompt folder}`. **Settings → AI → Save folder-mode images
  in a New subfolder** adds `/New` and is off until you turn it on. The app
  does not create that folder; the ComfyUI save node does when it writes the
  image. Typed prompts write to the style root.
- **Benchmark** (checkbox next to Checkpoint) walks every `.safetensors` file in
  the library Checkpoint folder that is still ticked **Use in this library**.
  Set **Checkpoint Benchmark folder** in Library
  Manager first. Each job writes one WCG image under
  `{benchmarkRoot}/{fileStem}/` (duplicate stems share a folder). **Once** = one
  image; **Infinite** continues until every checkpoint has **10** images (or
  Cancel). Deleting a sample image drops that timing and leaves the slot open,
  so the next Benchmark run replaces it. Each saved timing is the sampler’s own steps, from the first step
  through the last, so model load and the file save are not part of the number.
  A run that never reports that full range is not saved — the image is removed
  and the benchmark tries again. Every saved timing is drawn. The blue average
  and the min–max bar use only the **5 fastest** runs. Timings land in
  `{benchmarkRoot}/benchmark-stats.json`. Those samples
  also appear on **Checkpoint files** in the right pane **Benchmark** tab
  (selected by default when samples exist; **Website** is the Civitai page).
  Use the graph button next to the Benchmark checkbox for a sortable avg-time
  line graph (movable/resizable window). Filter the names (case-insensitive).
  Rating order uses `field_rating` from each sample folder’s `mfe_meta` stream,
  hides folders that have no rating, and draws the number under each point.
  Weight order mixes that rating with the average time: 100 means the checkpoint
  is both the fastest and the highest rated, and a fast weak result or a slow
  top-rated one scores lower. The weight is drawn under each point.
  The name filter and the sort are remembered when the window is closed.
  Hover a point for the name, click to
  load that checkpoint in the dropdown.
- **Edit Workflow** / **Save Workflow** for the Comfy graph. **Save Workflow**
  writes the graph the app queues. Until that file exists, Generation has
  nothing to run. The prompt toolbar, next to **Edit Workflow**, stays quiet
  when the graph is ready. It shows a warning when no workflow is saved, and
  the missing node names when the saved graph cannot run.
- **Last output** preview can be collapsed for long unattended runs. Under the
  image, **Category** is the prompt folder that produced it (parents as a
  breadcrumb — useful when Randomize picked a sub-folder), then **Positive**
  and **Negative** from the file’s generation metadata (`parameters` /
  `comment` — same source My File Explorer uses). Use the folder icon to
  reveal that image, or the trash icon to delete it.
- **Categorize** appends the current prompt into a chosen folder’s `!gen.txt`.
- **Substitutions** (next to Categorize) edits this library’s prompt
  replacements. Drag the title to move the window, drag the corner to resize,
  or double-click the title to maximize — the size is remembered. Before wildcards expand, each rule whose keyword is in the
  selected checkpoint’s file name (case-insensitive; folders and the extension
  are ignored) replaces every exact Find text. That applies to **Use this
  prompt** and to the line picked from the selected prompt folder. Example:
  model contains `Kroma`, find `__loraname__`, replace
  `__loraname-KromaVersion__`. A Benchmark run uses the checkpoint being
  timed. Rules are stored as `promptSubstitutions` in that library’s
  `library.json`.

Generation can start ComfyUI from the launch shortcut in **Settings → AI** when
the server is offline. The saved graph lives under
`%AppData%/Roaming/wildcards-manager/` (`comfy-workflow.json`: API graph plus
LiteGraph UI JSON). The Windows installer does not install ComfyUI or custom
nodes.

#### Install the nodes and the sample graph

The supplied graph is a **Krea 2** example. Wildcards Manager is not limited
to Krea 2. SDXL, Flux, and other architectures need a graph you adapt in
ComfyUI (different loaders and model files) before **Save Workflow**. Swapping
only the filenames on this sample is not enough for a different architecture.

The repo ships the two node packs and that graph in
[`ComfyUI-Workflow/`](../ComfyUI-Workflow/):

| File | What it is |
| --- | --- |
| `comfyui-lora-training.zip` | The LT custom-node pack (same files as [`comfyui-lora-training/`](../comfyui-lora-training/) in a clone) |
| `comfyui-custom-save-node.zip` | The sample’s save node, class `SaveImageToFolder` (display name **Save Image To Folder**) |
| `WildcardManager-ComfyUI-Generation-Workflow.json` | A Krea 2 ComfyUI graph already wired to those nodes |

1. **Install the two packs from this repo.** Unzip both zips into ComfyUI’s
   `custom_nodes` folder so you get
   `custom_nodes/comfyui-lora-training/` (that folder must contain
   `__init__.py` and `nodes.py`) and
   `custom_nodes/comfyui-custom-save-node/` (that folder must contain
   `__init__.py`). From a git clone you can copy or symlink
   `comfyui-lora-training/` the same way. Do not search ComfyUI Manager for
   another `SaveImageToFolder`: this zip is the one the sample graph uses.
   Restart ComfyUI. If ComfyUI says that pack failed to import, its Python is
   missing `piexif` and the node stays missing until you install it and
   restart. Use ComfyUI’s own Python: `pip install piexif` in that environment.
   On the official Windows portable build, from the folder that contains
   `python_embeded`, run `python_embeded\python.exe -m pip install piexif`.
2. **Install the other packs the sample graph uses**, then restart ComfyUI
   again. ComfyUI Manager can install these by repository:
   - [ComfyUI Dynamic Prompts](https://github.com/adieyal/comfyui-dynamicprompts)
     (`DPRandomGenerator`) — also what expands your wildcard files inside ComfyUI
   - [badjeff/comfyui_lora_tag_loader](https://github.com/badjeff/comfyui_lora_tag_loader)
     (`LoraTagLoader`) — turns `<lora:name:weight>` tags in the prompt into
     loaded LoRAs
   - [CoreyCorza/comfyui-lora-loader](https://github.com/CoreyCorza/comfyui-lora-loader)
     (`CorzaCleanAppliedLoRAs`)
   - [capitan01R/ComfyUI-Krea2T-Enhancer](https://github.com/capitan01R/ComfyUI-Krea2T-Enhancer)
     (`ComfyUI-Krea2T-Enhancer`) — Krea 2 only; skip it if you replace this
     graph with another architecture
3. **Load the graph in ComfyUI.** Drag
   `WildcardManager-ComfyUI-Generation-Workflow.json` onto the canvas, or use
   the workflow menu to open it. A red node means that pack is still missing;
   install it and restart before you continue. The LT nodes are already
   connected: Prompt → Dynamic Prompts → LoRA tag loader, Negative, Seed →
   sampler, Model → UNET loader, CLIP and VAE → their loaders, Width and
   Height → Empty Latent, Output Folder and Output Filename → Save Image to
   Folder. Steps, CFG, Sampler, Scheduler, and Denoise are optional: convert
   those KSampler widgets to inputs and connect **LT · Steps**, **LT · CFG**,
   **LT · Sampler**, **LT · Scheduler**, and **LT · Denoise** if you want the
   Options tab to drive them.
4. **Point the loaders at models you have.** The sample ships with these Krea 2
   filenames:
   - UNET `krea2_turbo_fp8_scaled.safetensors`
   - CLIP `qwen3vl_4b_fp8_scaled.safetensors` (CLIP type `krea2`)
   - VAE `Wan2_1_VAE_fp32.safetensors`

   If those files are not in your ComfyUI model folders, change the loader
   widgets (or let the app’s checkpoint / CLIP / VAE fields supply names you
   do have). Leave the LT nodes connected to the loader inputs.
5. **In Wildcards Manager, connect and save, in this order:**
   - **Settings → AI:** ComfyUI host and port, optional launch shortcut, then
     **Test**. **Test** only checks that the server answers (latency and how
     many node classes it reported). It does not look at your graph.
   - **Library Manager:** prompts folder, and a Generation output root for each
     style you use (Realistic, Hentai, 3D). Realistic defaults to the prompts
     folder.
   - **Generation → Save Workflow.** That copies the open ComfyUI graph into
     the app. Use **Edit Workflow** later when you change the graph in ComfyUI,
     then save again.
   - **Settings → AI → Check install**, after that save. **Check install**
     reads the saved graph only. It asks whether **LT · Prompt**, **LT · Seed**,
     and a save node are present. It does not scan ComfyUI for missing custom
     nodes, and it has nothing to check until **Save Workflow** has succeeded.
     Before a save it says there is no saved workflow yet.
6. **Generate once to confirm.** Type a short prompt such as
   `a red apple on a wooden table`, choose **Use this prompt**, and click
   **Once**. The image should show under **Last output** and land in that
   style’s output folder. A missing-node error on the ComfyUI canvas is still
   an install problem. An error that names a wildcard or a LoRA is a library
   problem, not a missing node.

Required nodes on any graph you save yourself: **LT · Prompt**, **LT · Seed**,
and a save node the app can find (**LT · Save Output**, or a node whose class
name contains `SaveImage`, which is what `SaveImageToFolder` in
`comfyui-custom-save-node.zip` is). Optional LT nodes the app fills in when
they are present: Negative, Model, CLIP, VAE, Width, Height, Steps, CFG,
Sampler, Scheduler, Denoise, Output Folder, Output Filename. A blank Sampler
or Scheduler leaves the name already on that node. Wiring notes are in
[`comfyui-lora-training/README.md`](../comfyui-lora-training/README.md).

### LM Studio prompt assist

On a wildcard’s details pane, **Prompt** opens a local LM Studio assist
(OpenAI-compatible server). Configure host, model, and an optional API key
under **Settings → AI → LM Studio**, then Test.

Presets (add variations, and the others in the dialog) plus a free-text
instruction propose a new file body. Saved prompts are a personal library of
those instructions. **Nothing is written until you apply the proposal** into
the open editor. The assist reads the editor draft, not a hidden copy on disk.

### Search workspace

Use the toolbar **Search** button (magnifying glass) or the **Search** tab to
find:

- wildcard **file names / paths**;
- wildcard **file content** (line + snippet);
- **LoRA** and **checkpoint** filenames under the configured model folders.

Toggle scopes in the launcher or on the Search tab. Opening a hit jumps to the
matching workspace (wildcard editor, LoRA, or Checkpoint).

### Civitai browser

Use the topbar **Civitai** button to search and download LoRAs and checkpoints,
or switch to **Images** for the community gallery. A separate **Hugging Face**
control opens Hub search/downloads.

#### SFW vs NSFW sites

In **Settings → Civitai → Site**, pick the catalog that matches what you want:

| Site | Catalog |
| --- | --- |
| **civitai.com** | SFW-oriented catalog — prefer this for work-safe browsing |
| **civitai.red** | NSFW catalog — use when you intentionally want mature models |

The site choice controls which API and account the app talks to for **models**.
The Images tab has its own **SFW only / SFW + NSFW / NSFW only** content filter.

#### API key (browse vs download)

- **Browse and search** work without an API key.
- **Many model downloads require an API key.** Creators can require login; without a
  key those files fail with `401 Unauthorized` (“requires you to be logged in”).
- Create the key on the **same site** you selected (`civitai.com` or
  `civitai.red`), paste it under **Settings → Civitai → API key**, and save.

Also configure **LoRA folder**, **checkpoint folder**, and (for Images)
**images folder** before downloading.

#### Window and lists

- Prefer a separate window? Click **Detach** in the browser header (it reopens
  detached next time). **Attach** docks it back as a modal. Size, position,
  maximized state, and attach/detach preference are remembered. Closing the
  main app also closes the Civitai window and quits.
- Mode chips: **LoRA**, **Checkpoint**, **Images**, **Videos** (remembered per library).
- Model tabs: **Browse**, **Queued**, **Downloaded**, **Maybe**, **Archive**,
  **Notify me**. Badges and status tags include **New**, **Installed** (local
  file match by **AutoV2** hash or filename; or manually marked), **Archived**,
  **Possible match** (similar name — verify or **Mark as installed**).
- **Archive** removes a model from Browse; open the **Archive** tab to
  unarchive or download ones you skipped. **Archive shown** only archives
  on-screen reviewed cards (not the rest of the catalog index).
- Browse filters (persisted): site category tags (Character, Style, Concept, …),
  architecture (SD 1.5, SDXL, Flux, Krea 2, WAN/Video, Other), hide installed,
  only new, only possible matches.
- Early-access models: **Notify me** moves them to the **Notify me** tab
  (hidden from Browse). Countdown labels refresh about once a minute. Use
  **Check availability** there; when unlocked they show as available so you can
  download, then **Remove** from the list.
- **Queued** lists every waiting job (it ignores Browse category filters so the
  grid matches the badge). Transient network failures **pause** the queue
  (~60s auto-retry + manual Resume) instead of wiping it.
- The collapsible **download console** at the bottom of the browser shows a live
  log (filter by level, search, copy) for API waits, retries, and transfers.
- Card size − / + is persisted. Catalog cards load cover-cropped thumbs
  (`w512-…`); new downloads also store untouched CDN bytes as `full-…` next to
  them under `!Thumbnails/`. Older size-tagged thumbs remain valid cache hits.

#### Images tab

- Sort feeds: **Newest**, **Most Reactions**, **Most Comments**, **Most
  Collected** (each is a separate Civitai API ranking, not a local reorder).
- Content: **SFW only** / **SFW + NSFW** / **NSFW only**; optional **Created
  with…** tool filter.
- Architecture / SDXL family chips apply as base-model filters.
- **Download** saves under `<imagesFolder>/<baseModel>/…`. Already-downloaded
  ids are tracked in AppData (changing the images folder does not reset the
  counter).
- **Download all** walks the current feed, skips archived/downloaded cards,
  archives after save, and continues in the background if you switch to LoRA /
  Checkpoint. When a feed has nothing left (or is already caught up from a
  prior run), it shows a **summary panel** (how far back, counts, duration),
  pauses **5 minutes**, then cycles to the next sort. Per-feed **tip
  watermarks** remember how far Newest (and ranked sorts after a full exhaust)
  have been covered so later runs only pull new tip posts. On Browse, if catch-up
  holds too early, use **Continue to end** to ignore the tip for that walk.
- Saved files get **Date modified** set to the creator’s Civitai upload time.
- Sub-tabs: Browse / Downloaded / Archive; filters are remembered.

#### Videos tab

Same shape as Images, aimed at community **videos**:

- Set **Videos folder** in Settings. Files land under
  `<videosFolder>/<base model>/…`.
- Sort feeds, SFW/NSFW mode, and **Download all** with the same per-feed tip
  watermarks and catch-up summary as Images.
- Downloaded ids are tracked separately from images. Changing the videos folder
  does not clear that registry.
- **Blocked authors** (Settings → Civitai) hide that creator’s model and media
  cards. Blocking is per library.

#### LoRA download categories and the download dialog

Name a destination once: LoRA **subfolder** + **wildcard file** + default
**weights**. Manage categories from the Wildcard or LoRA tabs (tags button),
from a selected wildcard (**Set as Category** / **Edit as Category**), or
**Manage…** in the download dialog.

When downloading a LoRA:

1. Pick a category (last used is remembered) and optionally edit weights.
2. Optionally fill **Extra comment** (note between the Civitai URL comment and
   the `<lora:…>` line) and **Extra prompt** (text after trained-word triggers).
3. Confirm — the snippet is appended to the category wildcard (undoable).
   Downloads do not copy the reference to the clipboard (use Copy on the
   categorize-unused dialog if you need a manual paste).

**Shift+click Download** on a card skips the dialog and queues with the same
defaults as opening the dialog and confirming immediately (preferred
non–early-access file, last category, default weights — no extra
comment/prompt).

Checkpoints keep a folder-only picker (no wildcard append).

When a category is used, the LoRA snippet looks like:

```text
# https://civitai.com/models/<id>/<slug>
# optional extra comment line(s)
<lora:filename:{0.8|0.9|1|1}> {1-2$$trigger1 | trigger2} optional extra prompt
```

Paste that into a wildcard file. Multiple trigger words become a Dynamic Prompts
multi-select pick; a single trigger stays plain. Trigger words come from Civitai
when present; otherwise the `<lora:…>` line stands alone.

### Focus and navigation

Only the focus node's ancestor path and a capped descendant cone are drawn
(depth, per-parent breadth, and total visible-node limits). This keeps large
libraries navigable while validation still runs over the full dependency graph.

- Click a node to select and focus it.
- The viewport pans to center the node while preserving zoom.
- Dashed `+N more` frontier nodes represent hidden descendants (depth or
  breadth cuts); click to drill into that branch.
- Very wide roots may start at one level until you drill in.
- Use **Reset focus** to return to the root.
- Pan, zoom, fit, or navigate through the minimap with React Flow controls
  (the minimap is hidden when the drawn cone is very large).

The splitter before the details panel can be dragged. Keyboard users can focus
it and use Left/Right, Home/End, or double-click to reset. Width is persisted.

## Diagnostics

The Details panel shows issues on the selected node and all issues reachable
from the analysis root. The wildcard editor fills the height under the file
actions. When the node and the graph are clear, **No issues on this node**,
**All issues (0)**, **Graph is valid**, and **Refresh** share one line. When
either list has issues, that list grows under the editor and scrolls once it
reaches about half the panel, so the editor stays at least that tall. Use
**Refresh** to re-scan without changing the selected node or graph focus.

| Code | Meaning |
| --- | --- |
| `missing_file` | An exact wildcard target does not exist |
| `glob_no_match` | A glob matched no files |
| `cycle` | A reference closes a recursive path |
| `unclosed_wildcard` | Opening `__` has no closing `__` |
| `unbalanced_brace` | `{` / `}` structure is invalid |
| `bad_multiselect` | `$` / `$$` inside `{…}` is malformed |
| `orphan_pipe` | `|` occurs outside `{…}` |
| `unsupported_wildcard_logic` | Dynamic Prompt logic inside `__…__` on a ComfyUI library |
| `empty_file` | No active non-comment lines |
| `read_error` | A file/graph limit or unsupported structured expansion was encountered |
| `missing_lora` | A `<lora:…>` tag does not match any model in the configured LoRA folder |
| `invalid_lora` | A `<lora:…>` tag is missing a model name (e.g. `<lora:>`) |
| `unused_lora` | A LoRA file exists on disk but is not referenced by any wildcard file |

Click an issue to focus its node and jump to the recorded source line. A missing
issue jumps to the referring parent because the missing node has no source file.

### Missing references

Two quick fixes are available:

- **Create file…** creates the expected relative path (default `.txt`).
- **Remove all references…** removes tokens with the same normalized exact
  name throughout the library.

Both are grouped, undoable mutations.

### Cycle Resolver

The resolver groups strongly connected nodes, ranks single-edge removals
safest-first, and reports:

- token removal versus whole-line removal;
- estimated impact;
- whether the edit breaks all cycles in that group;
- nodes that may become unreachable;
- before/after source.

Choose **Open in editor** for manual work or **Apply selected fix** to perform the
previewed change.

## Editor

The CodeMirror editor provides:

- line numbers and active-line highlighting;
- `Ctrl+F` search (`Esc` closes search);
- wildcard/variant/weight/multiselect highlighting for `.txt`;
- native YAML and JSON highlighting;
- issue-line highlighting and line/column jumps.

Changes are written only when **Save** is pressed. Cancel discards the current
editor buffer.

## File operations

### Rename / move

Enter a new extensionless key such as `clothing/headwear/hats`. The original
extension is retained. A live preview lists affected exact references and blocks
collisions or invalid names.

Exact references are rewritten case-insensitively. Globs are deliberately not
rewritten because changing a file can alter a glob's match set; the preview
warns which files contain matching globs.

### Delete

Deleting removes the file and strips inbound exact references, including
structured nested references that resolve to that host. Matching globs remain
unchanged and are reported as warnings.

### Consolidate forwarder

A simple forwarder has exactly one active non-comment line and that line is one
non-glob wildcard:

```text
__new-name__
```

Consolidation rewrites callers of the forwarder to `__new-name__`, then deletes
the forwarder.

### Absorb target, keep name

For the same simple-forwarder shape, Absorb performs the inverse naming choice:
it keeps the forwarder's filename, copies the target's content into it, rewrites
target references to the kept name, and deletes the target.

Always inspect impact previews. Both operations can affect many files.

## Undo, redo, and backups

Every app-initiated edit, create, rename, delete, consolidation, absorption,
missing-reference cleanup, and cycle fix becomes one history entry.

- History is in memory, capped at 50 entries, and scoped to the open library
  session.
- Opening a library resets history. Create, rename, delete, consolidate, and
  absorb currently reopen the library afterward, so they also clear prior undo
  entries (the just-applied change is not kept as an undoable step either).
  Save, missing-reference cleanup, and cycle fixes refresh without resetting
  history.
- New mutations clear the redo stack.
- Before applying a mutation, the app attempts to store changed files and a
  manifest in `userData/backups/<root-hash>/<timestamp>_<id>/`.
- Backups are best-effort; backup failure does not cancel the mutation.

Undo/redo triggers a file-list refresh and graph reanalysis.

## Expansion

The expansion engine reads active `.txt` lines, resolves nested wildcards and
globs, expands nested variants, supports weights and multi-select ranges, and
guards against recursion/depth runaway.

Random mode uses weighted choices and a deterministic seed. Exhaustive mode
enumerates choices but does not attach probability. Missing references remain
literal and produce a warning. See [syntax.md](syntax.md) for exact semantics.

## Simulation

Simulation performs seeded random walks without building output strings. It
counts:

- **hit:** iterations where a node appeared at least once;
- **visit:** total selections, which can exceed iterations;
- **reach:** hits divided by iterations;
- **parent share:** edge visits divided by parent visits.

The sibling color score compares each child's parent share with the most common
sibling. A node reachable through several parents uses its worst balance score,
helping expose a branch that is rare in any context.

## Automatic refresh and persistence

The main process watches the selected root and debounces filesystem changes by
250 ms. Recursive watching is attempted first; platforms without it fall back
to watching the root directory only. **Rebuild** always refreshes manually.

The app remembers up to 12 recent roots, the last root/file, details-panel width,
graph layout style, and simulation settings in Electron
`userData/settings.json`.

## Important limits

- YAML/JSON keys are global mapping paths; their physical filename is not a
  prefix. Nested-key rename/edit refactors are not yet available.
- This is a subset of `sd-dynamic-prompts`, not a drop-in implementation of
  every A1111 or ComfyUI extension feature.
- Glob semantics differ from upstream fuzzy matching; see [syntax.md](syntax.md).
- Undo does not survive restart, although backup files do.
- Folder-level refactors, split/merge, bulk cleanup, and a dedicated unused-file
  report are not implemented.
