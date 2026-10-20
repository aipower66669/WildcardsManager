# Troubleshooting

Start from the symptom, then the check, then the remedy in the section it names.
Do not delete AppData, a `.wcm` sidecar, or a model folder to “reset” a problem
unless that section says what the deletion removes.

| Symptom | Section |
| --- | --- |
| No library on launch | [The app opens with no library](#the-app-opens-with-no-library) |
| Expected wildcard file is absent | [My files do not appear](#my-files-do-not-appear) |
| A wildcard you can see is reported missing | [A valid wildcard is shown as missing](#a-valid-wildcard-is-shown-as-missing) |
| Glob matches more or less than A1111 | [A glob matches differently in A1111/ComfyUI](#a-glob-matches-differently-in-a1111comfyui) |
| Civitai download returns 401 | [Civitai download fails or is gated](#civitai-download-fails-or-is-gated) |
| Downloads pause and retry | [Civitai downloads keep pausing and retrying](#civitai-downloads-keep-pausing-and-retrying) |
| A finished download is not marked installed | [A finished download is not listed as installed](#a-finished-download-is-not-listed-as-installed) |
| The wildcard file did not gain a LoRA line | [A LoRA download did not change the wildcard file](#a-lora-download-did-not-change-the-wildcard-file) |
| **Test** succeeds and Generation still refuses | [ComfyUI answers Test but Generation is rejected](#comfyui-answers-test-but-generation-is-rejected) |
| ComfyUI saved an image and Last output is empty | [Last output stays empty after a successful ComfyUI image](#last-output-stays-empty-after-a-successful-comfyui-image) |
| A LoRA file exists and something still says missing | [A LoRA exists but a warning or the loader says it is missing](#a-lora-exists-but-a-warning-or-the-loader-says-it-is-missing) |
| Opening a library is slow or the window freezes | [The library is slow to open](#the-library-is-slow-to-open) |

## The app opens with no library

Choose **Open folder** and select the wildcard root itself—not a single file.
The app restores the previous root only when that directory still exists and is
readable.

If a removed/moved root keeps appearing, open another valid folder. Recent-root
settings live in Electron's `userData/settings.json`.

## My files do not appear

Only `.txt`, `.yaml`, `.yml`, and `.json` are indexed. Files/directories whose
names begin with `.` are skipped.

Check that:

- the expected file is under the selected root;
- the extension is supported;
- the process can read the file;
- you have not enabled a restrictive file filter;
- the search field is empty.

Click **Rebuild** after external changes. Recursive filesystem watching is not
available on every platform; the fallback watcher only sees root-level events.

## A valid wildcard is shown as missing

Resolution is relative to the open root and extensions are omitted:

```text
library/clothing/hats.txt -> __clothing/hats__
```

Things to check:

- path spelling and folder level;
- accidental doubled underscores inside the wildcard name;
- whether you opened a parent/child directory instead of the true library root;
- whether the reference relies on extension-specific syntax not supported here;
- whether a YAML/JSON reference incorrectly includes the physical filename;
- whether the YAML/JSON mapping path exists and contains scalar/list values;
- whether another structured file defines the same global key.

Exact lookup is case-insensitive, so letter case alone normally is not the cause.

## A glob matches differently in A1111/ComfyUI

Wildcards Manager treats `*` as one path segment and `**` as recursive:

```text
__artists/*__   # direct children
__artists/**__  # all depths
```

A1111 Dynamic Prompts uses fuzzier glob behavior and may let one `*` cross
directories. See [syntax.md](syntax.md#globs). Always test final prompts in the
exact extension/version that will execute them.

## The graph looks incomplete

The drawing shows the ancestor path plus a capped focus cone below the focused
node (depth, children per parent, and total visible nodes). This display limit
does not limit validation.

- Click a dashed `+N more` node to continue into that branch (depth or breadth cut).
- Use **Reset focus** to return to the root.
- Use React Flow's fit control or minimap (minimap hides on very wide views).
- Select another file in the left sidebar to analyze from a different root.

Very wide roots may open at **1 level** with a status notice until you drill in.
The stats bar shows `showing N`, `breadth limited`, and `cut` when the cone is
capped.

The domain graph has a 5,000-node safety cap. Crossing it produces a `read_error`
warning and truncates analysis.

## The app freezes on launch or when opening a root file

A high fan-out root used to try to draw thousands of nodes and hang the UI. The
graph is now breadth-capped; if you still have an older build stuck on restore:

1. Quit the app.
2. Edit Electron `userData/settings.json` and remove or null `lastRootFile`
   (keep `lastRoot` if you want the library path).
3. Relaunch, then open a smaller file from the file list.

In current builds you can also use **Settings → Clear last file** so the next
launch restores only the library folder.

## Civitai: SFW vs NSFW and API key

Wildcards Manager talks to one Civitai site at a time (**Settings → Civitai →
Site**):

| Site | Meaning |
| --- | --- |
| **civitai.com** | SFW-oriented catalog |
| **civitai.red** | NSFW catalog |

Use the site that matches the content you want. Browse/search does not need an
API key. **Downloads often do:** if a creator requires login, download fails with
`401 Unauthorized` (message like “requires you to be logged in”) until you add a
key from that same site’s account under **Settings → Civitai → API key**.

## Civitai download fails or is gated

1. Confirm the correct **site** is selected (`civitai.com` vs `civitai.red`).
2. Create an API key in your account on that site, paste it under
   **Settings → Civitai → API key**, and save.
3. Confirm a **LoRA folder** or **checkpoint folder** is configured for that
   model type.
4. If the model is early-access or otherwise restricted on Civitai’s side,
   the key alone may not be enough until the listing unlocks.

Archived models only disappear from the in-app Browse list; they remain on
Civitai. Use the **Archive** tab, then **Unarchive**.

**Shift+click Download** skips the options dialog and uses the last LoRA
category / defaults — open the dialog once if you need to change category,
weights, or extra comment/prompt.

## Civitai downloads keep pausing and retrying

A transient network error pauses the model queue for about 60 seconds, then
retries. **Resume** starts the queue sooner. The download console at the bottom
of the browser is the log of API waits, retries, and transfers. That pause is
the retry behavior; it does not mean the job was deleted.

`401 Unauthorized` is not this case. It stops on authentication. Add a key from
the same site, as in the section above.

## A finished download is not listed as installed

**Installed** means the local file matched by **AutoV2** hash or by filename, or
you used **Mark as installed**. **Possible match** is a similar name. Open the
file and confirm it before treating that tag as proof.

Check the destination next:

- LoRA and checkpoint weights go to the folders in **Library Manager**, not to
  an arbitrary path you had open in Explorer.
- **Archive** hides a model from Browse. It is still on the **Archive** tab.
- Hugging Face moves a finished repo from Browse to **Downloaded**. **Show in
  search** puts it back on Browse and does not delete the file.

If the LoRA or Checkpoint file list is empty and the files are on another
drive, see [LoRA / checkpoint list is missing models on another
drive](#lora--checkpoint-list-is-missing-models-on-another-drive).

## A LoRA download did not change the wildcard file

A checkpoint download never appends a wildcard line. A LoRA download appends
only when the chosen category names a wildcard file. The line is written into
that file. It is not copied to the clipboard.

If that stem is already in the file, a later download of the same stem does not
append again. **Shift+click Download** uses the last category, default weights,
and no extra comment or prompt, so the line can be shorter than the one you
expected from a filled-in dialog.

## Civitai Images: download disabled or “already downloaded” wrong

1. Set an **images folder** under Settings (Library / Civitai paths) before
   downloading.
2. Downloaded tracking lives in AppData (`downloaded-civitai-images.json`), not
   as a folder scan — changing the images folder does not reset the counter.
3. If you pointed at a new empty folder after downloading elsewhere, open
   Settings once on the old images folder (or restore AppData) so migration can
   merge a legacy `!.wcm/downloaded-images.json` if present.

**Videos** use the same pattern with a **videos folder** and a separate download
registry. A missing videos folder disables video download the same way a missing
images folder disables image download.

**Download all** continues in the background when you leave the Images tab; use
**Stop** on Images (or wait for the between-sort pause) to halt it.

If Browse says **Caught up through … (tip watermark)** but you know there are
older unarchived cards, click **Continue to end** once — that run ignores the
tip and keeps paging. Tip watermarks only advance when a walk truly reaches
the end of the Civitai feed.

## Generation tab will not start / workflow missing nodes

1. Set **Settings → AI** ComfyUI host/port and use **Test**. **Test** only
   checks that the server answers. **Check install** comes after **Save
   Workflow**: it reads the saved graph for prompt, seed, and a save node. It
   does not scan ComfyUI for missing custom nodes. Before a save it says there
   is no saved workflow yet.
2. Install both zips from [`ComfyUI-Workflow/`](../ComfyUI-Workflow/) and
   restart ComfyUI:
   - `comfyui-lora-training.zip` → `custom_nodes/comfyui-lora-training/`
   - `comfyui-custom-save-node.zip` → `custom_nodes/comfyui-custom-save-node/`
     (class `SaveImageToFolder`). If ComfyUI says that pack failed to import,
     install `piexif` with ComfyUI’s own Python (`pip install piexif`, or on
     the official Windows portable build
     `python_embeded\python.exe -m pip install piexif` from the folder that
     contains `python_embeded`) and restart.
   If Options (Steps, CFG, Sampler, Scheduler, Denoise) does nothing, the
   saved graph does not have those LT nodes yet — add them, **Save Workflow**,
   and restart ComfyUI after replacing the LT pack.
   Red nodes on the canvas are packs that are still missing. The sample graph
   also needs [ComfyUI Dynamic Prompts](https://github.com/adieyal/comfyui-dynamicprompts),
   [badjeff/comfyui_lora_tag_loader](https://github.com/badjeff/comfyui_lora_tag_loader),
   [CoreyCorza/comfyui-lora-loader](https://github.com/CoreyCorza/comfyui-lora-loader),
   and, for this Krea 2 graph,
   [capitan01R/ComfyUI-Krea2T-Enhancer](https://github.com/capitan01R/ComfyUI-Krea2T-Enhancer).
   Install steps are in the
   [user guide](user-guide.md#install-the-nodes-and-the-sample-graph).
3. Open `WildcardManager-ComfyUI-Generation-Workflow.json` in ComfyUI. It is a
   Krea 2 graph. Change the UNET, CLIP, and VAE filenames when your Krea 2
   files differ. For another architecture, adapt the loaders, then
   **Save Workflow** in the Generation tab. That writes
   `%AppData%/Roaming/wildcards-manager/comfy-workflow.json`. Generation has
   no graph until that save succeeds. If you edit the graph later, save again.
   Then run **Check install**.
4. If the queue starts and then reports no output image, the save node is not
   receiving **LT · Output Folder** / **LT · Output Filename**. The sample
   graph already wires those into `SaveImageToFolder` from
   `comfyui-custom-save-node.zip`.
5. Configure a **prompts folder** if you generate from folder `!gen.txt` lines.
   Typed prompts still need a style output folder in Library Manager.
6. A first check: **Use this prompt**, a short line such as
   `a red apple on a wooden table`, **Once**. The image should appear under
   Last output and in the style output folder. A red node in ComfyUI is still
   an install problem. An error that names a wildcard or a LoRA is a library
   problem.

## ComfyUI answers Test but Generation is rejected

**Test** only checks that the server answers. **Check install** reads the saved
workflow for **LT · Prompt**, **LT · Seed**, and a save node. It does not look
for missing custom-node packs. A red node on the ComfyUI canvas is how a
missing pack shows up.

Work down this list:

1. **Save Workflow** has never succeeded. Generation has no graph yet, and
   **Check install** says there is no saved workflow.
2. The saved graph is missing one of those three roles. The status next to
   **Edit Workflow** names what is missing. A ready graph shows no status.
3. The style has no output folder. Realistic can use the Prompts folder.
   **Anime** (Library Manager: **Generation output (Hentai)**) and **3D**
   cannot. Set the folder before generating with that style.
4. The prompt source is a folder whose `!gen.txt` is empty or missing. The
   error names that folder. Infinite skips that image and continues.
5. ComfyUI rejects the prompt after the queue starts. Read the ComfyUI error.
   A missing UNET, CLIP, VAE, or custom node is ComfyUI’s install, not a
   wildcard-graph failure. Install steps are in the section above.

## Last output stays empty after a successful ComfyUI image

**Last output** is the preview the app loaded from the folder it sent as
**LT · Output Folder** after the job. If the save node did not receive
**LT · Output Folder** and **LT · Output Filename**, ComfyUI can still write an
image somewhere else and this pane stays empty. The sample graph wires those
into `SaveImageToFolder`.

Deleting that preview file clears **Last output**.

## A LoRA exists but a warning or the loader says it is missing

Decide which of the three checks failed. They do not share a folder.

| Check | What it looks at | What to verify |
| --- | --- | --- |
| LoRA files list | **Library Manager → LoRA folder**, including symlinks and junctions. Extensions `.safetensors`, `.ckpt`, `.pt` | The file is inside that root. Rescan after you change the folder |
| Wildcard validation | `<lora:name>` in a wildcard file, against that same folder, by relative path or file name, case-insensitive. Comments are ignored | The tag’s name matches a file. `<lora:>` with no name is `invalid_lora`, not a missing file. A tag inside a `#` comment is not checked |
| ComfyUI loader | ComfyUI’s own LoRA directory, after this app has written the tag into the prompt | ComfyUI’s `models/loras` (or the extra paths it scans) contains the file. A file this app lists can still be missing inside ComfyUI |

A `missing_lora` warning is the second row. A ComfyUI error or a red loader
node that names the file is the third row.

## The library is slow to open

The drawing is capped (depth, children per parent, and total visible nodes).
That cap does not limit validation. The analyzed graph stops at 5,000 nodes and
reports a `read_error` if it has to truncate.

If an older build hangs while restoring one huge root file, use
**Settings → Clear last file**, or remove `lastRootFile` from
`userData/settings.json` as described under
[The app freezes on launch or when opening a root
file](#the-app-freezes-on-launch-or-when-opening-a-root-file). Leave
`library.json` and the wildcard files in place.

## In-app update finds nothing / Install does nothing

1. With the update folder empty, **Check for update** uses the public GitHub
   Releases page. A folder you set overrides that and must contain `latest.yml`
   and/or `WildcardsManager-<version>-win-x64.exe`.
2. The installer version must be **newer** than the running app (Settings shows
   the running version). **Check for update** does not open notes. **What's new**
   is the button that opens that version's release notes. With a folder set, those notes come from
   `RELEASE_NOTES.md` in that folder or the folder above it, and the app does
   not ask GitHub.
3. **Install update** downloads the GitHub installer when no folder is set,
   then closes the app and launches the NSIS UI — leave **Run Wildcards
   Manager** checked at the end. Unsigned SmartScreen prompts are expected.

## Archive / Maybe / Notify lists disappeared or look empty

Those lists are stored per wildcards root in the sibling
`<basename>.wcm/library.json` (not inside the wildcards folder, and not in
AppData). Each library is separate — copying another library’s file overwrites
the wrong tree. After upgrading, let the app finish its one-time migrations
(AppData → sidecars, and in-tree `!.wcm`/`!Cache` → sibling `.wcm`), then
restart. If a running older build and a newer build both write settings, prefer
quitting all instances before restoring from backup.

## LoRA / checkpoint list is missing models on another drive

Folder **symlinks** and Windows **directory junctions** under the configured
LoRA or checkpoint root are followed when building the list. If models still
do not appear:

1. Confirm the symlink target exists and is readable by your user account.
2. Click the rescan control on the LoRA / Checkpoint tab (indexes cache briefly).
3. Restart the app after changing Settings folder paths.
4. Confirm the files use a supported extension (`.safetensors`, `.ckpt`, `.pt`).

Broken or cyclic links are skipped; check Explorer/Finder that the link opens.

## Checkpoint shows “hash pending” despite a `.txt` hash file

The sidecar must be named like the model **stem** only, e.g.
`MyModel.txt` beside `MyModel.safetensors` — not `MyModel.safetensors.txt`.
The file should contain a `HASH256`, `SHA256`, or `AutoV2` line the app can
parse. Otherwise the full weight file is hashed in the background.

## Clicking a node changes the graph

Clicking selects and focuses the node, then pans it to the viewport center
without changing zoom. Focusing intentionally redraws the visible four-level
window. Clicking a direct caller makes that file the new root.

## An issue points at the wrong source

Missing nodes have no source file, so selecting a missing-reference issue opens
the referring parent at the recorded line. Cycle issues can belong to both ends
of a recursive edge; the Cycle Resolver shows the concrete file/line for each
candidate edit.

If external editing changed line numbers, click **Rebuild** before navigating.

## `# NO VALIDATION` does not work

The marker must start the physical first line (leading spaces and UTF-8 BOM are
allowed):

```text
# NO VALIDATION
```

It is case-insensitive. A blank line or another comment before it prevents the
marker from applying. It suppresses validation/missing output but does not add
runtime support for custom syntax.

## Rename/delete left a glob unchanged

This is deliberate. Exact references can be rewritten unambiguously; a glob is
a pattern whose match set may grow, shrink, or still remain valid after a file
change. Preview warnings identify files whose globs currently match the affected
key. Review those manually.

## Consolidate or Absorb is unavailable

These operations require a simple forwarder: exactly one active, non-comment
line containing exactly one non-glob reference.

Valid:

```text
# old compatibility alias
__new/location__
```

Not valid:

```text
prefix __new/location__
__first__
__second__
__folder/**__
```

Consolidate can proceed with a missing target but warns that rewritten callers
will remain unresolved. Absorb requires the target file to exist.

## Undo is unavailable after restart, changing libraries, or some refactors

Undo history is intentionally session-only and resets when a library opens.
Create, rename, delete, consolidate, and absorb reopen the library to rebuild
the file list and graph, which also clears the in-memory undo stack. Prefer
disk backups under `userData` if you need to recover those changes. Save,
missing-reference cleanup, and cycle fixes do not reset history.

Disk backups survive restarts, but there is no in-app backup browser yet.

Look under the platform-specific Electron `userData` directory:

```text
backups/<12-character-root-hash>/<timestamp>_<operation-id>/
```

Each backup includes pre-mutation files that existed and `manifest.json`.
Backup creation is best-effort and is not a replacement for version control.

## Expansion produces literal `__name__`

Missing references are preserved literally and reported in the Expand dialog.
Recursion also stops safely rather than looping. Ensure the target resolves.
YAML/JSON roots enumerate the scalar/list values declared by their nested keys;
invalid documents or mapping-only keys with no values produce diagnostics.

## Random output differs from exhaustive output

This is expected:

- random mode uses option weights and a seeded PRNG;
- exhaustive mode enumerates unique index combinations and does not model
  probability;
- count is a returned-sample limit, not a promise that every sample is unique;
- the combination estimate saturates at one billion.

Reusing the same root, files, seed, and count should reproduce random output.

## Simulation percentages look surprising

Three values answer different questions:

- **reach:** iterations where a node appeared at least once;
- **visits:** every selection, including repeated selections;
- **of parent:** edge visits divided by parent visits.

A parent share can exceed 100% if a template references the same child multiple
times per parent expansion. The color is a sibling-relative balance score, not
overall popularity.

## The development build fails

Start clean:

```powershell
node --version
npm ci
npm run typecheck
npm test
npm run build
```

Use Node 22.12+ as documented. `out/`, `release/`, and `node_modules/` are
generated and gitignored.

## Packaging succeeds but the OS warns

The Windows package is unsigned. SmartScreen warnings are expected. Signing is
a roadmap item. In-app **App updates** downloads the newer Windows installer
from GitHub Releases when the update folder is empty. A folder you set still
launches the installer already in that folder.

A version tag builds the Windows installer in GitHub Actions and attaches the
`.exe` to that release. macOS and Linux have no published build and have not
been tested. Running from source on those systems might work.

## Reporting a bug

Include:

- operating system and app/repository version;
- Node version if running from source;
- minimum wildcard files needed to reproduce;
- selected library root and graph root (paths may be anonymized);
- expected and actual behavior;
- screenshot/error text;
- whether the issue also occurs after **Rebuild**.

Do not attach private or sensitive wildcard libraries without reviewing them.
