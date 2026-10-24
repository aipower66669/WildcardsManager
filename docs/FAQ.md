# Frequently asked questions

Answers describe Wildcards Manager as it works in the current source tree. If this file and the running app disagree, trust the app.

## Install and where things are saved

### 1. What is Wildcards Manager?

A local desktop app for people who keep large Dynamic Prompts wildcard libraries for Stable Diffusion WebUI or ComfyUI. It shows how files reference each other, validates a documented syntax subset, and can edit the library with previews. It also browses local LoRAs and checkpoints, downloads from Civitai and Hugging Face, and can queue image generation through a ComfyUI server you already run.

### 2. Does the app generate images by itself?

No. Generation sends a job to ComfyUI. Shipped graphs cover Krea 2, and SDXL, Pony, and Illustrious (one checkpoint, with a replaceable VAE, CLIP skip, and a hires pass). The Windows installer does not install ComfyUI, models, or custom nodes. You install those, set the library’s Generation family, point **Settings → AI** at the server, and **Save Workflow** for that family.

### 3. Which installers exist?

GitHub releases publish a Windows x64 NSIS `.exe` only. The release workflow does not build macOS or Linux packages, and those systems have not been tested. The app might run there from source, but there is no installer to download. The Windows build is unsigned, so SmartScreen may warn on first launch.

With no folder under **Settings → General → App updates**, **Check for update** uses the public [GitHub Releases](https://github.com/aipower66669/WildcardsManager/releases) and only reports whether a newer installer exists. It does not open a window. **What's new** is a separate button for that version's release notes. **Install** downloads the installer, closes the app, and runs it. A folder you set yourself overrides GitHub: the check, the installer, and **What's new** stay in that folder and do not contact GitHub. **What's new** reads `RELEASE_NOTES.md` there, or in the folder above it.

### 4. How do I run it from source?

Install Node.js 22.12 or newer, then `npm ci` and `npm run dev` in the project folder. Use `npm install` only when you mean to update dependencies.

### 5. Do `npm run dev` and the installed app share settings?

Yes. Startup pins Electron `userData` and `sessionData` to `%AppData%/Roaming/wildcards-manager` on Windows (the platform app-data directory plus `wildcards-manager` elsewhere). If an older build left files in a folder named `Wildcards Manager`, files the shared folder does not already have are copied in once. Files already in the shared folder stay as they are.

### 6. Where do settings live?

App preferences, folder pointers, window geometry, the Civitai API key, the Hugging Face token, and the generation form live under that `wildcards-manager` folder (`settings.json`, `generation-form.json`, `comfy-workflow-krea2.json`, `comfy-workflow-sdxl.json`, `comfy-settings.json`, and similar). `generation-form.json` keeps a separate Generation form for each library. An older `comfy-workflow.json` is copied into the Krea slot on first load and left in place. Archive, Maybe, Notify, categories, prompt substitutions, and ignored checkpoints live in the library sidecar, not in AppData.

### 7. What folder should I open as the library?

The wildcard root itself, not a single file and not a parent that merely contains the library. References such as `__clothing/hats__` resolve relative to that root. **Open folder** starts a library; **Library Manager** can hold more than one.

### 8. Which files are indexed?

`.txt`, `.yaml`, `.yml`, and `.json`, recursively. Names that start with `.` are skipped. Utility folders the app writes (`!.wcm`, `!Cache`, `!Thumbnails`) are not wildcard content. Wildcard app data is kept in a sibling folder so it is outside the tree ComfyUI Dynamic Prompts scans.

### 9. How do I try a known-good library?

Open the repository’s `sample_wildcards/` folder and select `0main.txt`. The leading `0` sorts it near the top. Some ComfyUI Dynamic Prompts setups reject `!` in file names, which is why the sample does not use that prefix. `fixtures/wildcards/` is intentionally broken and is for diagnostics, not a starting library.

### 10. What are the main tabs?

**Wildcard files** (graph and editor), **LoRA files**, **Checkpoint files**, **Prompts** (`!gen.txt` trees), **Generation** (ComfyUI queue), and **Search**. The toolbar magnifying glass opens the same search. **Civitai** and **Hugging Face** are separate browsers, not extra workspace tabs.

## Libraries and folders

### 11. Can I keep more than one library?

Yes. **Library Manager** stores several libraries. Each has its own wildcards root, model folders, Civitai site (`civitai.com` or `civitai.red`), validation platform (ComfyUI or Stable Diffusion), and Generation family (`krea2` or `sdxl`, default `krea2`). Switching libraries reloads that library’s catalog and the open workspace, including that library’s Generation form. Two libraries that share a wildcards folder still have separate catalog folders and separate Archive, Maybe, Notify, and category blocks inside the one `library.json`.

### 12. What does each library pointer do?

**Wildcards folder** is the graph. **LoRA folder** is installed LoRAs, existence checks, and LoRA downloads. **Checkpoint folder** is checkpoints and the Benchmark source files. **LoRA training library** is dataset folders with `dataset.json` for series previews. **Prompts folder** is shared by every Generation style. **Generation output (Realistic / Hentai / 3D)** is where that style writes images. **Checkpoint Benchmark folder** receives WCG samples and `benchmark-stats.json`. **Images folder** and **Videos folder** (Settings) receive Civitai community downloads under `<folder>/<base model>/`.

### 13. What if Realistic output is empty?

Realistic falls back to the Prompts folder. The Generation tab labels the second style **Anime**. Library Manager calls that same profile **Generation output (Hentai)** (stored id `hentai`). Anime/Hentai and 3D do not fall back. Set those roots before generating with that style.

### 14. Where do folder-mode images go?

`{style output}/{prompt folder}`. **Settings → AI → Save folder-mode images in a New subfolder** adds `/New` (off until you turn it on and save). The app does not create that folder; the ComfyUI save node does when it writes the image. Typed **Use this prompt** jobs write at the style root.

### 15. What does Migrate library paths do?

It rewrites stored pointers when a tree changes drive or parent, for example `D:\ComfyUI\…` to `E:\AI\ComfyUI\…`. Preview the plan first. Paths outside the old prefix stay unless you override that field. It rewrites pointers and stored absolute paths. It does not move files. Move the folders yourself, then apply the plan.

### 16. Where is per-library data on disk?

Next to the wildcards root, in a sibling folder named `<wildcards folder name>.wcm`. That folder is in the ComfyUI tree. AppData does not hold these lists. One `library.json` holds archive, maybe, notify, blocked creators, LoRA download categories, `promptSubstitutions`, and `ignoredCheckpoints`, with a separate block for each library id. `prompt-coverage.json` is in the same folder. Each library’s Civitai catalog is `cache/civitai-catalog/<library id>/` under that sibling. Hash-miss cache stays in `cache/`. The `!.wcm` folders inside LoRA and checkpoint roots are a different store (hashes and ratings).

### 17. Where is LoRA and checkpoint metadata?

Inside the model root, in `!.wcm/models.json` (hashes, ratings, manual Civitai links, ignored entries) and `!Thumbnails/` for preview images. Those folders stay in the model tree. They are not copied into AppData.

### 18. Will ComfyUI Dynamic Prompts see the app’s JSON?

Wildcard datasets are stored beside the wildcards folder, not inside it, because Dynamic Prompts scans the wildcards tree. Do not move `library.json` back into the content folder. Model roots still use in-tree `!.wcm` because ComfyUI does not treat those folders as wildcard libraries.

### 19. What happens if both an old `!.wcm/library.json` and the sibling file exist?

The file with more membership rows wins where both define the same field. A field present on only one file is kept, so substitutions saved on the sibling are not dropped just because the older file still has longer archive lists. The app writes the sibling file.

### 20. Should I hand-edit `library.json` or `settings.json`?

Use the app. Hand edits are easy to overwrite on the next save, and a bad `library.json` can drop lists. Settings in AppData are pointers and preferences. If a moved library still opens the old path, open a valid folder or use **Migrate library paths…** rather than deleting keys by hand. One exception is a stuck startup: quit, then remove or null `lastRootFile` in `settings.json`, or use **Settings → Clear last file** when the window opens. The other is restoring a wiped Archive, Maybe, Notify, or category list: quit completely (including the tray), rename the live `library.json` to a name that does not start with `library.json`, and copy `library.json` from a backup of that same `.wcm` folder. Do not edit the file in a text editor. See Troubleshooting, “Archive, Maybe, Notify, or LoRA categories disappeared.”

## Wildcard syntax

### 21. How do I reference another file?

`__colors__` or `__clothing/hats__`. Omit the extension. Backslashes become `/`. Lookup tries the exact path, then a case-insensitive match. The graph records the line and column.

### 22. Why is a file I can see marked missing?

The reference is relative to the open root. Opening a parent or a child folder changes every key. YAML/JSON keys do not include the physical file name. A doubled underscore, a glob with no matches, or syntax this app does not implement will also show as missing. Letter case alone is usually not the cause.

### 23. How do globs work here?

`*` matches inside one path segment. `**` matches across folders. Matching is case-insensitive. `__artists/*__` does not match `artists/history/modern`. `__artists/**__` does. A1111 Dynamic Prompts can let a single `*` cross directories. This app does not. Character classes (`[a-z]`) and `?` are not implemented. A glob with no matches is `glob_no_match`.

### 24. What is `{red|green|blue}`?

A variant. Options split on top-level `|`. Nested braces count. A `|` outside `{…}` is `orphan_pipe`. Weights look like `{5::common|1::rare|unweighted}`. Unweighted options weigh `1`. Random expansion and simulation use the weights. Exhaustive expansion lists options without using the probabilities. The graph still follows references inside every option.

### 25. What is `{2$$red|green|blue}`?

A multi-select. `N$$` picks exactly N. `N-M$$` picks a count in that range. `-M$$` and `N-$$` leave one side open. Bare `$$` in this app ranges from zero through the option count. A second `$$` sets a custom separator; otherwise the separator is `, `. Counts clamp to the number of options. Random mode samples without replacement. Exhaustive mode builds unordered combinations. A `$` outside braces is literal text, which matters for LoRA trigger words that contain `$`.

### 26. What does `# NO VALIDATION` do?

Put it on the physical first line (a UTF-8 BOM is fine). Matching is case-insensitive, leading spaces are allowed, and extra text after the marker is fine. Syntax and empty-file issues from that file are hidden, and its unresolved references do not become missing nodes. References that do resolve still appear and expand. The file stays in the list. The marker does not teach the expander new syntax.

### 27. How do YAML and JSON become wildcards?

Keys are global mapping paths. A file `collections.yaml` with `styles.painting` defines `__styles/painting__`, not `__collections/styles/painting__`. The document must be a top-level mapping. Keys are non-empty scalars without `/`. Values that expand are scalars and lists of scalars. Duplicate global keys are reported. Renaming the file does not rename those keys or rewrite callers. Deleting the file removes exact references to keys it owned. Renaming one nested key is still a manual edit.

### 28. What syntax will the app refuse or ignore?

Jinja2, `${name=value}` prompt variables, samplers like `__~name__` and `__@name__`, Magic Prompt, configurable delimiter characters, full A1111 fuzzy globs, and every ComfyUI-only wildcard extension. On a **ComfyUI** validation platform, a variant written inside `__…__` (for example `__color(|-basic)__`) is `unsupported_wildcard_logic` and does not invent a file with that literal name. On a **Stable Diffusion** platform the same form expands to the concatenated names. Set the platform per library in Library Manager.

### 29. What are the expansion safety limits?

At most 2,000 samples come back. Default recursion depth is 25. Combination estimates saturate at one billion. Recursion stops and is reported instead of looping. A missing target stays in the output as the literal `__name__` text, plus a warning.

### 30. Are comment lines part of the prompt?

A `.txt` line whose trimmed text starts with `#` is a comment. It is not a candidate line, and wildcard or `<lora:…>` tags on that line are not references. Blank lines are skipped. Leading and trailing whitespace on a real line is ignored by expansion.

## Graph, editor, and fixes

### 31. What do the graph nodes mean?

**Root** is the file you selected. **File** is a resolved `.txt` dependency. **YAML/JSON key** is a mapping path. **Glob** fans out to every match. **Missing** is an unresolved exact reference or a glob with no files. **Caller** sits above the root and is a file that directly references it. Click a caller to reanalyze upward.

### 32. Why is the graph smaller than the issue list?

Drawing is capped (depth, breadth, and total nodes) so large libraries stay usable. Validation still walks the full dependency graph. Dashed `+N more` nodes are hidden children; click one to focus that branch. **Reset focus** returns to the root. The header totals describe the full analysis, not only the drawn cone. The minimap hides when the cone is very large.

### 33. How do I change the layout?

**Settings** → graph layout. **Default** is a fixed alphabetical grid. **Optimized** uses a layered layout that reduces crossings and keeps dependencies top to bottom. Optimized is the default for a new profile. The choice is remembered.

### 34. What do the file filters mean?

**All files** is the whole index. **Roots · no parents** means nothing else references the file. **Leaves · no children** means the file references no existing file. **Standalone** means neither. **Empty / invalid** means that file owns a syntax, empty, or unresolved-reference issue. **Has LoRA tags** means a complete `<lora:name:weight>` tag outside comments. Self-references do not change root/leaf class. The text box filters keys and paths on top of the mode.

### 35. When is the editor written to disk?

When you press **Save**. Cancel throws away the buffer. The watcher does not treat unsaved editor text as the file on disk. LM Studio assist also reads the editor draft and writes nothing until you apply a proposal.

### 36. What does Rebuild do?

It reindexes the open root now. The watcher debounces filesystem changes by about 250 ms and prefers a recursive watch, but some platforms only see the top directory. After external edits, Rebuild is the reliable refresh. It also reloads LoRA and checkpoint lists from a fresh folder scan.

### 37. What do the issue codes mean?

`missing_file` — exact target missing. `glob_no_match` — glob matched nothing. `cycle` — a reference loop. `unclosed_wildcard` — `__` left open. `unbalanced_brace` — bad `{` `}`. `unbalanced_paren` — bad `(` `)`. `unbalanced_bracket` — bad `[` `]`. `unbalanced_quote` — a `"` left open. `bad_multiselect` — broken `$` / `$$` inside braces. `orphan_pipe` — `|` outside braces. `unsupported_wildcard_logic` — Dynamic Prompts logic inside `__…__` on a ComfyUI library. `empty_file` — no active lines. `read_error` — unreadable file or the graph safety cap. `structured_parse_error` — YAML or JSON did not parse. `unsupported_structured_value` — a structured value this app does not expand. `duplicate_structured_key` — the same structured key twice, or a clash with a `.txt` file. `missing_lora` — `<lora:…>` name not in the LoRA folder. `invalid_lora` — tag with no model name. `unused_lora` — a file on disk that no wildcard references. `duplicate_lora_hash` — two LoRA files share one AutoV2 hash.

### 38. How do I fix a missing wildcard?

**Create file…** makes the expected relative path (`.txt` if you omit an extension). **Remove all references…** deletes that exact normalized name across the library. Both are undoable as a group while history is still intact. Clicking the issue focuses the referring line, because the missing node has no file of its own.

### 39. How does Cycle Resolver choose a fix?

It groups cyclic nodes and ranks single-edge removals safest first. The preview shows token removal versus deleting the whole line, estimated impact, whether that edit breaks every cycle in the group, nodes that may become unreachable, and the before/after text. **Open in editor** leaves the change to you. **Apply selected fix** writes the previewed edit.

### 40. What is Consolidate?

A forwarder is a file with exactly one active non-comment line, and that line is one non-glob wildcard such as `__new-name__`. Consolidate rewrites callers to that target, then deletes the forwarder.

### 41. What is Absorb?

The same forwarder shape, opposite names. Absorb keeps the forwarder’s filename, copies the target’s content into it, rewrites references that pointed at the target, and deletes the target. Read the impact preview. Either operation can touch many files.

### 42. Does rename update every reference?

Exact references are rewritten without caring about letter case. The original extension stays. Globs are not rewritten, because a rename can change which files a glob matches. The preview lists those glob files as warnings. A name collision or an invalid key blocks the rename.

### 43. What does delete remove?

The file, plus inbound exact references, including structured keys that resolve to that host. Matching globs stay and are reported as warnings.

### 44. How far does undo go?

History is in memory, capped at 50 entries, and belongs to the open library session. Opening a library clears it. Create, rename, delete, consolidate, and absorb reopen the library, so they also clear earlier undo steps, including the change you just applied. Save, missing-reference cleanup, and cycle fixes refresh without clearing history. A new edit clears redo. Before a mutation the app tries to copy changed files into `userData/backups/<root-hash>/<timestamp>_<id>/`. Backup failure does not cancel the edit. There is no in-app backup browser. Undo does not survive a restart; the backup files do.

### 45. What is Expand?

It produces prompt text. **Random** uses weights and a seed. **Exhaustive** lists combinations and does not attach probabilities. On **Prompts**, Expand uses the selected `!gen.txt`. On **Generation**, Expand uses the line **Once** would queue for the current seed and prompt source, after substitutions. Missing references stay literal.

### 46. What do simulation numbers mean?

Simulation counts seeded random walks without building the full strings. **Hit** is iterations where the node appeared at least once. **Visit** is every selection, so it can exceed the iteration count. **Reach** is hits divided by iterations. **Parent share** is edge visits divided by that parent’s visits. The sibling color compares a child with its most common sibling. A node with several parents uses its worst balance, which shows a branch that is rare in at least one context. Iteration count and seed are remembered with the other UI settings.

### 47. How does Search work?

It can search wildcard paths, wildcard file contents (line and snippet), and LoRA and checkpoint file names under the configured model folders. Turn scopes on in the launcher or on the Search tab. Opening a hit switches to the wildcard editor, LoRA files, or Checkpoint files.

### 48. How do I create a wildcard file?

The plus button creates a path relative to the open root. If you omit a supported extension, `.txt` is added. Select the new file to analyze it. The last selected file is restored next launch when it still exists.

## LoRAs and checkpoints

### 49. Which weight files are listed?

`.safetensors`, `.ckpt`, `.pt`, and for checkpoints also `.gguf`. The scan follows directory symlinks and Windows junctions, so files that live on another drive but are linked under the configured root still appear.

### 50. How does a `<lora:name:weight>` tag resolve?

Against the library’s LoRA folder, by relative path or by file name, case-insensitive. Comments are ignored. A complete tag with no matching file is `missing_lora`. `<lora:>` with no name is `invalid_lora`. Set the folder in Library Manager before expecting those warnings.

### 51. What is an unused LoRA?

A model file in the LoRA folder that no wildcard references. The LoRA list can filter to referenced, unused, has sidecar image or JSON, or matched on Civitai. The details pane lists referencing wildcards and can open one in the editor.

### 52. How do I ignore or categorize an unused LoRA?

Ignore hides it from the unused report for this library (`ignoredUnusedLoras` in `library.json`). Categorize appends a snippet into a category wildcard. A training-step series (`Character_000250`, `Character_000500`, or with hyphens) can be ignored together, and the UI can offer a compact pick such as `<lora:Character_000000{250|500}:…>`.

### 53. What is the LoRA training library for?

Point it at the dataset root. For a multi-step series, the app can show validation images recorded in that dataset’s `dataset.json`. Opening a thumb views the file. This is a preview of training output, not a trainer, and it does not start a training run.

### 54. How are local files matched to Civitai?

By AutoV2 hash when the app has one, and by file name. **Possible match** means the names are similar and you should confirm or use **Mark as installed**. **Installed** is a hash or file-name hit, or a manual mark. **Rematch by hash** recomputes matching. Hashes of large files are cached beside the model root.

### 55. Can I avoid hashing a huge checkpoint?

Yes, if a sibling text file with the same stem exists: `ModelName.txt` next to `ModelName.safetensors`, not `ModelName.safetensors.txt`. Lines labeled `HASH256`, `SHA256`, or `AutoV2` supply the hash, and AutoV2 is derived from a full hash when that is what the file contains.

### 56. What does Use in this library do?

Each checkpoint is ticked on by default. Untick it to drop that file from this library’s Generation checkpoint list and from this library’s Benchmark. The file stays on disk. Another library that shares the same checkpoint folder keeps its own tick. The paths are `ignoredCheckpoints` in that library’s `library.json`. A bare file name matches the file in any subfolder.

### 57. Where are checkpoint ratings stored?

A local half-star rating is stored in the checkpoint root’s `!.wcm/models.json`, not in AppData. The Benchmark chart uses `field_rating` from each sample folder’s `mfe_meta` stream when that stream exists, and otherwise this catalog rating. A 5-star catalog rating sorts and weighs the same as an ADS rating of 10. Folders with neither rating are hidden from Rating and Weight order.

### 58. What is on the checkpoint details pane?

Identity (relative path, hash, size, Civitai link), a folder preview image when a same-stem `.jpg` or `.png` exists, the Civitai cover when cached, companion sidecar JSON when present, a **Benchmark** tab when samples exist for that file, and a **Website** tab with the embedded Civitai page. LoRA details omit companion `.json` sidecars because they are rarely useful there.

### 59. Can I delete models from the app?

Yes, from the LoRA and Checkpoint file lists. Deletion removes the weight file you confirmed. If checkpoint master images are associated with that file, the confirm step says so. This is not the same as unticking **Use in this library**, which only hides the file from Generation and Benchmark.

### 60. How do I show a model in Explorer or open its Civitai page?

The file managers can reveal the file in the system folder and open the known Civitai page. From a wildcard, a Civitai URL in a comment above a `<lora:…>` tag can focus that model in the Civitai browser. From a Civitai card, the app can jump back to the matching local file.

## Generation

### 61. What has to be true before Generate works?

ComfyUI is running (or a launch shortcut is set under **Settings → AI**). **Test** reaches the host and port. **Save Workflow** has copied a graph into the app. **Check install**, after that save, accepts the saved graph (prompt, seed, and a save node). It does not scan ComfyUI for missing custom nodes. The style you picked has an output folder. A prompt is typed, or a prompt folder with `!gen.txt` is selected. The checkpoint you want is still ticked **Use in this library**. Sample graphs cover Krea 2, and SDXL / Pony / Illustrious (one checkpoint loader). Another architecture needs the graph adapted in ComfyUI first. Install steps are in the user guide under **Install the nodes and the sample graph**.

### 62. Which nodes must the graph contain?

**LT · Prompt**, **LT · Seed**, and a save node the app can find (**LT · Save Output**, or a class name containing `SaveImage`). When present, the app also fills Negative, Model, CLIP, VAE, Width, Height, Steps, CFG, Sampler, Scheduler, Denoise, Output Folder, and Output Filename. The SDXL graph also fills CLIP skip, Upscaler, Upscale factor, and Hires denoise, and runs a second sampler after the upscale. CLIP on that graph comes from the checkpoint, so an SDXL library hides the CLIP field. A blank Sampler or Scheduler leaves the name already on that node. A blank VAE keeps the VAE packed in the checkpoint. `ComfyUI-Workflow/` has a Krea 2 graph and an SDXL / Pony / Illustrious graph (`WildcardManager-ComfyUI-SDXL-Generation-Workflow.json`, one Checkpoint loader). The Krea 2 graph expects ComfyUI Dynamic Prompts, [badjeff/comfyui_lora_tag_loader](https://github.com/badjeff/comfyui_lora_tag_loader), [CoreyCorza/comfyui-lora-loader](https://github.com/CoreyCorza/comfyui-lora-loader), and [capitan01R/ComfyUI-Krea2T-Enhancer](https://github.com/capitan01R/ComfyUI-Krea2T-Enhancer). `SaveImageToFolder` is not inside the LT zip; it is `comfyui-custom-save-node.zip` in the same folder. Install `comfyui-lora-training` so the folder is `custom_nodes/comfyui-lora-training/` and contains `__init__.py`. Restart ComfyUI after replacing the pack so the new KSampler nodes appear.

### 63. What do Edit Workflow and Save Workflow do?

**Edit Workflow** opens the graph for the active library’s `generationFamily` in ComfyUI so you can change it. **Save Workflow** stores that family’s API graph and LiteGraph UI JSON in `%AppData%/Roaming/wildcards-manager/comfy-workflow-krea2.json` or `comfy-workflow-sdxl.json`. Until that family’s file exists, Generation has nothing to queue. Save again after you change the graph. Saving one family does not overwrite the other. The prompt toolbar stays quiet when the graph is ready. It warns when no workflow is saved, and names the missing nodes when the saved graph cannot run.

### 64. What is Use this prompt versus a prompt folder?

**Use this prompt** queues the text in the box, with the same multi-line `!gen.txt` rules, and writes to the style output root. A prompt folder queues one line from a `!gen.txt`. **Select… [Randomize]** (no folder) picks a folder from the seed. **Recursive**, on the Prompt folder line, includes that folder and sub-folders that have `!gen.txt`. Off uses only the selected folder. The same seed, the same dropdown, and the same Recursive setting pick the same folder and the same line. Seed 0 or below rolls a new seed from the clock on every image. A fixed seed (1 or higher) repeats that image. An empty `!gen.txt` error names the folder. Infinite skips that image and continues.

### 65. What do Once and Infinite do?

**Once** queues a single image, then stops. **Infinite** keeps queuing until you cancel. They use the same pick: a fixed seed repeats the same image, and seed 0 or below rolls a new seed each image. An empty prompt file does not stop Infinite. On a Benchmark run, Infinite continues until every included checkpoint has 10 images, or you cancel. Benchmark **Once** writes one image for the next checkpoint that still needs one. **Cancel** stops the run and interrupts the image in progress. The Prompts `!gen.txt` title bar has the same three actions as square icons (lightning, infinity, stop). They queue that open folder and use the current Generation style, checkpoint, seed, and Recursive setting.

### 66. What is the difference between the dice and Randomize?

The dice sets Seed to −1. Any seed of 0 or below, or a non-numeric seed, rolls a new seed from the clock on every run. The shuffle button writes one random integer of at least 1 into the field and leaves it there, so later runs reuse that seed until you change it. Both buttons are icons; hover them for the tooltip. The crosshair on Last output copies only that image’s seed. It does not change the prompt folder or Recursive.

### 67. What is on Generation versus Options?

Under each style tab (**Realistic**, **Anime**, **3D**), **Generation** holds the prompt folder, checkpoint, seed, size, and prompts. **Anime** is the tab label for the profile Library Manager calls **Hentai**. A Krea 2 library’s **Options** holds CLIP, VAE, and the KSampler fields: Steps, CFG, Sampler, Scheduler, and Denoise. An SDXL library hides CLIP, shows VAE (blank keeps the VAE packed in the checkpoint), CLIP skip (default 2; 1 keeps the last layer), and adds Upscaler, Upscale factor (default 1.5), and Hires denoise (default 0.5) on Generation. Sampler and Scheduler show every name Comfy reports, underscores included. Each style keeps its own values, and each library keeps its own three styles. Switching libraries restores them. Steps, CFG, and Denoise apply when **LT · Steps**, **LT · CFG**, and **LT · Denoise** are in the saved workflow. Sampler and Scheduler apply only when you pick a name; blank keeps the name already on **LT · Sampler** or **LT · Scheduler**. Defaults for a new style are 20 steps, CFG 7, and denoise 1. Hover a label for a short explanation. Additional Positive and Negative use the same prompt editor as **Use this prompt** (wildcard highlighting and `__` completion). They resize vertically, and that height is remembered.

### 68. Why did reusing a seed not match the Infinite image?

It matches when the prompt-folder dropdown, Recursive, checkpoint, and wildcard files are the same as during that run. The crosshair sets only the seed. A fixed seed picks the folder by itself when the dropdown is **Select… [Randomize]** or Recursive is on. If the dropdown is a specific folder and Recursive is off, the seed does not change the folder.

### 69. Where do I turn the New subfolder on?

**Settings → AI → Save folder-mode images in a New subfolder.** Save that page. The next image uses the new path. It is off until you turn it on. Cancel before the image is saved does not leave an empty New folder, because the app does not create the directory.

### 70. What are prompt substitutions?

Per-library find/replace rules applied to the selected prompt before wildcards expand. A rule runs when the checkpoint **file name** contains the keyword, case-insensitive. Parent folders do not count. The extension is ignored. **Find** is exact and case-sensitive. **Replace** may be empty, which deletes the found text. Every occurrence is replaced. Rules run top to bottom, so later rules see earlier replacements. Up to 200 rules are kept; the keyword is limited to 200 characters and the find/replace strings to 2,000. Incomplete rows (no keyword or empty find) are dropped. The list is `promptSubstitutions` in that library’s `library.json`.

### 71. Which prompt text is substituted?

The line from **Use this prompt**, or the line picked from the prompt folder. The extra positive prompt is left as typed. The negative prompt is not run through these rules. Benchmark jobs substitute using the checkpoint being timed, not only the checkpoint selected in the dropdown.

### 72. Why substitute before expansion?

So a generic wildcard such as `__loraname__` can become `__loraname-KromaVersion__` and that new wildcard then expands. Substituting after expansion would only edit finished text and would not switch wildcard files.

### 73. Do I have to press Save in the substitutions window?

Yes. The rows in the dialog are a draft until Save. A failed load disables Save so an empty dialog cannot wipe rules that are already on disk. The window position and size are remembered in AppData (`promptSubstitutionsWindow`), separate from the rules.

### 74. What does `[TESTING]` do?

On a `!gen.txt` line, that prefix forces Generation to pick that line. The tag is stripped before substitution and expansion. Use it to debug one line without commenting out the others. Remove it when you want normal random or weighted picks again.

### 75. What do `[xN]`, `[W=N]`, and `[WEIGHT=N]` do?

They mark a prompt line with an integer weight. Decode repeats that line N times so it is chosen more often, then strips the tag. This is separate from `{5::option}` weights inside a wildcard file.

### 76. What does Categorize do on Generation?

It appends the current prompt into a prompt folder’s `!gen.txt` so a line you typed can become part of the folder deck. That is different from LoRA download categories, which append a `<lora:…>` snippet to a wildcard file.

### 77. What does the Last output panel show?

The latest image, the prompt-folder category as a breadcrumb (useful when a sub-folder was picked), and the positive and negative text stored in the image metadata (`parameters` or `comment`). The folder icon reveals the file. The trash icon deletes it. Collapsing the panel is remembered and leaves more room during long runs. The Prompts tab can show the same last output without leaving the editor.

### 78. What is Checkpoint Benchmark?

A Generation checkbox that walks every `.safetensors` in the checkpoint folder that is still ticked **Use in this library**. Set **Checkpoint Benchmark folder** first. Each image goes to `{benchmarkRoot}/{file stem}/`. Duplicate stems share a folder. Infinite fills each stem to 10 images. Timings are the sampler’s own steps from the first step through the last, so model load and the file save are not included. A run that never reports that full range is thrown away and tried again. Deleting a sample removes that timing and leaves a free slot for the next run. Stats are `{benchmarkRoot}/benchmark-stats.json`. The same samples show on **Checkpoint files → Benchmark**.

### 79. How do I read the benchmark chart?

Open it from the graph button next to the Benchmark checkbox. Every saved timing is drawn. The blue average and the min–max bar use the 5 fastest runs only. Filter names without caring about case. **Rating** order uses `field_rating` in each sample folder’s `mfe_meta` when that stream exists, otherwise the Checkpoint tab rating, and hides checkpoints with neither. A 5-star catalog rating matches an ADS rating of 10. **Weight** mixes that rating with average time: 100 means fastest and highest rated; a fast low-rated result or a slow top-rated one scores lower. The name filter and the sort are remembered. Hover a point for the name. Click a point to load that checkpoint in the dropdown. The window is movable and resizable.

### 80. Can Generation start ComfyUI for me?

If **Settings → AI** has a launch shortcut and the server is offline, the app can start it. You still install ComfyUI and the custom nodes yourself. Host, port, and TLS live in that same settings page, not on the Generation tab.

## Prompts and coverage

### 81. What belongs in the Prompts folder?

Folders of `!gen.txt` files plus optional sample images. Right-click a folder to rename, delete (the system confirms), or add a sub-folder. **+** beside the root creates a top-level folder. **Validate** checks every gen file for missing or invalid wildcards. The editor is the same wildcard editor as the graph.

### 82. What is Prompt Coverage?

One simulated generation per iteration. The count and seed are **Application settings → Simulation** (1–1,000,000, default 10,000) — the same values Simulate uses. Each walk picks a prompt folder at random, then a random decoded line in that folder, then one Monte Carlo wildcard walk. Every folder is equally likely, so a folder with more prompts does not get more walks. Weight tags still make a line more likely inside its own folder. Lower the iteration count when the prompt library has only a few folders. The report groups wildcard files as never, rare, normal, or hot, and shows which prompt folders drive them. Dialog tabs are Never, Ignored, Rare, Hot, All, and By prompt. Rare is the low-reach quartile among files that were hit at least once. Each tab lists every matching row. A worker thread keeps the UI responsive. Closing the dialog does not throw away a finished report. The toolbar shows percent while it runs. Results are `prompt-coverage.json` in the sibling `.wcm` folder. **Ignore** hides a tool file or a rare file from Never Used; those ignores survive later runs. You can also ignore from a wildcard’s toolbar or context menu.

### 83. Why did Samples not load?

The Samples panel can be collapsed, and that choice is remembered. While it is collapsed, selecting a folder does not scan for images. Expand it to load samples. **Last output** on that same panel shows the live Generation preview instead.

## LM Studio

### 84. What does LM Studio assist do?

On a wildcard’s details pane, **Prompt** talks to a local OpenAI-compatible LM Studio server. Set host, model, and an optional API key under **Settings → AI → LM Studio**, then Test. Presets and a free-text instruction propose a new file body. Saved prompts are your instruction library. Nothing is written until you apply the proposal into the open editor.

### 85. Does assist see unsaved edits?

Yes. It reads the editor draft, not a separate copy on disk. Apply writes into that buffer; you still **Save** the file when you want it on disk.

## Civitai models

### 86. Which Civitai site should I pick?

**Settings → Civitai → Site**. `civitai.com` is the SFW-oriented catalog. `civitai.red` is the NSFW catalog. The choice selects the API and the account for **models**. Images and Videos have their own **SFW only / SFW + NSFW / NSFW only** filter. Create the API key on the same site you selected.

### 87. Do I need an API key to browse?

No. Search and browse work without a key. Many model downloads do require one, because the creator requires a logged-in user. Those fail with `401 Unauthorized`. Paste the key under **Settings → Civitai → API key**.

### 88. What are the model tabs?

**Browse**, **Queued**, **Downloaded**, **Maybe**, **Archive**, and **Notify me**. Mode chips are **LoRA**, **Checkpoint**, **Images**, and **Videos**, remembered per library. Cards can show **New**, **Installed**, **Archived**, or **Possible match**.

### 89. What does Archive do?

It hides that model from Browse. Open **Archive** to unarchive or to download something you skipped. **Archive shown** archives the cards currently on screen, not the rest of the catalog. Archive is per library.

### 90. What is Maybe?

A holding list for models you might want later, separate from Archive and from Notify. It is stored in that library’s `library.json`.

### 91. What is Notify me?

For early-access models. They leave Browse and sit on **Notify me** with a countdown that refreshes about once a minute. **Check availability** updates them. When early access ends they can show as available so you can download, then **Remove**. Models that unlock can also stay findable from Browse until you dismiss them.

### 92. What does the download queue do?

**Queued** lists waiting jobs and ignores Browse category filters, so the grid matches the badge. A transient network failure pauses the queue (about 60 seconds, then auto-retry, or Resume yourself) instead of deleting it. You can pause, resume, cancel, and reorder. The download console at the bottom of the browser is a filterable log of API waits, retries, and transfers.

### 93. Do downloads keep going if I leave the browser?

Yes. The queue runs in the main process. Switching from Images back to LoRA, or closing the Civitai panel, does not cancel model or **Download all** jobs. Closing the main window while model downloads are queued opens a dialog: **Keep downloading (close UI)**, **Quit and stop downloads**, or **Cancel**. Keep downloading closes the windows, shows a tray icon, and leaves the process running after the queue finishes until you open the app or quit from the tray. **File → Close UI & keep downloading** (`Ctrl+Shift+W`) does that directly. Images or Videos **Download all** with no model queue hides the window and keeps that job running. **Quit** stops transfers.

### 94. What is a LoRA download category?

A named destination: a LoRA subfolder, a wildcard file, and default weights. Manage them from the Wildcard or LoRA tabs, from **Set as Category** / **Edit as Category** on a wildcard, or from **Manage…** in the download dialog. The last category is remembered. Confirming a download appends a snippet to that wildcard (undoable) and does not copy it to the clipboard. Checkpoints use a folder picker only; they do not append a wildcard line.

### 95. What does the appended snippet look like?

A comment with the Civitai model URL, optional extra comment lines, then `<lora:filename:{weights}>`, then trigger words. Several triggers become a multi-select such as `{1-2$$trigger1 | trigger2}`. One trigger stays plain. Triggers come from Civitai when the model has them. **Extra prompt** is text after the triggers.

### 96. What does Shift+click Download do?

It skips the dialog and queues with the same defaults as opening the dialog and confirming immediately: preferred non-early-access file, last category, default weights, no extra comment or prompt.

### 97. Can I detach the Civitai window?

Yes. **Detach** opens a separate window and the app reopens it detached next time. **Attach** docks it back into the main window. Size, position, maximized state, and that preference are remembered. Quitting the app closes the Civitai window too. Closing the main window while downloads are queued is a separate choice: keep downloading in the tray, or quit and stop them.

### 98. How do browse filters work?

Category tags (Character, Style, Concept, and the rest), architecture (SD 1.5, SDXL, Flux, Krea 2, WAN/Video, Other), hide installed, only new, and only possible matches are remembered per library. Card width is remembered. Covers are cached as cropped thumbs; new downloads can also keep a full-size file under `!Thumbnails/`.

### 99. What does catalog sync do?

The app keeps a local slice of the Civitai catalog so Browse can filter without hitting the API for every card. Each library has its own catalog folder, `cache/civitai-catalog/<library id>/` under the sibling `.wcm`, including when two libraries use the same wildcards folder. You can sync, cancel a sync, and set an auto-sync interval. Hash and preview warming run in the background and report progress. Sync does not download model weights. Dirty pages are saved within about half a second, and again when you quit. Archive, Maybe, and Notify are not stored inside those catalog pages. They are blocks in `library.json`.

## Images, videos, and Hugging Face

### 100. How do community image downloads work?

Set **Images folder** first. Sorts are **Newest**, **Most Reactions**, **Most Comments**, and **Most Collected**. Each sort is a Civitai ranking, not a local reorder. Files land in `<imagesFolder>/<base model>/`. **Date modified** is set to the creator’s upload time. Already-downloaded ids are stored in AppData. Changing the images folder does not reset that registry, so the app still knows which ids it has saved. Sub-tabs are Browse, Downloaded, and Archive. Filters are remembered per library.

### 101. What is Download all?

It walks the current Images or Videos feed, skips archived and already downloaded cards, archives after a successful save, and keeps going if you leave that mode. When a feed is exhausted or already caught up, a summary shows how far the walk went, then the job pauses about 5 minutes and moves to the next sort. Per-feed tip watermarks remember how far Newest, and ranked sorts after a full exhaust, have been covered, so the next run pulls the new tip instead of months of known pages. If Browse catch-up stops too early, **Continue to end** ignores the tip for that walk. Ranked sorts do not stop after a few known tip pages unless that feed was once walked all the way to the end of the API.

### 102. How do Videos differ from Images?

Same browse, sort, content filter, and Download all behavior, with a **Videos folder** and a separate download registry. Blocking a creator hides that person’s model cards and their media cards. Blocks are per library, under Settings → Civitai.

### 103. How do I use Hugging Face, and what should I not expect the app to do?

The **Hugging Face** button searches the Hub, with filters remembered per library. A token under **Settings → AI** is for gated repos. Cards show a sample image when the repo has one, cropped to a portrait 2:3 frame. Clicking a repo name opens that Hub page in a side panel in the Hugging Face window. The external-link icon still opens the system browser. Downloads use their own queue (pause, resume, cancel) next to Civitai model downloads. When the repo contains a `.safetensors` file, that file is downloaded instead of a `.bin` such as `optimizer.bin`. The saved name is the repo id with `/` replaced by `-` (`org/name` → `org-name.safetensors`). A finished download leaves Browse and is listed on **Downloaded** (between Browse and Archive). The download dialog matches Civitai’s LoRA form: last queued category (shared with Civitai), extra categories, weights, extra comment, and extra prompt. The Hub page is also stored on the downloaded LoRA or checkpoint, so its page URL opens that repo. Checkpoints use the category-folder picker. **Show in search** returns it to Browse and does not delete the file. Archived Hub models are per library.

The app will not train a LoRA, install ComfyUI for you, rewrite globs on rename, rename a single YAML key for you, survive undo across a restart, or implement every A1111 or ComfyUI wildcard feature. It does not upload your library anywhere. When you ask an assistant for help, describe the tab and the message you see. Do not paste API keys. You do not need to paste `library.json` for ordinary how-to questions.
