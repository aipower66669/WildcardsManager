# Wildcards Manager v0.6

Package version: **0.6.0**  
Release date: **October 5, 2026**

Wildcards Manager v0.6 focuses on a full **Generation** workspace with ComfyUI,
a much stronger **Prompts** tab, faster library analysis, and more reliable
Civitai **Images / Videos** Download-all catch-up.

## Highlights

### Generation tab

A dedicated **Generation** tab drives ComfyUI from the app:

- Prompt source: typed **Use this prompt** or a selected prompt folder’s
  `!gen.txt` (multi-line decode, comments, random pick with seed).
- Style profiles (Realistic / Hentai), checkpoint / CLIP / VAE, size, seed, and
  extra positive / negative text.
- **Edit Workflow** / **Save Workflow** for the ComfyUI graph (API + LiteGraph
  UI JSON under `%AppData%/wildcards-manager/`).
- Shared **comfyui-lora-training** node pack (LT Negative / CLIP / VAE / Width /
  Height / Save Output, plus existing LT nodes).
- ComfyUI host / Test / Check install under **Settings → AI**.
- Collapsible **Last output** preview (persisted) for long unattended runs.
- **Categorize** a generated prompt into a prompt folder’s `!gen.txt`.

### Prompts workspace

- Folder tree with **Rename**, **Delete** (native confirm), and **Add
  sub-folder** (Explorer-style inline rename); **+** on the root path for
  top-level folders.
- Validate every `!gen.txt` for missing / invalid wildcards; filter folders with
  issues.
- Collapsible **Samples** panel — while collapsed, folder selection does **not**
  scan for random sample images.

### Library performance

- Analyze / wildcard and LoRA reference resolution moved onto workers and
  caches so large libraries stay responsive with far fewer UI freezes.

### Civitai Images / Videos catch-up

- Per-feed **tip watermarks** so Download all / Browse stop once they re-enter
  already-covered Newest (or ranked) territory.
- Browse catch-up no longer promotes the live first page into the tip (which
  caused “Caught up through …” while older unarchived cards still existed).
- Newest Browse requires a streak of settled pages before holding; **Continue
  to end** ignores the tip for that run.
- Empty / error tip pages no longer poison `feedExhaustedAt`.
- Sort-finished **insight panel** (saved/skipped, pages, date span, session
  totals, pause countdown).

### Other

- Custom separators in choice / variant semantics.
- Local `npm run dist` / `dist:*` auto-increment the **patch** before packaging
  (skipped in CI) and prune older `WildcardsManager-*` files from `release/`.

## Installation

Download the appropriate artifact from the
[GitHub release](https://github.com/aipower66669/WildcardsManager/releases/tag/v0.6.0).

Installers are not code-signed or notarized. Your operating system may display
an unknown-publisher warning.

To run from source:

```powershell
git clone https://github.com/aipower66669/WildcardsManager.git
cd WildcardsManager
npm ci
npm run dev
```

Node.js 22.12 or newer is required.

After packaging (`npm run dist:win`), set **Settings → App updates** to the
`release/` folder so later builds can be installed from inside the app. Each
local `dist` run bumps the patch (`0.6.0` → `0.6.1` → …) so Check for update
detects the new installer.

## Upgrading from v0.5

- Configure **ComfyUI** under **Settings → AI** (host/port, optional launch
  path) before using the Generation tab.
- Install / update the shared **comfyui-lora-training** custom node pack if you
  use Generation workflows.
- Set a **prompts folder** (Library Manager / Settings) for the Prompts and
  Generation folder pickers.
- Existing Image Download-all frontiers keep working; Browse catch-up tip
  rewrites from older builds are corrected by this release’s tip rules.
- In-app updates still use your local `release/` folder (same as v0.5).

## Known limitations

- Compatibility intentionally covers a documented subset of Dynamic Prompts;
  fuzzy globbing and extension-specific constructs can differ.
- Undo/redo history does not survive an app restart.
- Nested YAML/JSON keys can be edited manually but are not independent refactor
  targets.
- Folder-level wildcards refactors, split/merge, bulk cleanup, and the dedicated
  library health report are not yet available.
- Civitai model “Include NSFW” / site choice still matters: use **`civitai.red`**
  for mature **model** catalogs; Images has its own SFW/NSFW mode on the Images
  tab.
- The catalog **index** count is the synced type/base-model slice and still
  includes installed/hidden entries — it is not “how many Archive shown clicks
  remain.”
- Generation requires a running ComfyUI with the LT node pack and a saved
  workflow; it is not a full ComfyUI studio replacement.
- Installers are unsigned. In-app update only launches a local installer you
  already built into the configured folder (not auto-download from GitHub).
- On Windows, file **Date created** may still show download time; **Date
  modified** is stamped to the Civitai upload time for Images downloads.

## Licensing

- Software: PolyForm Noncommercial License 1.0.0.
- `sample_wildcards/`: CC BY-NC-SA 4.0.

See [LICENSE.md](LICENSE.md) for complete terms.
