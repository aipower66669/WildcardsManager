# LoraTraining — ComfyUI contract nodes

Shared custom-node pack for **LoraTraining** and **Wildcards Manager**. Copy (or
symlink) this folder into ComfyUI `custom_nodes/`, then restart ComfyUI. A zip
of this folder and a wired Generation graph live in
[`../ComfyUI-Workflow/`](../ComfyUI-Workflow/). Install steps:
[user guide](../docs/user-guide.md#install-the-nodes-and-the-sample-graph).

Both apps must ship the **same** package. When adding nodes, append new classes
only — do not change existing LT node class names, inputs, or behaviour.

## Original LT nodes (category: **Lora Training**)

| Class | Display | Role |
|-------|---------|------|
| `LoraTrainingPrompt` | LT · Prompt | Positive prompt from the app (includes `<lora:…:weight>` trigger). Also copies the LoRA into `{lorasFolder}/{validationSubfolder}/`. |
| `LoraTrainingSeed` | LT · Seed | Seed INT (`value` input — not named `seed`, so no Comfy randomize widget) |
| `LoraTrainingStyleIndex` | LT · Style Index | `0` = realistic, `1` = anime — per validation set |
| `LoraTrainingModel` | LT · Model | Checkpoint / diffusion filename (wildcard type for COMBO sockets) |
| `LoraTrainingOutputFolder` | LT · Output Folder | Absolute path to `{dataset}/output/Set N` |
| `LoraTrainingOutputFilename` | LT · Output Filename | Preview stem for the LoRA under validation (no extension) |
| `LoraTrainingInputImage` | LT · Input Image | Absolute-path IMAGE + MASK loader (Upscale / Diversify) |
| `LoraTrainingDenoise` | LT · Denoise | Upscale denoise 0..1 |
| `LoraTrainingMaxSize` | LT · Max Size | Upscale max dimension |

## Shared extensions (Wildcards Manager Generation)

| Class | Display | Role |
|-------|---------|------|
| `LoraTrainingNegativePrompt` | LT · Negative Prompt | Negative prompt text |
| `LoraTrainingCLIP` | LT · CLIP | CLIP filename (wildcard → CLIPLoader combo) |
| `LoraTrainingVAE` | LT · VAE | VAE filename (wildcard → VAELoader combo) |
| `LoraTrainingClipSkip` | LT · CLIP skip | Stop layer for **CLIP Set Last Layer**. The app writes −2 for clip skip 2 and −1 for clip skip 1. A positive 1–12 is converted the same way |
| `LoraTrainingWidth` | LT · Width | Canvas / latent width |
| `LoraTrainingHeight` | LT · Height | Canvas / latent height |
| `LoraTrainingSteps` | LT · Steps | KSampler step count |
| `LoraTrainingCfg` | LT · CFG | KSampler CFG |
| `LoraTrainingSampler` | LT · Sampler | KSampler sampler name (wildcard → combo) |
| `LoraTrainingScheduler` | LT · Scheduler | KSampler scheduler name (wildcard → combo) |
| `LoraTrainingDenoise` | LT · Denoise | Base KSampler denoise 0..1 (same node as the upscale tool). The SDXL second sampler uses **LT · Hires denoise** |
| `LoraTrainingUpscaler` | LT · Upscaler | Upscale-model filename for the SDXL hires pass (wildcard → `UpscaleModelLoader` combo). The sample graph starts at `4x_foolhardy_Remacri.pth` |
| `LoraTrainingUpscaleFactor` | LT · Upscale factor | Size multiplier for the hires pass (default 1.5, range 1–4). Wire into **LT · Hires size** |
| `LoraTrainingHiresSize` | LT · Hires size | Base width × factor and height × factor, snapped to a multiple of 8, for `ImageScale` (1.5 on 1024×1024 is 1536×1536) |
| `LoraTrainingHiresDenoise` | LT · Hires denoise | Denoise for the second KSampler only (default 0.5). The base sampler stays on **LT · Denoise** |
| `LoraTrainingSaveOutput` | LT · Save Output | SaveImage-style sink so the app can fetch from `/history` |

## Wiring tips (LoraTraining)

1. **LT · Prompt** → Dynamic Prompts / CLIP / Load LoRA Tag path (app injects the LoRA tag + stages the file).
2. **LT · Seed** → sampler / Set→Get seed chain (and Dynamic Prompts `seed`).
3. **LT · Style Index** → Select Per-Line index inputs for style wildcards + negatives.
4. **LT · Model** → convert Load Diffusion Model `unet_name` or CheckpointLoader `ckpt_name` to an input, then connect.
5. **LT · Output Folder** + **LT · Output Filename** → save node. Previews land in `output/Set N/`.
6. In LoraTraining: **Settings → ComfyUI** set folders / default model, then **Edit Workflow** → Save → Validate → Run.

## Wiring tips (Wildcards Manager Generation)

1. **LT · Prompt** / **LT · Negative Prompt** → CLIP text encoders (or Dynamic Prompts).
2. **LT · Seed** → sampler seed.
3. **LT · Model** (+ optional **LT · CLIP** / **LT · VAE**) → loaders (convert combo widgets to inputs).
4. **LT · Width** / **LT · Height** → Empty Latent (or equivalent).
5. **LT · Steps** / **LT · CFG** / **LT · Sampler** / **LT · Scheduler** / **LT · Denoise** → convert those KSampler widgets to inputs, then connect. Blank Sampler or Scheduler in the app keeps the name already on the node.
6. **LT · Save Output** → final IMAGE so Generation can pull the result from history.
7. In Wildcards Manager: **Settings → AI → ComfyUI**, then Generation → **Edit Workflow** → **Save Workflow**.

### SDXL, Pony, and Illustrious

These nodes are on `WildcardManager-ComfyUI-SDXL-Generation-Workflow.json` only. Krea 2 does not use them. Pony and Illustrious share this checkpoint graph.

1. **LT · Model** → Checkpoint loader. CLIP comes from that checkpoint, so **LT · CLIP** is not on this graph.
2. **LT · VAE** → Load VAE. That VAE feeds the base decode, the hires encode, and the final decode. A blank VAE in the app keeps the VAE packed in the checkpoint.
3. **LT · CLIP skip** → **CLIP Set Last Layer** on the CLIP wire out of the checkpoint. Default is stop layer −2 (clip skip 2).
4. **LT · Upscaler** → `UpscaleModelLoader` `model_name`, then `ImageUpscaleWithModel`.
5. **LT · Width** / **LT · Height** and **LT · Upscale factor** → **LT · Hires size** → `ImageScale`.
6. **LT · Hires denoise** → the second KSampler. **LT · Denoise** stays on the base KSampler. Steps, CFG, Sampler, and Scheduler feed both samplers.

## Diversify (Context / Expression)

Diversify reuses the same LT contract nodes (**Input Image**, **Prompt**, **Seed**, optional **Model** / **Style Index**, **Output Folder**, **Output Filename**). Capture a separate graph under **Context → Edit Workflow** or **Expression → Edit Workflow**. Face likeness / InstantID / etc. stay entirely in your Comfy graph — the app only injects the LT inputs and writes `{root}_dNN` siblings into the dataset.

## Dynamic Prompts

The app forces `autorefresh` to **No** on Dynamic Prompts nodes when queueing (their Yes mode can discard the seeded RNG). In the app, seed **≤ 0** means a fresh random seed per job (also avoids Dynamic Prompts ignoring `0`).
