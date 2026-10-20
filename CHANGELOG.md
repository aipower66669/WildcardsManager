# Changelog

All notable changes to Wildcards Manager are documented here.

This project follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/)
and uses [Semantic Versioning](https://semver.org/).

## [Unreleased]

## [0.8.0] - 2026-10-20

### Added

- Generation is split into **Generation** and **Options** under each style tab
  (Realistic, Anime, 3D). Options holds CLIP, VAE, and the KSampler fields
  Steps, CFG, Sampler, Scheduler, and Denoise. Each style keeps its own
  values.
- LT nodes **LT · Steps**, **LT · CFG**, **LT · Sampler**, and
  **LT · Scheduler**. **LT · Denoise** fills KSampler denoise. Blank Sampler
  or Scheduler leaves the name already on that node.
- Field labels and Once / Infinite / Cancel have tooltips.
- Generation **shuffle** (next to the seed dice) writes one random number
  into Seed and keeps it. The dice button still sets −1, which rolls a new
  seed from the clock on every image.
- Generation **Substitutions** opens as a movable, resizable window (size
  remembered). It stores per-library prompt
  replacements. When the checkpoint file name contains a keyword, Find text in
  the selected prompt — typed or picked from a prompt folder — is replaced
  before wildcards expand. Rules live in `promptSubstitutions` in that
  library’s `library.json`.
- Checkpoint files can be unticked per library (**Use in this library**). An
  unticked model stays on disk, drops out of that library’s Generation list,
  and is skipped by its Benchmark. Other libraries that share the checkpoint
  folder keep their own ticks. Paths live in `ignoredCheckpoints` in that
  library’s `library.json`.
- Version tags build the Windows NSIS installer in GitHub Actions and attach
  the `.exe` (plus blockmap and `latest.yml`) to the GitHub Release.
- **App updates** check GitHub Releases when the update folder is empty and
  download the installer for this computer. **Check for update** does not open
  notes. **What's new** is a separate button for that version's release notes.
  A folder you set still overrides GitHub.
- **Generation install guide.** `ComfyUI-Workflow/` ships the
  `comfyui-lora-training` node zip and a ComfyUI graph
  (`WildcardManager-ComfyUI-Generation-Workflow.json`). The user guide explains
  how to install both and save the graph so the Generation tab can queue.

### Fixed

- `npm run dev` and the installed app share
  `%AppData%/Roaming/wildcards-manager`. Startup pins that folder so a
  packaged build cannot keep a separate `Wildcards Manager` profile. If that
  older folder exists, files it has and the shared folder lacks are copied
  in; files already saved from dev stay as they are.
- When both the sibling `library.json` and a leftover in-tree `!.wcm`
  `library.json` exist, fields present on only one of them are kept. Prompt
  substitutions saved beside the library stay visible even when the older
  file still has the longer membership lists.
- Benchmark results can filter by checkpoint name. Rating order reads
  `field_rating` from each sample folder’s `mfe_meta` stream, hides folders
  with no rating, and shows that number under each point. Weight order mixes
  that rating with average time (100 = fastest and top rated). The name filter
  and sort are remembered.
- Deleting a Checkpoint Benchmark image removes that timing. The next
  Benchmark run generates a replacement until the checkpoint has 10 images
  again.
- Checkpoint benchmark timings measure the sampler steps from the first step
  through the last. A run that never reports that full range is not saved
  (the image is discarded and retried). The chart still keeps every saved
  timing; the average and the min–max range use the 5 fastest.
- **Expand** on Prompts expands the selected `!gen.txt`. On Generation it
  expands the prompt **Once** would queue for the current seed and prompt
  source.
- An empty `!gen.txt` error names the folder. Infinite skips that image,
  shows the seed, and continues.
- Seed 0 or below no longer repeats the same rolled seed after a failed
  image. Each roll uses the clock.

### Changed

- A fixed seed repeats the same image on **Once** and **Infinite**. The
  folder (when the dropdown is **Select… [Randomize]** or **Recursive** is
  on) and the `!gen.txt` line both come from that seed. There is no shared
  folder deck.
- **Recursive** sits on the Prompt folder line. The workflow-ready line sits
  next to **Edit Workflow**, not in the Generation fields.
- **Once** and **Infinite** stay on the left. **Cancel** stays on the right.
- Additional Positive and Negative resize vertically only, and that height is
  remembered.
- Folder-mode images write to `{style output}/{prompt folder}`.
  **Settings → AI → Save folder-mode images in a New subfolder** adds `/New`
  and is off by default. The app does not create the folder; the ComfyUI save
  node does. Typed prompts still write to the style root.
- The Last output crosshair sets only the seed. It does not change the prompt
  folder or Recursive.

## [0.7.0] - 2026-10-15

First public release. The app already included these workflows; this version
documents them and fixes the cross-platform test failures that blocked CI.

### Added

- **Public documentation** for Library Manager (multiple libraries and every
  folder pointer), path migration when a tree moves, Civitai **Videos**, LoRA
  training-library series, LM Studio prompt assist, blocked Civitai authors,
  checkpoint ratings, and the 3D generation output root.
- Sample `artists/` files used by `demo-glob.txt`.

### Fixed

- Linux CI path tests no longer treat `D:\…` as a relative path under the
  workspace.
- Async model-folder walk uses the same directory checks as the sync walk, so
  subfolders are not skipped when native `realpath` returns a different path
  form (`\\?\` on Windows, symlink targets on Linux).

## [0.6.0] - 2026-10-05

Dedicated Generation workspace, stronger Prompts tab, faster library analysis,
and more reliable Civitai Images / Videos catch-up.

### Added

- **Generation tab** — ComfyUI-driven generation with typed prompt or prompt
  folder `!gen.txt`, style profiles, checkpoint / CLIP / VAE, Edit Workflow /
  Save Workflow, last-output preview, and Categorize into a prompt folder.
- **Prompts folder management** — context menu Rename / Delete (native confirm)
  / Add sub-folder; root **+** to create top-level folders; `!gen.txt`
  validation across the tree.
- **Collapsible panels** — Generation Last output and Prompts Samples (persisted);
  Samples stay unloaded while collapsed.
- **Image / Video Download all feed frontiers** — per-feed tip watermarks so
  later runs stop once they re-enter already-covered Newest (or ranked)
  territory instead of re-scanning months of known pages.
- **Download all sort summary** — insight panel (saved/skipped, pages,
  newest→oldest span, session totals, pause countdown) when a feed finishes or
  catches up.
- **Browse Continue to end** — ignore the tip watermark for the current walk
  when catch-up holds too early.
- Custom separators in choice / variant expansion semantics.

### Changed

- **ComfyUI node pack** — replaced `comfyui-wildcards-manager` with the shared
  `comfyui-lora-training` pack. Generation uses LT nodes plus added LT ·
  Negative / CLIP / VAE / Width / Height / Save Output.
- **Generation Edit Workflow** — saves LiteGraph UI JSON alongside the API graph
  (`%AppData%/wildcards-manager/comfy-workflow.json`).
- **ComfyUI connection** — host/port, Test, and Check install live under
  Settings → AI only.
- **Library analysis** — workers and caches for indexing / wildcard and LoRA
  reference resolution (fewer UI freezes on large libraries).
- Local `npm run dist` / `dist:*` auto-increment the **patch** version before
  packaging (skipped in CI) and remove older `WildcardsManager-*` files from
  `release/`.

### Fixed

- **Browse / Download all false “Caught up”** — tip watermark no longer advances
  on catch-up early-stop (only on true API exhaust); Newest Browse requires a
  streak of settled pages; empty/error tip pages no longer set
  `feedExhaustedAt`. Ranked sorts no longer stop after a few already-known tip
  pages unless that feed was walked to API end at least once.
- Image / video download retry and Browse churn issues when switching origin /
  Retry mid-walk.
- Generation queue / workflow reload and history-brief main-thread stalls during
  long runs.

## [0.5.0] - 2026-08-08

Library-owned data on disk, Civitai community Images, Hugging Face Hub browse,
faster download workflows, in-app updates, and preview/catalog performance work.

### Added

- **Library sidecars on disk** — Archive / Maybe / Notify / marked-installed
  lists, LoRA download categories, and related library state live in a
  **sibling** `<wildcardsBasename>.wcm/` folder next to the wildcards root
  (not inside it — ComfyUI Dynamic Prompts scans the content tree). Catalog /
  hash caches sit under that sibling’s `cache/`. Model hashes, ratings, manual
  Civitai links, download queues, and thumbnails remain next to LoRA /
  checkpoint roots (`!.wcm/`, `!Thumbnails/`). AppData keeps path pointers and
  UI prefs only. First launch after upgrade migrates legacy AppData blobs and
  any in-tree `!.wcm` / `!Cache` under wildcards into the sibling layout.
- **Civitai Images** — browse community gallery (sort feeds, SFW/NSFW modes,
  Created-with tool filter); download to a configured images folder; Downloaded
  / Archive tabs; AppData download registry with O(1) lookups; **Download all**
  in the main process (survives leaving Images; cycles sorts after a 5‑minute
  pause when a feed is exhausted); file mtime stamped to creator upload time;
  image filters remembered per library.
- **Hugging Face Hub** browser — search/browse with persisted filters and a
  download queue alongside Civitai model downloads.
- **In-app updates** — Settings → General → App updates: point at a local
  electron-builder `release/` folder, check for a newer installer, launch it and
  quit the app (NSIS “Run” checkbox relaunches).
- **Shift+click Download** — queues with the last-used LoRA category / default
  options and skips the download dialog.
- **Extra comment & extra prompt** on LoRA download — optional note between the
  Civitai URL comment and the `<lora:…>` line, plus optional prompt text after
  trained-word triggers.
- **Download console** — collapsible live log in the Civitai browser.
- **Global search** — toolbar search opens a launcher; **Search** tab finds
  wildcard names/content plus LoRA and checkpoint filenames.
- **Prompts workspace tab** — browse prompt folders (`!gen.txt` + samples) and
  drive ComfyUI generation hooks (partial).
- **LoRA training-step series** — files like `Name_000250` / `Name_000500` group
  as a series for unused ignore and compact Dynamic Prompts pick snippets.
- **Catalog preview policy** — new downloads keep untouched CDN bytes as
  `full-{hash}.jpg` and a 512×768 cover crop as `w512-{hash}.jpg` for cards.

### Changed

- AutoV2 catalog index stores hash → `{ origin, id }` only (resolves via the
  paged catalog), with a slower debounce write — avoids multi-hundred-MB index
  rewrites freezing the main process.
- Settings flushes persist only dirty libraries’ `library.json` (quit still
  writes all).
- Notify early-access countdown uses a shared clock with minute-resolution
  labels (less UI churn).
- Empty in-memory Archive / Maybe / Notify / category lists no longer clobber
  non-empty on-disk `library.json` (catastrophic wipe guard).
- **Wildcards sidecars leave the ComfyUI scan tree** — in-tree
  `!.wcm` / `!Cache` under the wildcards root migrate to sibling
  `<basename>.wcm/` (+ `cache/`) so Dynamic Prompts no longer indexes them.

### Fixed

- Assorted download-queue and snippet edge cases around Shift+click defaults and
  optional comment/prompt lines.
- Category LoRA downloads no longer copy the reference to the clipboard (it is
  appended to the wildcard only). Civitai LoRA downloads never write the system
  clipboard. Categorize-unused dialog has a Copy reference control for manual
  paste.
- Image Download all no longer accumulates unbounded page lists in memory while
  walking long feeds.

## [0.4.0] - 2026-07-24

Model workspaces, LoRA download categories, a resilient Civitai download queue,
and browse/queue UX polish.

### Added

- **LoRA download categories** — named destinations with a LoRA subfolder,
  wildcard file, and default weight pattern. Manage from the **Wildcard files**
  or **LoRA files** tab (tags button), from a selected wildcard’s
  **Set as Category** / **Edit as Category**, or **Manage…** in the Civitai
  download dialog. LoRA downloads pick a category + editable weights; the
  `<lora:…>` snippet is appended to the category’s wildcard (undoable) and still
  copied to the clipboard. Checkpoints keep the folder-only picker.
- **Main workspace tabs** — **Wildcard files**, **LoRA files**, and **Checkpoint
  files** share the same shell and resizable side panels.
- **LoRA files workspace** — recursive list of the configured LoRA folder;
  filters (all / referenced in wildcards / unused / has sidecar / matched on
  Civitai); identity panel (path, AutoV2, size, folder preview, Civitai cover);
  reverse references into wildcard files with jump-to-edit; issues for the
  selected model; embedded Civitai model page (same session as Browse).
- **Checkpoint files workspace** — same identity + embedded page pattern for the
  configured checkpoint folder; filters include missing AutoV2 hash; companion
  sidecar JSON when present.
- **Folder symlink / junction following** when indexing LoRA and checkpoint
  folders (models on another drive linked under the configured root are
  included).
- **Sibling hash `.txt` sidecars** for checkpoints (`ModelName.txt` next to the
  weight file) — `HASH256` / `SHA256` / `AutoV2` lines supply AutoV2 without
  hashing multi-GB files first.
- **Civitai download queue** — persistent multi-job queue with **Queued** tab,
  pause/resume after transient network failures (~60s auto-retry), and a manage
  dialog. Jobs are no longer wiped when a download fails.
- **Prompts folder workspace** (partial) — manage prompt folders (`!gen.txt` +
  samples) and drive ComfyUI generation from those prompts.

### Changed

- LoRA details omit the companion JSON section (rarely useful for LoRAs);
  checkpoints still show it.
- Model identity meta and preview titles use a denser two-column layout; helper
  copy moved into title tooltips.
- Category chips browse the unified **All** catalog and filter by model tags
  (badge and chip stay in sync). **Queued** ignores category/type/architecture
  filters so the grid always matches the queue badge.
- Download API calls use a separate interactive rate-limit lane from background
  catalog work; pre-transfer status (API wait, rate-limit retry, opening URL)
  shows in the status bar alongside catalog sync.
- Successful downloads move **Queued → Downloaded** immediately (no Browse flash
  while hash rematch catches up).
- Maybe / Downloaded / Archive tab filters match Browse architecture rules
  (primary base model **or** any version row).

### Fixed

- Download progress no longer mixes the next model name with the previous file’s
  100% bar.
- Stuck “Starting…” downloads when waiting on the shared API pacer or silent
  retries — status and timeouts are visible; hung lookups fail instead of hanging
  forever.
- Queued tab showing only the last queued card while the badge counted dozens.
- “Checking for new models…” stuck after filter changes / late sync joins;
  empty categories again show **No models matched these filters.**
- Maybe tab empty / badge count missing while **Include maybe** on Browse still
  showed the same models.
- Delete LoRA no longer strips sibling refs when names share a stem
  (`name` vs `name (1)`); Civitai archive/unmark skipped when another on-disk
  copy shares the hash or model id.
- Version-hash enrich scoped to library-matched cards (not the whole catalog).
- Selection highlight on LoRA / Checkpoint file lists.
- Wildcard append runs only after a successful save; append failures surface in
  the UI.

## [0.3.0] - 2026-07-21

Large Civitai catalogs, hash-based installed detection, and safer browse/archive UX.

### Added

- **Paged catalog cache** for very large Civitai libraries (hundreds of thousands
  of models) without loading the full card list into RAM.
- **Windowed Browse** (~60 cards) with **Show more** over the local id index.
- **Debounced local catalog search** (compact haystack index) so keystrokes filter
  the synced slice without a new API sync per query.
- **AutoV2 hash-based Installed** matching for LoRAs and checkpoints (works after
  rename when filenames no longer match Civitai).
- **Archive shown** — archives only on-screen reviewed cards (not the rest of the
  catalog index); respects SDXL family visibility.
- Card preview **meta icons** for category / SDXL family when those filters are
  ambiguous; matching icons on the family chip row.
- Browse **card size − / +** control (persisted).

### Changed

- Catalog sync identity is type + category + base model (search is local).
- Preview warm/cache uses less disk and RAM for faster loads.
- SDXL family filter uses icon chips instead of a plain dropdown.

### Fixed

- Modal overlays no longer close when selecting text in a field and releasing
  the mouse outside the dialog.
- Dynamic Prompts logic inside wildcard names (e.g. `__color(|-basic)__`,
  `__where{|-indoor}__`) is accepted for **Stable Diffusion** libraries —
  expanded to the concrete wildcards — and only flagged for **ComfyUI**.
  Validation platform is configured per library (Manage libraries…).
- Opening or switching a library boosts that library’s missing Civitai preview
  downloads ahead of the rest of the catalog queue (still behind on-screen
  Browse cards).
- After a LoRA category download appends a reference, the open wildcard editor
  reloads from disk (and suppresses watcher flush) so typing cannot overwrite
  the new line.
- Out-of-memory / long freezes when browsing huge cached catalogs.
- Bulk archive paths that could affect models outside the visible review window
  or family filter.
- Installed detection gaps for renamed local files.

## [0.2.0] - 2026-07-20

Civitai browser, LoRA/checkpoint download workflow, and graph/editor polish.

### Added

- **Civitai browser** for searching and downloading LoRAs and checkpoints.
  - **Sites:** `civitai.com` (SFW catalog) and `civitai.red` (NSFW catalog),
    chosen in Settings. Browse the site that matches the content you want.
  - **API key (optional for browse, required for many downloads):** creators can
    require login to download. Without a key, gated files return 401
    Unauthorized. Create a key on the same site you selected, paste it under
    Settings → Civitai → API key, and save. Browse and search still work without
    a key.
  - Detachable OS window (Attach/Detach) with remembered size, position,
    maximized state, and attach preference. Closing the main app also closes the
    Civitai window and quits.
  - Category tags (Character, Style, Concept, …) and architecture filters
    (SD 1.5, SDXL, Flux, Krea 2, WAN/Video, Other); filters are remembered.
  - Archive list, Installed status (local folder match), possible local-file
    match warnings, and status tags.
  - Download category (sub-folder) picker with create-new and last-used memory.
  - Sticky download progress banner with percent and bytes.
  - LoRA clipboard snippet when download starts: comment URL plus
    `<lora:stem:{0.8|0.9|1}>` and triggers as `{ a | b }` when there are several.
  - Early-access **Notify me** watchlist with availability refresh.
- Issues panel **Refresh** without reselecting a graph node.
- Graph scale safety (breadth/visible caps), wide-root open at 1 level, and
  related navigation UX.
- Convert-to-child configurable suffix; right-click Manage on graph nodes;
  keyboard shortcuts for rename/delete/new file.
- Bottom status bar; resizable files panel; LoRA search-by-name from Settings.

### Changed

- Settings dialog uses a wider two-column layout.
- Civitai card previews use portrait aspect ratio; listing maps include cover
  media so mature models are not shown as “No preview.”

### Fixed

- False Unsaved/Validating flashes on editor load.
- Graph centering and related navigation polish.

## [0.1.0] - 2026-07-19

First public release.

### Added

- Recursive `.txt`, YAML, and JSON wildcard-library indexing.
- Dependency graph with callers, focused navigation, minimap, frontier nodes,
  and selectable Default or optimized Dagre layouts.
- Validation for missing references, unmatched globs, cycles, malformed
  wildcard/variant syntax, invalid structured documents, and empty files.
- Source navigation, CodeMirror editing with wildcard-key completion, and
  opening files in the operating system's default editor.
- Safe create, rename/move, delete, forwarder consolidation, target absorption,
  missing-reference cleanup, and cycle-resolution workflows.
- Atomic writes, pre-mutation backups, and 50-entry session undo/redo.
- YAML/JSON global nested mapping keys with scalar/list expansion, simulation,
  source-aware diagnostics, and duplicate-key detection.
- Seeded random and bounded exhaustive prompt expansion.
- Monte Carlo reach, visit, parent-share, and sibling-balance analysis,
  including glob fan-out.
- Deterministic 69-file SFW sample library and diagnostic fixtures.
- Windows NSIS, macOS DMG, and Linux AppImage packaging workflows.
- User, syntax, troubleshooting, architecture, and development documentation.

### Security

- Filesystem access is constrained to the selected library root.
- Mutations validate supported extensions and use atomic replacement.
- Ambiguous glob references are reported rather than silently rewritten.

[Unreleased]: https://github.com/aipower66669/WildcardsManager/compare/v0.8.0...HEAD
[0.8.0]: https://github.com/aipower66669/WildcardsManager/compare/v0.7.0...v0.8.0
[0.7.0]: https://github.com/aipower66669/WildcardsManager/releases/tag/v0.7.0
[0.6.0]: https://github.com/aipower66669/WildcardsManager/releases/tag/v0.6.0
[0.5.0]: https://github.com/aipower66669/WildcardsManager/releases/tag/v0.5.0
[0.4.0]: https://github.com/aipower66669/WildcardsManager/releases/tag/v0.4.0
[0.3.0]: https://github.com/aipower66669/WildcardsManager/releases/tag/v0.3.0
[0.2.0]: https://github.com/aipower66669/WildcardsManager/releases/tag/v0.2.0
[0.1.0]: https://github.com/aipower66669/WildcardsManager/releases/tag/v0.1.0
