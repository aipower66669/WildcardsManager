/**
 * Workflow profile and semantic binding types (ported from Infinite Canvas).
 * Plain TypeScript — no zod dependency.
 */

export type BindingValueType =
  | 'string'
  | 'integer-string'
  | 'integer'
  | 'number'
  | 'boolean';

export type InputBinding = {
  nodeId: string;
  inputPath: string[];
  valueType: BindingValueType;
};

export type OutputBinding = {
  nodeId: string;
  outputSelector: { kind: 'first-image' };
};

export type LoraBinding = {
  nodeId: string;
  title?: string;
  name: InputBinding;
  strengthModel?: InputBinding;
  strengthClip?: InputBinding;
};

export type WorkflowBindings = {
  positivePrompt?: InputBinding;
  seed?: InputBinding;
  outputNode?: OutputBinding;
  contextImage?: InputBinding;
  maskImage?: InputBinding;
  negativePrompt?: InputBinding;
  steps?: InputBinding;
  cfg?: InputBinding;
  denoise?: InputBinding;
  width?: InputBinding;
  height?: InputBinding;
  checkpoint?: InputBinding;
  unet?: InputBinding;
  vae?: InputBinding;
  clip1?: InputBinding;
  clip2?: InputBinding;
  /** LT · Output Folder — absolute path string. */
  outputFolder?: InputBinding;
  /** LT · Output Filename — stem, e.g. WCG. */
  outputFilename?: InputBinding;
  samplerName?: InputBinding;
  scheduler?: InputBinding;
  samplerNodeClass?: string;
  loras?: LoraBinding[];
};

export type WorkflowProfile = {
  formatVersion: 1;
  profileId: string;
  name: string;
  workflowHash: string;
  importedAt: string;
  updatedAt: string;
  /** API-format workflow graph (`graphToPrompt().output`) queued to /prompt. */
  workflow: Record<string, unknown>;
  /**
   * LiteGraph UI workflow (`graphToPrompt().workflow`) reloaded into Edit Workflow.
   * Without this, the webview shows ComfyUI’s last session graph — not the saved profile.
   */
  uiWorkflow?: unknown;
  /**
   * Best-effort role bindings. May be incomplete — workflow is still persisted;
   * Generation will refuse to run until the needed roles resolve.
   */
  bindings: WorkflowBindings;
  /** Non-fatal issues from the last save (also returned to the UI). */
  saveWarnings?: string[];
  notes?: string;
};

/** Result of persisting a workflow — always written unless the payload is unusable. */
export type SaveWorkflowProfileResult = {
  profile: WorkflowProfile;
  warnings: string[];
  contractOk: boolean;
};

export type WorkflowNodeInfo = {
  nodeId: string;
  classType: string;
  title?: string;
  inputKeys: string[];
};
