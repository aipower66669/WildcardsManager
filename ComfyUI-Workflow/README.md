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
those loader filenames if your models differ.

It also needs ComfyUI Dynamic Prompts, `comfyui_lora_tag_loader`,
`CoreyCorza/comfyui-lora-loader` and `comfyui-krea2t-enhancer`. Full steps, then **Save Workflow** in the app:

[Generation install guide](../docs/user-guide.md#install-the-nodes-and-the-sample-graph).
