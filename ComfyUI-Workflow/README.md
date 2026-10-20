# ComfyUI files for Generation

These three files are what you install so the **Generation** tab can queue ComfyUI.
The Windows app installer does not include them.

| File | Install |
| --- | --- |
| `comfyui-lora-training.zip` | Unzip into ComfyUI `custom_nodes/` so the folder is `custom_nodes/comfyui-lora-training/`, then restart ComfyUI. |
| `comfyui-custom-save-node.zip` | Unzip into ComfyUI `custom_nodes/` so the folder is `custom_nodes/comfyui-custom-save-node/`, then restart ComfyUI. |
| `WildcardManager-ComfyUI-Generation-Workflow.json` | Open this graph in ComfyUI (drag it onto the canvas). |

The graph is a Krea 2 example (UNET `krea2_turbo_fp8_scaled.safetensors`, CLIP
`qwen3vl_4b_fp8_scaled.safetensors`, VAE `Wan2_1_VAE_fp32.safetensors`). Change
those loader filenames if your Krea 2 files differ. Wildcards Manager is not
limited to Krea 2; another architecture needs the loaders adapted in ComfyUI
before **Save Workflow**.

v0.8 adds **LT · Steps**, **LT · CFG**, **LT · Sampler**, **LT · Scheduler**,
and uses the existing **LT · Denoise** for KSampler. Replace the installed
`custom_nodes/comfyui-lora-training` folder with this zip and restart ComfyUI.
The sample graph does not wire those five inputs yet. Convert the KSampler
widgets to inputs, connect the LT nodes, then **Save Workflow**. The
Generation **Options** tab fills them per style.

It also needs [ComfyUI Dynamic Prompts](https://github.com/adieyal/comfyui-dynamicprompts),
[badjeff/comfyui_lora_tag_loader](https://github.com/badjeff/comfyui_lora_tag_loader),
[CoreyCorza/comfyui-lora-loader](https://github.com/CoreyCorza/comfyui-lora-loader),
and [capitan01R/ComfyUI-Krea2T-Enhancer](https://github.com/capitan01R/ComfyUI-Krea2T-Enhancer).
`SaveImageToFolder` is the `comfyui-custom-save-node.zip` in this folder, not a
pack you look up by that class name. Full steps, then **Test**, **Save Workflow**,
and **Check install** in the app:

[Generation install guide](../docs/user-guide.md#install-the-nodes-and-the-sample-graph).
