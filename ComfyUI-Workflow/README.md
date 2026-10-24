# ComfyUI files for Generation

These files are what you install so the **Generation** tab can queue ComfyUI.
The Windows app installer does not include them.

| File | Install |
| --- | --- |
| `comfyui-lora-training.zip` | Unzip into ComfyUI `custom_nodes/` so the folder is `custom_nodes/comfyui-lora-training/`, then restart ComfyUI. |
| `comfyui-custom-save-node.zip` | Unzip into ComfyUI `custom_nodes/` so the folder is `custom_nodes/comfyui-custom-save-node/`, then restart ComfyUI. |
| `WildcardManager-ComfyUI-Krea2-Generation-Workflow.json` | Krea 2 graph. Open it in ComfyUI (drag it onto the canvas). |
| `WildcardManager-ComfyUI-SDXL-Generation-Workflow.json` | SDXL, Pony, and Illustrious graph. Open it the same way. |

The Krea 2 graph loads UNET `krea2_turbo_fp8_scaled.safetensors`, CLIP
`qwen3vl_4b_fp8_scaled.safetensors` (type `krea2`), and VAE
`Wan2_1_VAE_fp32.safetensors`. Change those widgets if your Krea 2 files
differ. It also uses the Corza LoRA loader and the Krea 2 enhancer.

The SDXL graph uses one **Load Checkpoint** node. SDXL, Pony, and Illustrious
are the same architecture: the checkpoint file includes the model, both text
encoders, and the VAE. The Generation checkpoint field fills that filename.
Set the library’s `generationFamily` to SDXL in **Library Manager**. That
hides CLIP and shows VAE: blank keeps the VAE packed in the checkpoint, and a
picked file replaces it. It also shows CLIP skip (default 2), the upscaler,
upscale factor, and hires denoise. After the base sample the graph decodes with **Load VAE** (**LT · VAE**),
upscales with
`UpscaleModelLoader` + `ImageUpscaleWithModel` (default
`4x_foolhardy_Remacri.pth`), then `ImageScale` to width × factor and height ×
factor, snapped to a multiple of 8. **LT · Hires size** does that multiply
from **LT · Width**, **LT · Height**, and **LT · Upscale factor**. The scaled
image is encoded and **Hires fix** samples it at the denoise from **LT ·
Hires denoise** (starting at 0.5). Options Denoise stays on the base sampler.
Options drives steps, CFG, sampler, and scheduler on both samplers. Starting
values are 1024×1024, 25 steps, CFG 6, euler, scheduler normal, factor 1.5,
CLIP skip 2. **CLIP Set Last Layer** is already on the CLIP wire, fed by
**LT · CLIP skip**. Set CLIP skip to 1 for a base SDXL checkpoint that was
not trained with a skip. This graph does not
use the Corza loader or the Krea enhancer.

Both graphs already connect **LT · Prompt**, **LT · Seed**, **LT · Steps**,
**LT · CFG**, **LT · Sampler**, **LT · Scheduler**, **LT · Denoise**, width,
height, and the save folder. The SDXL graph also connects **LT · VAE** into
**Load VAE** (that VAE feeds the decodes and the hires encode), **LT · CLIP skip**
into **CLIP Set Last Layer**, **LT · Upscaler**,
**LT · Upscale factor**, **LT · Hires size**, and **LT · Hires denoise**.
Replace `comfyui-lora-training` and restart ComfyUI after updating the pack.

**Edit Workflow** and **Save Workflow** write
`comfy-workflow-krea2.json` or `comfy-workflow-sdxl.json` in
`%AppData%/Roaming/wildcards-manager/`, matching the active library. An older
`comfy-workflow.json` is copied into the Krea file once and left in place.

Both need [ComfyUI Dynamic Prompts](https://github.com/adieyal/comfyui-dynamicprompts)
and [badjeff/comfyui_lora_tag_loader](https://github.com/badjeff/comfyui_lora_tag_loader).
The Krea 2 graph also needs
[CoreyCorza/comfyui-lora-loader](https://github.com/CoreyCorza/comfyui-lora-loader)
and [capitan01R/ComfyUI-Krea2T-Enhancer](https://github.com/capitan01R/ComfyUI-Krea2T-Enhancer).
`SaveImageToFolder` is the `comfyui-custom-save-node.zip` in this folder, not a
pack you look up by that class name. Full steps, then **Test**, **Save Workflow**,
and **Check install** in the app:

[Generation install guide](../docs/user-guide.md#install-the-nodes-and-the-sample-graph).
