# LoraTraining — ComfyUI contract nodes

Shared custom-node pack for **LoraTraining** and **Wildcards Manager**. Copy (or
symlink) this folder into ComfyUI `custom_nodes/`, then restart ComfyUI.

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
| `LoraTrainingWidth` | LT · Width | Canvas / latent width |
| `LoraTrainingHeight` | LT · Height | Canvas / latent height |
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
5. **LT · Save Output** → final IMAGE so Generation can pull the result from history.
6. In Wildcards Manager: **Settings → AI → ComfyUI**, then Generation → **Edit Workflow** → **Save Workflow**.

## Diversify (Context / Expression)

Diversify reuses the same LT contract nodes (**Input Image**, **Prompt**, **Seed**, optional **Model** / **Style Index**, **Output Folder**, **Output Filename**). Capture a separate graph under **Context → Edit Workflow** or **Expression → Edit Workflow**. Face likeness / InstantID / etc. stay entirely in your Comfy graph — the app only injects the LT inputs and writes `{root}_dNN` siblings into the dataset.

## Dynamic Prompts

The app forces `autorefresh` to **No** on Dynamic Prompts nodes when queueing (their Yes mode can discard the seeded RNG). In the app, seed **≤ 0** means a fresh random seed per job (also avoids Dynamic Prompts ignoring `0`).
