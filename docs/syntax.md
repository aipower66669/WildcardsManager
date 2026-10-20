# Supported syntax and compatibility

Wildcards Manager targets the common syntax family used by
[`sd-dynamic-prompts`](https://github.com/adieyal/sd-dynamic-prompts/blob/main/docs/SYNTAX.md)
and [ComfyUI Dynamic Prompts](https://github.com/adieyal/comfyui-dynamicprompts).
It validates and expands a documented subset; it is not a complete replacement
for either runtime.

## Official Dynamic Prompts documentation

Wildcards Manager is a library management, validation, and analysis tool. It
supports a documented subset of Dynamic Prompts syntax but is not a replacement
for the Dynamic Prompts extensions themselves.

For complete syntax documentation, advanced features, configuration, and runtime
behaviour, refer to the extension corresponding to your image-generation
environment:

- Stable Diffusion WebUI (AUTOMATIC1111):
  [Dynamic Prompts extension — Syntax reference](https://github.com/adieyal/sd-dynamic-prompts/blob/main/docs/SYNTAX.md)
- ComfyUI:
  [ComfyUI Dynamic Prompts](https://github.com/adieyal/comfyui-dynamicprompts) —
  the repository README and the documentation it links to

Wildcards Manager does not implement every feature supported by these
extensions. Its validation, expansion, and simulation engines follow the subset
documented below. Some syntax and behaviour differ between AUTOMATIC1111 and
ComfyUI.

When using features not supported by Wildcards Manager, consult your extension's
documentation and test the results in the actual generation environment.

## Text wildcard files

For `.txt`, each non-empty, non-comment line is one candidate. A line may contain
literal text, nested wildcard references, and variants:

```text
red
deep blue
{warm|cool} __color__
```

Leading/trailing whitespace is ignored by expansion. Lines whose trimmed form
starts with `#` are comments and are excluded from references and output.

## Wildcard references

```text
__colors__
__clothing/hats__
__artists\ink__
```

- References are relative to the selected library root.
- `.txt`, `.yaml`, `.yml`, and `.json` extensions are omitted.
- Backslashes are normalized to `/`; leading slashes are removed.
- Exact-case lookup is attempted first, followed by case-insensitive lookup.
- Wildcards can appear inside wildcard files and variant options.
- The graph records line/column and reports missing targets.

Example mapping:

```text
__clothing/hats__ -> <root>/clothing/hats.txt
```

## Globs

```text
__colors*__
__artists/*__
__artists/**__
```

Wildcards Manager uses anchored path glob semantics:

- `*` matches zero or more characters **within one path segment**.
- `**` matches across directory separators at any depth.
- Matches are case-insensitive.
- A glob produces an intermediate graph node and fans out to every matching
  file.
- A glob with no matches reports `glob_no_match`.

Examples:

```text
artists/ink.txt
artists/paint.txt
artists/history/modern.txt
```

- `__artists/*__` matches `ink` and `paint`, not `history/modern`.
- `__artists/**__` matches all three.

Upstream A1111 Dynamic Prompts uses fuzzy glob matching where a single `*` may
cross directories. Prefer `**` for “everything below this folder” when writing a
library intended to work predictably in both places.

Only `*` and `**` are interpreted by this app. Character classes (`[a-z]`) and
single-character `?` glob syntax are not implemented.

## Variants inside wildcard names (Stable Diffusion)

Stable Diffusion Dynamic Prompts can place a variant group inside the
`__…__` body. Options are concatenated onto the base name before lookup:

```text
__where{|-indoor}__
__color(|-basic)__
```

These are equivalent to `{__where__|__where-indoor__}` and
`{__color__|__color-basic__}`. Parentheses are used when `{`/`}` are remapped
in Dynamic Prompts settings.

Wildcards Manager expands these for **Stable Diffusion** libraries (graph,
validation, expansion). **ComfyUI** libraries flag them as
`unsupported_wildcard_logic` and do not invent a missing file for the literal
name. Set the target per library under **Manage libraries…**.

## Variants

```text
{red|green|blue}
{a|{b|c}|d}
portrait in {__indoor__|__outdoor__}
```

Options are split on top-level `|`; nested braces are respected. A `|` outside a
variant reports the `orphan_pipe` warning.

## Weighted variants

```text
{5::common|1::rare|unweighted}
```

Weights precede `::` and may be integers or decimals. Unweighted options use
weight `1`.

- Random expansion and simulation use weights.
- Exhaustive expansion enumerates options without probabilities.
- Graph validation tracks references in every option regardless of weight.

## Multi-select variants

```text
{2$$red|green|blue}
{1-2$$red|green|blue}
{-2$$red|green|blue}
{2-$$red|green|blue}
{$$red|green|blue}
{2$$ and $$red|green|blue}
{2$$ $$red|green|blue}
{2$$-$$red|green|blue}
{2$$ + $$red|green|blue}
```

Semantics:

- `N$$` selects exactly `N`.
- `N-M$$` selects between `N` and `M`.
- `-M$$` has an open lower bound.
- `N-$$` has an open upper bound.
- Bare `$$` ranges across zero to the option count in this app.
- A second `$$` encloses a custom separator; otherwise `, ` is used.
- Counts are clamped to the number of available options.
- Exhaustive mode produces unordered combinations; random mode samples without
  replacement.

Malformed `$` / `$$$` runs and structurally invalid ranges **inside `{…}`**
produce `bad_multiselect`. A `$` outside braces (for example a LoRA trigger
word) is literal text, not multi-select.

## Validation escape hatch

Place the marker on the **physical first line** (a UTF-8 BOM is tolerated):

```text
# NO VALIDATION
```

Matching is case-insensitive and leading whitespace is allowed. Additional text
after the marker is accepted because matching uses “starts with”.

Effects:

- syntax and empty-file issues from that file are suppressed;
- unresolved references from it do not create missing nodes/edges/issues;
- resolvable references still appear and expand in the graph;
- the file remains indexed, editable, and visible.

Use this for files that intentionally contain extension-specific syntax. It does
not make unsupported syntax executable by the expansion engine.

## Structured files

YAML and JSON documents contribute global wildcard keys from their mapping
paths. The physical filename is not part of the wildcard name:

```yaml
# collections.yaml
styles:
  painting:
    - oil
    - watercolor
  sketch: pencil
```

This defines `__styles/painting__` and `__styles/sketch__`, not
`__collections/styles/painting__`. Mapping paths become first-class graph nodes.
Scalar values and lists of scalar values can contain variants and nested
wildcard references and participate in expansion and simulation.

Documents must contain a top-level mapping. Keys must be non-empty scalar values
without `/`; list items must be scalar values. Invalid documents, duplicate
global keys, unsupported values, and references to absent paths are reported.
Locations use the YAML parser's source ranges where available; JSON is validated
strictly before its compatible syntax tree is traversed.

Renaming a YAML/JSON file does not rename its global mapping keys or rewrite
references. Deleting the host file removes exact references to keys it owns.
Editing or renaming an individual nested key remains a manual source edit.

## Reported structural issues

- unmatched `__` → `unclosed_wildcard`;
- unmatched braces → `unbalanced_brace`;
- malformed `$` / `$$` **inside `{…}`** → `bad_multiselect`;
- top-level `|` → `orphan_pipe`;
- no active lines → `empty_file`;
- unresolved exact reference → `missing_file`;
- unmatched glob → `glob_no_match`;
- active recursion path → `cycle`.

## Expansion safety limits

- Maximum returned samples: 2,000.
- Default recursion depth: 25.
- Combination estimates saturate at 1,000,000,000.
- Recursion is stopped and reported instead of looping indefinitely.
- Missing targets remain as literal `__name__` text in expansion output.

## Examples that pass and fail

| Situation | Accepted | Rejected or different | Why |
| --- | --- | --- | --- |
| One path segment | `__artists/*__` matches `artists/ink` | the same pattern does not match `artists/history/modern` | `*` stays inside one segment |
| Any depth | `__artists/**__` matches `artists/history/modern` | a single `*` is not a substitute | `**` crosses directories |
| Comment | a line `# hat, red` is ignored | `hat # note` stays active | the trimmed line must start with `#` |
| Multi-select | `{2$$red\|green\|blue}` | `{2$red\|green}` inside braces | a broken `$` run inside `{…}` is `bad_multiselect` |
| Dollar in a trigger | `trigger$word` stays literal text | it is not read as multi-select | `$` outside braces is literal |
| Simple forwarder | one active line `__new-name__`, with comments allowed above it | `prefix __new-name__`, two refs, or a glob | Consolidate and Absorb need exactly one non-glob ref |
| YAML value | a list of strings under a mapping key | a nested mapping that never reaches a scalar or a list of scalars | only those values expand |
| Missing target | the graph reports `missing_file` | expansion does not drop the token | the sample still contains `__name__` |
| Validation escape | `# NO VALIDATION` on line 1 | the same words on line 2 | the marker is the physical first line only |

## Not implemented

- Jinja2 templates;
- prompt variables such as `${name=value}`;
- explicit/cyclical wildcard samplers such as `__~name__` and `__@name__`;
- Magic Prompt / “I'm Feeling Lucky”;
- configurable wildcard/variant delimiters;
- complete fuzzy-glob parity with A1111;
- extension-specific syntax from every ComfyUI wildcard node.

When compatibility matters, validate the final library in the exact extension
and version that will execute it.
