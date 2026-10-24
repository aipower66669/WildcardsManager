"""LoraTraining ComfyUI contract nodes (shared with Wildcards Manager).

Wire these into your validation, upscale/detail, or Generation workflow. Apps
inject values by class name:

  * LoraTrainingPrompt         -> STRING (+ stages LoRA into models/loras)
  * LoraTrainingSeed           -> INT
  * LoraTrainingStyleIndex     -> INT (0 = realistic, 1 = anime)
  * LoraTrainingModel          -> STRING  (checkpoint filename for CheckpointLoader)
  * LoraTrainingOutputFolder   -> STRING  (output folder path)
  * LoraTrainingOutputFilename -> STRING  (preview/result basename stem)
  * LoraTrainingInputImage     -> IMAGE, MASK (loads an absolute-path image; Upscale tool)
  * LoraTrainingDenoise        -> FLOAT (0..1; Upscale tool KSampler denoise)
  * LoraTrainingMaxSize        -> INT (Upscale tool "Scale Image to Max Dimension")
  * LoraTrainingNegativePrompt -> STRING
  * LoraTrainingCLIP           -> STRING / wildcard (CLIPLoader combo)
  * LoraTrainingVAE            -> STRING / wildcard (VAELoader combo)
  * LoraTrainingWidth          -> INT
  * LoraTrainingHeight         -> INT
  * LoraTrainingSteps          -> INT (KSampler steps)
  * LoraTrainingCfg            -> FLOAT (KSampler cfg)
  * LoraTrainingSampler        -> STRING / wildcard (KSampler sampler_name)
  * LoraTrainingScheduler      -> STRING / wildcard (KSampler scheduler)
  * LoraTrainingSaveOutput     -> SaveImage-style sink for /history fetch
"""

from __future__ import annotations

import hashlib
import json
import os
import re
import shutil
from pathlib import Path

import numpy as np
import torch
from PIL import Image, ImageOps, PngImagePlugin

import folder_paths

CATEGORY = "Lora Training"


class _AnyType(str):
    """Wildcard Comfy type — allows linking into COMBO inputs (unet_name / ckpt_name).

    Plain STRING cannot connect to Load Diffusion Model / CheckpointLoader combo
    sockets after “Convert Widget to Input”.
    """

    def __ne__(self, other: object) -> bool:
        return False


ANY = _AnyType("*")


def _sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        while True:
            block = stream.read(8 * 1024 * 1024)
            if not block:
                break
            digest.update(block)
    return digest.hexdigest()


def _files_identical(first: Path, second: Path) -> bool:
    if first.stat().st_size != second.stat().st_size:
        return False
    return _sha256(first) == _sha256(second)


def _atomic_copy(source: Path, destination: Path) -> None:
    temporary = destination.with_name(destination.name + ".copying")
    try:
        if temporary.exists():
            temporary.unlink()
        shutil.copy2(source, temporary)
        if temporary.stat().st_size != source.stat().st_size:
            raise RuntimeError("Temporary LoRA copy has the wrong size.")
        temporary.replace(destination)
    except Exception:
        try:
            if temporary.exists():
                temporary.unlink()
        except OSError:
            pass
        raise


def _refresh_lora_cache() -> None:
    try:
        cache = getattr(folder_paths, "filename_list_cache", None)
        if isinstance(cache, dict):
            cache.pop("loras", None)
        folder_paths.get_filename_list("loras")
    except Exception as exc:
        print(f"[LT · Prompt] Warning: unable to refresh LoRA filename cache: {exc}")


def _sanitize_subfolder(value: str) -> Path:
    value = (value or "").strip().replace("\\", "/").strip("/")
    if not value:
        return Path("!Testing")
    parts = []
    for part in value.split("/"):
        part = part.strip()
        if not part or part in {".", ".."}:
            continue
        cleaned = re.sub(r'[<>:"|?*\x00-\x1f]', "_", part).rstrip(" .")
        parts.append(cleaned or "_")
    return Path(*parts) if parts else Path("!Testing")


def _resolve_lora_root(comfy_lora_root: str = "") -> Path:
    raw = (comfy_lora_root or "").strip()
    if raw:
        root = Path(raw).expanduser().resolve()
    else:
        roots = folder_paths.get_folder_paths("loras")
        if not roots:
            raise RuntimeError(
                "ComfyUI has no configured LoRA folder, and no lorasFolder was injected."
            )
        root = Path(roots[0]).expanduser().resolve()
    root.mkdir(parents=True, exist_ok=True)
    return root


def stage_lora_into_comfy(
    source_path: str,
    existing_copy_policy: str,
    comfy_lora_root: str = "",
    comfy_lora_subfolder: str = "!Testing",
) -> str:
    """Copy ``source_path`` into ``{loras_root}/{subfolder}/{basename}``.

    Returns a short status string. Empty ``source_path`` is a no-op.
    """
    raw = (source_path or "").strip()
    if not raw:
        return "skipped_empty_source"

    source = Path(raw).expanduser().resolve()
    if not source.is_file():
        raise RuntimeError(f"LoRA source file not found:\n{source}")

    root = _resolve_lora_root(comfy_lora_root)
    sub = _sanitize_subfolder(comfy_lora_subfolder)
    destination = (root / sub / source.name).resolve()
    try:
        destination.relative_to(root)
    except ValueError as exc:
        raise RuntimeError("LoRA destination escaped the ComfyUI LoRA folder.") from exc

    destination.parent.mkdir(parents=True, exist_ok=True)

    if not destination.exists():
        _atomic_copy(source, destination)
        status = "copied"
    elif not destination.is_file():
        raise RuntimeError(f"LoRA destination exists but is not a file:\n{destination}")
    elif _files_identical(source, destination):
        status = "already_present_identical"
    elif existing_copy_policy == "overwrite_if_different":
        _atomic_copy(source, destination)
        status = "overwritten_different"
    else:
        raise RuntimeError(
            "A different file already exists at the staged LoRA destination:\n\n"
            f"Source:\n{source}\n\nDestination:\n{destination}\n\n"
            "Nothing was overwritten."
        )

    _refresh_lora_cache()
    print(f"[LT · Prompt] LoRA stage ({status}): {destination}")
    return status


class LoraTrainingPrompt:
    """Positive prompt the app fills (includes <lora:…:weight> trigger).

    Also stages ``lora_source`` into Comfy's LoRA folder so Load LoRA Tag can
    resolve the injected ``<lora:stem:…>`` tag.
    """

    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "text": ("STRING", {"default": "", "multiline": True}),
            },
            "optional": {
                "lora_source": ("STRING", {"default": "", "multiline": False}),
                "existing_copy_policy": (
                    [
                        "reuse_if_identical_error_if_different",
                        "overwrite_if_different",
                    ],
                    {"default": "reuse_if_identical_error_if_different"},
                ),
                "comfy_lora_root": ("STRING", {"default": "", "multiline": False}),
                "comfy_lora_subfolder": ("STRING", {"default": "!Testing", "multiline": False}),
            },
        }

    RETURN_TYPES = ("STRING",)
    RETURN_NAMES = ("text",)
    FUNCTION = "passthrough"
    CATEGORY = CATEGORY

    def passthrough(
        self,
        text,
        lora_source="",
        existing_copy_policy="reuse_if_identical_error_if_different",
        comfy_lora_root="",
        comfy_lora_subfolder="!Testing",
    ):
        stage_lora_into_comfy(
            lora_source,
            existing_copy_policy,
            comfy_lora_root=comfy_lora_root,
            comfy_lora_subfolder=comfy_lora_subfolder,
        )
        return (text,)


class LoraTrainingSeed:
    """Seed the app fills (≤0 in the UI becomes a random value per job).

    Input is named ``value`` (not ``seed``) so ComfyUI does **not** attach the
    special seed randomize / control_after_generate widget — that widget is
    frontend-only and breaks reliable API injection.
    """

    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                # Avoid the name "seed" — Comfy treats it as a special randomizable widget.
                "value": (
                    "INT",
                    {
                        "default": 0,
                        "min": 0,
                        "max": 0xFFFFFFFFFFFFFFFF,
                        "control_after_generate": False,
                    },
                ),
            }
        }

    RETURN_TYPES = ("INT",)
    RETURN_NAMES = ("seed",)
    FUNCTION = "emit"
    CATEGORY = CATEGORY

    def emit(self, value):
        return (int(value),)

    @classmethod
    def IS_CHANGED(cls, value):
        return value


class LoraTrainingStyleIndex:
    """Style switch the app fills per validation set (0 = realistic, 1 = anime).

    Wire the INT output into Select Per-Line / index inputs that pick style
    wildcards and matching negatives.
    """

    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "value": (
                    "INT",
                    {
                        "default": 0,
                        "min": 0,
                        "max": 1,
                        "control_after_generate": False,
                    },
                ),
            }
        }

    RETURN_TYPES = ("INT",)
    RETURN_NAMES = ("index",)
    FUNCTION = "emit"
    CATEGORY = CATEGORY

    def emit(self, value):
        return (0 if int(value) <= 0 else 1,)

    @classmethod
    def IS_CHANGED(cls, value):
        return value


class LoraTrainingModel:
    """Model filename the app fills (checkpoint or diffusion/UNET weight).

    Convert Load Diffusion Model ``unet_name`` (or CheckpointLoader ``ckpt_name``)
    to an input, then wire this node’s output into it. Output uses a wildcard
    type so it can connect to COMBO sockets (plain STRING cannot).

    Flux / Krea weights usually live under ``models/diffusion_models``.
    Dataset “Default” uses Settings → default validation model.
    """

    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                # STRING so the desktop app can inject any filename via the API.
                "model_name": ("STRING", {"default": "", "multiline": False}),
            }
        }

    RETURN_TYPES = (ANY,)
    RETURN_NAMES = ("model_name",)
    FUNCTION = "emit"
    CATEGORY = CATEGORY

    def emit(self, model_name="", ckpt_name=""):
        # ``ckpt_name`` kept for older graphs that still have that input key.
        return (model_name or ckpt_name or "",)

    @classmethod
    def IS_CHANGED(cls, model_name="", ckpt_name=""):
        return model_name or ckpt_name or ""


class LoraTrainingOutputFolder:
    """Absolute path to ``{dataset}/output/Set N`` (app fills). Wire into saves."""

    @classmethod
    def INPUT_TYPES(cls):
        return {"required": {"folder": ("STRING", {"default": "", "multiline": False})}}

    RETURN_TYPES = ("STRING",)
    RETURN_NAMES = ("folder",)
    FUNCTION = "emit"
    CATEGORY = CATEGORY

    def emit(self, folder):
        return (folder,)


class LoraTrainingOutputFilename:
    """Preview filename stem for the LoRA currently being validated (app fills).

    Matches the checkpoint **basename** stem (no parent folder), e.g.
    ``keyword_000000250`` — no extension. Combined with LT · Output Folder
    (``…/output/Set N``), the preview is saved flat in the set folder.
    """

    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "filename": ("STRING", {"default": "", "multiline": False}),
            }
        }

    RETURN_TYPES = ("STRING",)
    RETURN_NAMES = ("filename",)
    FUNCTION = "emit"
    CATEGORY = CATEGORY

    def emit(self, filename):
        return (filename,)

    @classmethod
    def IS_CHANGED(cls, filename):
        return filename


class LoraTrainingInputImage:
    """Absolute-path image loader the app fills for the Upscale/Detail tool.

    Mirrors ComfyUI's built-in Load Image node (RGB IMAGE + alpha MASK) but is
    driven by an explicit absolute path instead of a file picked from Comfy's
    input/ folder, so the desktop app can point it at any dataset image or an
    externally chosen file without staging a copy first.
    """

    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "image_path": ("STRING", {"default": "", "multiline": False}),
            }
        }

    RETURN_TYPES = ("IMAGE", "MASK")
    RETURN_NAMES = ("image", "mask")
    FUNCTION = "load"
    CATEGORY = CATEGORY

    def load(self, image_path):
        raw = (image_path or "").strip()
        if not raw:
            raise RuntimeError("LT · Input Image: no image_path was provided.")
        path = Path(raw).expanduser().resolve()
        if not path.is_file():
            raise RuntimeError(f"LT · Input Image: file not found:\n{path}")

        img = Image.open(path)
        img = ImageOps.exif_transpose(img)
        if img.mode == "I":
            img = img.point(lambda i: i * (1 / 255))
        rgb = img.convert("RGB")
        array = np.array(rgb).astype(np.float32) / 255.0
        tensor = torch.from_numpy(array)[None,]

        if "A" in img.getbands():
            mask_array = np.array(img.getchannel("A")).astype(np.float32) / 255.0
            mask = 1.0 - torch.from_numpy(mask_array)
        else:
            mask = torch.zeros((rgb.height, rgb.width), dtype=torch.float32)
        mask = mask.unsqueeze(0)

        return (tensor, mask)

    @classmethod
    def IS_CHANGED(cls, image_path):
        raw = (image_path or "").strip()
        if not raw:
            return ""
        try:
            stat = Path(raw).expanduser().resolve().stat()
            return f"{stat.st_mtime_ns}:{stat.st_size}"
        except OSError:
            return raw


class LoraTrainingDenoise:
    """Denoise strength the app fills for the Upscale/Detail tool (0..1).

    Convert a KSampler's ``denoise`` widget to an input and wire this in.
    """

    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "value": (
                    "FLOAT",
                    {"default": 0.5, "min": 0.0, "max": 1.0, "step": 0.01},
                ),
            }
        }

    RETURN_TYPES = ("FLOAT",)
    RETURN_NAMES = ("denoise",)
    FUNCTION = "emit"
    CATEGORY = CATEGORY

    def emit(self, value):
        return (float(value),)

    @classmethod
    def IS_CHANGED(cls, value):
        return value


class LoraTrainingMaxSize:
    """Largest-dimension target the app fills for the Upscale/Detail tool.

    Convert "Scale Image to Max Dimension"'s ``largest_size`` widget to an
    input and wire this in.
    """

    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "value": (
                    "INT",
                    {"default": 1600, "min": 64, "max": 8192},
                ),
            }
        }

    RETURN_TYPES = ("INT",)
    RETURN_NAMES = ("largest_size",)
    FUNCTION = "emit"
    CATEGORY = CATEGORY

    def emit(self, value):
        return (int(value),)

    @classmethod
    def IS_CHANGED(cls, value):
        return value


# ---------------------------------------------------------------------------
# Shared extensions (Wildcards Manager Generation + future LT tools)
# Do not change the original LT nodes above — both apps ship this same pack.
# ---------------------------------------------------------------------------


class LoraTrainingNegativePrompt:
    """Negative prompt text the app fills. Wire into your CLIP text encoder."""

    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "text": ("STRING", {"default": "", "multiline": True}),
            }
        }

    RETURN_TYPES = ("STRING",)
    RETURN_NAMES = ("text",)
    FUNCTION = "passthrough"
    CATEGORY = CATEGORY

    def passthrough(self, text):
        return (text,)


class LoraTrainingCLIP:
    """CLIP filename the app fills. Convert CLIPLoader combo widgets to inputs."""

    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "clip_name": ("STRING", {"default": "", "multiline": False}),
            }
        }

    RETURN_TYPES = (ANY,)
    RETURN_NAMES = ("clip_name",)
    FUNCTION = "emit"
    CATEGORY = CATEGORY

    def emit(self, clip_name=""):
        return (clip_name or "",)

    @classmethod
    def IS_CHANGED(cls, clip_name=""):
        return clip_name or ""


class LoraTrainingVAE:
    """VAE filename the app fills. Convert VAELoader combo widgets to inputs."""

    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "vae_name": ("STRING", {"default": "", "multiline": False}),
            }
        }

    RETURN_TYPES = (ANY,)
    RETURN_NAMES = ("vae_name",)
    FUNCTION = "emit"
    CATEGORY = CATEGORY

    def emit(self, vae_name=""):
        return (vae_name or "",)

    @classmethod
    def IS_CHANGED(cls, vae_name=""):
        return vae_name or ""


class LoraTrainingWidth:
    """Latent / canvas width the app fills."""

    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "value": (
                    "INT",
                    {"default": 1024, "min": 64, "max": 8192, "step": 8},
                ),
            }
        }

    RETURN_TYPES = ("INT",)
    RETURN_NAMES = ("width",)
    FUNCTION = "emit"
    CATEGORY = CATEGORY

    def emit(self, value):
        return (int(value),)

    @classmethod
    def IS_CHANGED(cls, value):
        return value


class LoraTrainingHeight:
    """Latent / canvas height the app fills."""

    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "value": (
                    "INT",
                    {"default": 1024, "min": 64, "max": 8192, "step": 8},
                ),
            }
        }

    RETURN_TYPES = ("INT",)
    RETURN_NAMES = ("height",)
    FUNCTION = "emit"
    CATEGORY = CATEGORY

    def emit(self, value):
        return (int(value),)

    @classmethod
    def IS_CHANGED(cls, value):
        return value


class LoraTrainingSteps:
    """Step count the app fills. Convert KSampler ``steps`` to an input and wire this in."""

    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "value": (
                    "INT",
                    {"default": 20, "min": 1, "max": 10000, "step": 1},
                ),
            }
        }

    RETURN_TYPES = ("INT",)
    RETURN_NAMES = ("steps",)
    FUNCTION = "emit"
    CATEGORY = CATEGORY

    def emit(self, value):
        return (int(value),)

    @classmethod
    def IS_CHANGED(cls, value):
        return value


class LoraTrainingCfg:
    """CFG the app fills. Convert KSampler ``cfg`` to an input and wire this in."""

    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "value": (
                    "FLOAT",
                    {"default": 7.0, "min": 0.0, "max": 100.0, "step": 0.1},
                ),
            }
        }

    RETURN_TYPES = ("FLOAT",)
    RETURN_NAMES = ("cfg",)
    FUNCTION = "emit"
    CATEGORY = CATEGORY

    def emit(self, value):
        return (float(value),)

    @classmethod
    def IS_CHANGED(cls, value):
        return value


class LoraTrainingSampler:
    """Sampler name the app fills. Convert KSampler ``sampler_name`` to an input."""

    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "sampler_name": ("STRING", {"default": "", "multiline": False}),
            }
        }

    RETURN_TYPES = (ANY,)
    RETURN_NAMES = ("sampler_name",)
    FUNCTION = "emit"
    CATEGORY = CATEGORY

    def emit(self, sampler_name=""):
        return (sampler_name or "",)

    @classmethod
    def IS_CHANGED(cls, sampler_name=""):
        return sampler_name or ""


class LoraTrainingScheduler:
    """Scheduler name the app fills. Convert KSampler ``scheduler`` to an input."""

    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "scheduler": ("STRING", {"default": "", "multiline": False}),
            }
        }

    RETURN_TYPES = (ANY,)
    RETURN_NAMES = ("scheduler",)
    FUNCTION = "emit"
    CATEGORY = CATEGORY

    def emit(self, scheduler=""):
        return (scheduler or "",)

    @classmethod
    def IS_CHANGED(cls, scheduler=""):
        return scheduler or ""


class LoraTrainingUpscaler:
    """Upscale-model filename the app fills for the SDXL hires pass.

    Convert UpscaleModelLoader ``model_name`` to an input and wire this in.
    Output uses a wildcard type so it can connect to a COMBO socket.
    """

    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "model_name": ("STRING", {"default": "", "multiline": False}),
            }
        }

    RETURN_TYPES = (ANY,)
    RETURN_NAMES = ("model_name",)
    FUNCTION = "emit"
    CATEGORY = CATEGORY

    def emit(self, model_name=""):
        return (model_name or "",)

    @classmethod
    def IS_CHANGED(cls, model_name=""):
        return model_name or ""


class LoraTrainingUpscaleFactor:
    """Final size versus the base image (1.5 on 1024 is 1536).

    Wire this into LT · Hires size. The app writes the factor; that node
    multiplies width and height and snaps both to a multiple of 8.
    """

    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "value": (
                    "FLOAT",
                    {"default": 1.5, "min": 1.0, "max": 4.0, "step": 0.1},
                ),
            }
        }

    RETURN_TYPES = ("FLOAT",)
    RETURN_NAMES = ("factor",)
    FUNCTION = "emit"
    CATEGORY = CATEGORY

    def emit(self, value=1.5):
        return (float(value),)

    @classmethod
    def IS_CHANGED(cls, value=1.5):
        return value


class LoraTrainingHiresDenoise:
    """Denoise for the second (hires) KSampler only. The base sampler stays on LT · Denoise."""

    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "value": (
                    "FLOAT",
                    {"default": 0.5, "min": 0.0, "max": 1.0, "step": 0.05},
                ),
            }
        }

    RETURN_TYPES = ("FLOAT",)
    RETURN_NAMES = ("denoise",)
    FUNCTION = "emit"
    CATEGORY = CATEGORY

    def emit(self, value=0.5):
        return (float(value),)

    @classmethod
    def IS_CHANGED(cls, value=0.5):
        return value


class LoraTrainingClipSkip:
    """A1111 CLIP skip for CLIP Set Last Layer.

    Options stores 1–12. The queue writes the Comfy stop layer (−1 keeps the
    last layer, −2 is Pony and Illustrious). A positive value is accepted too
    and turned into that stop layer, so either number works on the node.
    """

    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "value": (
                    "INT",
                    {"default": -2, "min": -24, "max": 12, "step": 1},
                ),
            }
        }

    RETURN_TYPES = ("INT",)
    RETURN_NAMES = ("stop_at_clip_layer",)
    FUNCTION = "emit"
    CATEGORY = CATEGORY

    def emit(self, value=-2):
        layer = int(value)
        if layer > 0:
            layer = -layer
        if layer == 0 or layer > -1:
            layer = -1
        if layer < -24:
            layer = -24
        return (layer,)

    @classmethod
    def IS_CHANGED(cls, value=-2):
        return value


class LoraTrainingHiresSize:
    """Width and height for ImageScale: base size times the upscale factor, snapped to 8."""

    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "width": ("INT", {"default": 1024, "min": 64, "max": 8192, "step": 8}),
                "height": ("INT", {"default": 1024, "min": 64, "max": 8192, "step": 8}),
                "factor": (
                    "FLOAT",
                    {"default": 1.5, "min": 1.0, "max": 4.0, "step": 0.1},
                ),
            }
        }

    RETURN_TYPES = ("INT", "INT")
    RETURN_NAMES = ("width", "height")
    FUNCTION = "scale"
    CATEGORY = CATEGORY

    def scale(self, width, height, factor):
        def snap(n):
            snapped = int(round(float(n) / 8.0) * 8)
            return max(64, snapped)

        return (snap(float(width) * float(factor)), snap(float(height) * float(factor)))


class LoraTrainingSaveOutput:
    """Finished-image sink. Behaves like SaveImage so /history can fetch it.

    Prefer this when the desktop app should pull the result from Comfy history
    (Wildcards Manager Generation). LT validation can keep using Output Folder
    + Output Filename + a normal save node instead.
    """

    def __init__(self):
        self.output_dir = folder_paths.get_output_directory()
        self.type = "output"

    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "images": ("IMAGE",),
                "filename_prefix": ("STRING", {"default": "LT"}),
            },
            "hidden": {"prompt": "PROMPT", "extra_pnginfo": "EXTRA_PNGINFO"},
        }

    RETURN_TYPES = ()
    FUNCTION = "save"
    OUTPUT_NODE = True
    CATEGORY = CATEGORY

    def save(
        self,
        images,
        filename_prefix="LT",
        prompt=None,
        extra_pnginfo=None,
    ):
        full_output_folder, filename, counter, subfolder, _ = (
            folder_paths.get_save_image_path(
                filename_prefix,
                self.output_dir,
                images[0].shape[1],
                images[0].shape[0],
            )
        )
        results = []
        for batch_number, image in enumerate(images):
            arr = 255.0 * image.cpu().numpy()
            img = Image.fromarray(np.clip(arr, 0, 255).astype(np.uint8))
            metadata = PngImagePlugin.PngInfo()
            if prompt is not None:
                metadata.add_text("prompt", json.dumps(prompt))
            if extra_pnginfo is not None:
                for key, value in extra_pnginfo.items():
                    metadata.add_text(key, json.dumps(value))
            file = f"{filename}_{counter:05}_.png"
            img.save(
                os.path.join(full_output_folder, file),
                pnginfo=metadata,
                compress_level=4,
            )
            results.append(
                {"filename": file, "subfolder": subfolder, "type": self.type}
            )
            counter += 1
        return {"ui": {"images": results}}


NODE_CLASS_MAPPINGS = {
    "LoraTrainingPrompt": LoraTrainingPrompt,
    "LoraTrainingSeed": LoraTrainingSeed,
    "LoraTrainingStyleIndex": LoraTrainingStyleIndex,
    "LoraTrainingModel": LoraTrainingModel,
    "LoraTrainingOutputFolder": LoraTrainingOutputFolder,
    "LoraTrainingOutputFilename": LoraTrainingOutputFilename,
    "LoraTrainingInputImage": LoraTrainingInputImage,
    "LoraTrainingDenoise": LoraTrainingDenoise,
    "LoraTrainingMaxSize": LoraTrainingMaxSize,
    "LoraTrainingNegativePrompt": LoraTrainingNegativePrompt,
    "LoraTrainingCLIP": LoraTrainingCLIP,
    "LoraTrainingVAE": LoraTrainingVAE,
    "LoraTrainingWidth": LoraTrainingWidth,
    "LoraTrainingHeight": LoraTrainingHeight,
    "LoraTrainingSteps": LoraTrainingSteps,
    "LoraTrainingCfg": LoraTrainingCfg,
    "LoraTrainingSampler": LoraTrainingSampler,
    "LoraTrainingScheduler": LoraTrainingScheduler,
    "LoraTrainingUpscaler": LoraTrainingUpscaler,
    "LoraTrainingUpscaleFactor": LoraTrainingUpscaleFactor,
    "LoraTrainingHiresDenoise": LoraTrainingHiresDenoise,
    "LoraTrainingClipSkip": LoraTrainingClipSkip,
    "LoraTrainingHiresSize": LoraTrainingHiresSize,
    "LoraTrainingSaveOutput": LoraTrainingSaveOutput,
}

NODE_DISPLAY_NAME_MAPPINGS = {
    "LoraTrainingPrompt": "LT · Prompt",
    "LoraTrainingSeed": "LT · Seed",
    "LoraTrainingStyleIndex": "LT · Style Index",
    "LoraTrainingModel": "LT · Model",
    "LoraTrainingOutputFolder": "LT · Output Folder",
    "LoraTrainingOutputFilename": "LT · Output Filename",
    "LoraTrainingInputImage": "LT · Input Image",
    "LoraTrainingDenoise": "LT · Denoise",
    "LoraTrainingMaxSize": "LT · Max Size",
    "LoraTrainingNegativePrompt": "LT · Negative Prompt",
    "LoraTrainingCLIP": "LT · CLIP",
    "LoraTrainingVAE": "LT · VAE",
    "LoraTrainingWidth": "LT · Width",
    "LoraTrainingHeight": "LT · Height",
    "LoraTrainingSteps": "LT · Steps",
    "LoraTrainingCfg": "LT · CFG",
    "LoraTrainingSampler": "LT · Sampler",
    "LoraTrainingScheduler": "LT · Scheduler",
    "LoraTrainingUpscaler": "LT · Upscaler",
    "LoraTrainingUpscaleFactor": "LT · Upscale factor",
    "LoraTrainingHiresDenoise": "LT · Hires denoise",
    "LoraTrainingClipSkip": "LT · CLIP skip",
    "LoraTrainingHiresSize": "LT · Hires size",
    "LoraTrainingSaveOutput": "LT · Save Output",
}
