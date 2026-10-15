import { computeReferenceStats } from '../domain/references.js';
import {
  planAbsorbConsolidation,
  planConsolidation,
} from '../domain/consolidate.js';
import {
  planCycleFixFromIssue,
  removeReferenceAt,
} from '../domain/cycleFix.js';
import { planDelete, planReferenceCleanup } from '../domain/delete.js';
import { planRename } from '../domain/rename.js';
import { planConvertToChild } from '../domain/convertToChild.js';
import { planCreateDescendant } from '../domain/createDescendant.js';
import { analyzeWildcardTree } from '../domain/analyze.js';
import { getActiveLibrary } from './settingsStore.js';
import type {
  AbsorbPreviewDto,
  AbsorbResultDto,
  ConsolidationPreviewDto,
  ConsolidationResultDto,
  ConvertToChildPreviewDto,
  ConvertToChildResultDto,
  CreateDescendantResultDto,
  CycleFixApplyRequestDto,
  CycleFixIssueSeedDto,
  CycleFixPreviewDto,
  CycleFixResultDto,
  DeleteResultDto,
  FileRefStatDto,
  ReferenceCleanupResultDto,
  RenamePreviewDto,
  RenameResultDto,
} from '../shared/contracts.js';
import { libraryService } from './libraryService.js';
import {
  applyMutation,
  notifyLibraryMutated,
  type FileOp,
} from './mutationService.js';
import { resolveEditorSaveAgainstDisk } from '../domain/libraryTextMerge.js';

export function referenceStats(): FileRefStatDto[] {
  return computeReferenceStats(
    libraryService.loadAllFiles(),
    getActiveLibrary().validationPlatform ?? 'comfyui',
  );
}

export function previewConsolidation(
  relativePath: string,
): ConsolidationPreviewDto {
  const plan = planConsolidation(libraryService.loadAllFiles(), relativePath);
  return {
    canConsolidate: plan.canConsolidate,
    reason: plan.reason,
    sourceKey: plan.sourceKey,
    sourceRelativePath: plan.sourceRelativePath,
    targetName: plan.targetName,
    targetExists: plan.targetExists,
    affectedFiles: plan.edits.map((e) => ({
      key: e.key,
      relativePath: e.relativePath,
      occurrences: e.occurrences,
    })),
    totalOccurrences: plan.totalOccurrences,
    warnings: plan.warnings,
  };
}

export function consolidate(relativePath: string): ConsolidationResultDto {
  const files = libraryService.loadAllFiles();
  const plan = planConsolidation(files, relativePath);
  if (!plan.canConsolidate) {
    throw new Error(plan.reason ?? 'Cannot consolidate this file');
  }

  const ops: FileOp[] = [
    ...plan.edits.map((edit) => ({
      relativePath: edit.relativePath,
      text: edit.newText,
    })),
    { relativePath: plan.sourceRelativePath, text: null },
  ];
  applyMutation(
    `Consolidate ${plan.sourceRelativePath} → __${plan.targetName}__`,
    ops,
  );

  return {
    deletedRelativePath: plan.sourceRelativePath,
    targetRelativePath: plan.targetRelativePath,
    editedFiles: plan.edits.length,
    totalOccurrences: plan.totalOccurrences,
    targetName: plan.targetName,
  };
}

export function previewAbsorb(relativePath: string): AbsorbPreviewDto {
  const plan = planAbsorbConsolidation(libraryService.loadAllFiles(), relativePath);
  return {
    canAbsorb: plan.canAbsorb,
    reason: plan.reason,
    sourceKey: plan.sourceKey,
    sourceRelativePath: plan.sourceRelativePath,
    targetName: plan.targetName,
    targetKey: plan.targetKey,
    targetRelativePath: plan.targetRelativePath,
    affectedFiles: plan.edits.map((e) => ({
      key: e.key,
      relativePath: e.relativePath,
      occurrences: e.occurrences,
    })),
    totalOccurrences: plan.totalOccurrences,
    warnings: plan.warnings,
  };
}

export function absorb(relativePath: string): AbsorbResultDto {
  const plan = planAbsorbConsolidation(libraryService.loadAllFiles(), relativePath);
  if (!plan.canAbsorb) {
    throw new Error(plan.reason ?? 'Cannot absorb this forwarder');
  }

  const ops: FileOp[] = [
    ...plan.edits.map((edit) => ({
      relativePath: edit.relativePath,
      text: edit.newText,
    })),
    { relativePath: plan.sourceRelativePath, text: plan.absorbedText },
    { relativePath: plan.targetRelativePath, text: null },
  ];
  applyMutation(
    `Absorb __${plan.targetName}__ into ${plan.sourceRelativePath}`,
    ops,
  );

  return {
    keptRelativePath: plan.sourceRelativePath,
    deletedRelativePath: plan.targetRelativePath,
    editedFiles: plan.edits.length,
    totalOccurrences: plan.totalOccurrences,
    targetName: plan.targetName,
  };
}

/** Save edited wildcard file content as an undoable, backed-up mutation. */
export function saveFile(
  relativePath: string,
  text: string,
  editSessionId?: string,
  options?: { basedOn?: string },
): { writtenText: string } {
  const current = libraryService.readFile(relativePath).text;
  const unsaved = libraryService.hasUnsavedMemory(relativePath);
  if (unsaved && text === current) {
    libraryService.writeFileText(relativePath, text);
    notifyLibraryMutated([relativePath], { editorSave: true });
    return { writtenText: text };
  }
  const resolution = resolveEditorSaveAgainstDisk(
    text,
    current,
    options?.basedOn,
  );

  if (resolution.action === 'noop') {
    return { writtenText: resolution.writtenText };
  }

  if (resolution.action === 'notify') {
    // Disk already has the desired end state (e.g. LoRA append on top of this
    // buffer); ping the editor to pull it in without writing backwards.
    notifyLibraryMutated([relativePath]);
    return { writtenText: resolution.writtenText };
  }

  applyMutation(
    `Edit ${relativePath}`,
    [{ relativePath, text: resolution.writtenText }],
    {
      ...(editSessionId ? { coalesceKey: `edit:${editSessionId}` } : {}),
      editorSave: true,
    },
  );
  return { writtenText: resolution.writtenText };
}

export function previewConvertToChild(
  relativePath: string,
  childKey: string,
): ConvertToChildPreviewDto {
  const plan = planConvertToChild(
    libraryService.loadAllFiles(),
    relativePath,
    childKey,
  );
  return {
    canConvert: plan.canConvert,
    reason: plan.reason,
    sourceKey: plan.sourceKey,
    sourceRelativePath: plan.sourceRelativePath,
    childKey: plan.childKey,
    childRelativePath: plan.childRelativePath,
    parentText: plan.parentText,
    warnings: plan.warnings,
  };
}

export function convertToChild(
  relativePath: string,
  childKey: string,
): ConvertToChildResultDto {
  const plan = planConvertToChild(
    libraryService.loadAllFiles(),
    relativePath,
    childKey,
  );
  if (!plan.canConvert) {
    throw new Error(plan.reason ?? 'Cannot convert this file to a child node');
  }

  applyMutation(`Convert ${plan.sourceRelativePath} → __${plan.childKey}__`, [
    { relativePath: plan.childRelativePath, text: plan.sourceText },
    { relativePath: plan.sourceRelativePath, text: plan.parentText },
  ]);

  return {
    sourceRelativePath: plan.sourceRelativePath,
    childRelativePath: plan.childRelativePath,
    childKey: plan.childKey,
  };
}

export function createDescendant(
  parentRelativePath: string,
  childPath: string,
): CreateDescendantResultDto {
  const plan = planCreateDescendant(
    libraryService.loadAllFiles(),
    parentRelativePath,
    childPath,
  );
  if (!plan.canCreate) {
    throw new Error(plan.reason ?? 'Cannot create descendant');
  }

  applyMutation(
    `Create descendant ${plan.childRelativePath} under ${plan.parentRelativePath}`,
    [
      { relativePath: plan.childRelativePath, text: plan.childText },
      { relativePath: plan.parentRelativePath, text: plan.parentText },
    ],
  );

  return {
    parentRelativePath: plan.parentRelativePath,
    childRelativePath: plan.childRelativePath,
    childKey: plan.childKey,
  };
}

export function previewRename(
  relativePath: string,
  newKey: string,
): RenamePreviewDto {
  const plan = planRename(libraryService.loadAllFiles(), relativePath, newKey);
  return {
    canRename: plan.canRename,
    reason: plan.reason,
    sourceKey: plan.sourceKey,
    sourceRelativePath: plan.sourceRelativePath,
    newKey: plan.newKey,
    newRelativePath: plan.newRelativePath,
    affectedFiles: plan.edits.map((e) => ({
      key: e.key,
      relativePath: e.relativePath,
      occurrences: e.occurrences,
    })),
    totalOccurrences: plan.totalOccurrences,
    warnings: plan.warnings,
  };
}

export function renameFile(
  relativePath: string,
  newKey: string,
): RenameResultDto {
  const plan = planRename(libraryService.loadAllFiles(), relativePath, newKey);
  if (!plan.canRename) {
    throw new Error(plan.reason ?? 'Cannot rename this file');
  }
  const ops: FileOp[] = [
    ...plan.edits.map((e) => ({ relativePath: e.relativePath, text: e.newText })),
    { relativePath: plan.newRelativePath, text: plan.sourceText },
    { relativePath: plan.sourceRelativePath, text: null },
  ];
  applyMutation(
    `Rename ${plan.sourceRelativePath} → ${plan.newRelativePath}`,
    ops,
  );
  return {
    newRelativePath: plan.newRelativePath,
    editedFiles: plan.edits.length,
    totalOccurrences: plan.totalOccurrences,
  };
}

/** Create a new wildcard file (fails if it already exists). */
export function createFile(relativePath: string, text = ''): string {
  let exists = false;
  try {
    libraryService.readFile(relativePath);
    exists = true;
  } catch {
    exists = false;
  }
  if (exists) throw new Error(`File already exists: ${relativePath}`);
  applyMutation(`Create ${relativePath}`, [{ relativePath, text }]);
  return relativePath;
}

/** Delete a wildcard file and strip inbound references (undoable + backed up). */
export function removeFile(relativePath: string): DeleteResultDto {
  const plan = planDelete(libraryService.loadAllFiles(), relativePath);
  if (!plan.canDelete) {
    throw new Error(plan.reason ?? 'Cannot delete this file');
  }
  const ops: FileOp[] = [
    ...plan.edits.map((edit) => ({
      relativePath: edit.relativePath,
      text: edit.newText,
    })),
    { relativePath: plan.sourceRelativePath, text: null },
  ];
  applyMutation(`Delete ${plan.sourceRelativePath}`, ops);
  return {
    deletedRelativePath: plan.sourceRelativePath,
    editedFiles: plan.edits.length,
    totalOccurrences: plan.totalOccurrences,
  };
}

/** Strip every occurrence of an unresolved wildcard reference. */
export function cleanupMissingReference(
  referenceName: string,
): ReferenceCleanupResultDto {
  const plan = planReferenceCleanup(
    libraryService.loadAllFiles(),
    referenceName,
  );
  if (!plan.canClean) {
    throw new Error(plan.reason ?? 'Cannot clean this reference');
  }
  applyMutation(
    `Remove references to __${plan.referenceName}__`,
    plan.edits.map((edit) => ({
      relativePath: edit.relativePath,
      text: edit.newText,
    })),
  );
  return {
    referenceName: plan.referenceName,
    editedFiles: plan.edits.length,
    totalOccurrences: plan.totalOccurrences,
  };
}

/** Preview ranked single-edge removals for a cycle issue. */
export function previewCycleFix(
  rootRelativePath: string,
  issue: CycleFixIssueSeedDto,
): CycleFixPreviewDto {
  const files = libraryService.loadAllFiles();
  const analysis = analyzeWildcardTree({
    rootRelativePath,
    files,
    validationPlatform: getActiveLibrary().validationPlatform ?? 'comfyui',
  });
  const plan = planCycleFixFromIssue(
    files,
    analysis.rootNodeId,
    analysis.edges,
    issue,
  );
  const byPath = new Map(files.map((f) => [f.relativePath, f]));
  return {
    canResolve: plan.canResolve,
    reason: plan.reason,
    groupId: plan.group?.id ?? null,
    nodeIds: plan.group?.nodeIds ?? [],
    paths: plan.group?.paths ?? [],
    suggestions: plan.suggestions.map((s) => ({
      id: s.id,
      from: s.edge.from,
      to: s.edge.to,
      line: s.edge.line,
      column: s.edge.column,
      snippet: s.edge.snippet,
      relativePath: s.relativePath,
      mode: s.mode,
      score: s.score,
      impact: s.impact,
      summary: s.summary,
      details: s.details,
      breaksAllCycles: s.breaksAllCycles,
      unreachableFromRoot: s.unreachableFromRoot,
      newText: s.newText,
      oldText: byPath.get(s.relativePath)?.text ?? '',
    })),
  };
}

/** Apply a cycle-edge removal as an undoable mutation. */
export function applyCycleFix(
  request: CycleFixApplyRequestDto,
): CycleFixResultDto {
  const files = libraryService.loadAllFiles();
  const file = files.find((f) => f.relativePath === request.relativePath);
  if (!file) {
    throw new Error(`Source file not found: ${request.relativePath}`);
  }
  const result = removeReferenceAt(
    file.text,
    request.line,
    request.column,
    request.snippet,
  );
  if (!result.ok) {
    throw new Error(result.reason ?? 'Cycle fix no longer applies');
  }
  applyMutation(`Break cycle: remove ${request.snippet}`, [
    { relativePath: file.relativePath, text: result.text },
  ]);
  return {
    relativePath: file.relativePath,
    from: file.key,
    to: request.snippet.replace(/^__|__$/g, ''),
    snippet: request.snippet,
  };
}
