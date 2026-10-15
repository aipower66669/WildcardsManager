import type {
  GlobalSearchHitDto,
  GlobalSearchResultDto,
  GlobalSearchScopesDto,
} from '../shared/contracts.js';
import { searchGenFiles, searchWildcardFiles } from '../domain/globalSearch.js';
import { searchConfiguredCheckpoints } from './checkpointService.js';
import { libraryService } from './libraryService.js';
import { searchConfiguredLoras } from './loraService.js';
import { listGenFiles } from './promptsService.js';

const LIMIT_PER_KIND = 100;

/**
 * Cross-asset search for the Search workspace tab / launcher.
 * Soft-fails per scope (missing folders) via `warnings` instead of throwing.
 */
export async function searchLibrary(
  query: string,
  scopes: GlobalSearchScopesDto,
): Promise<GlobalSearchResultDto> {
  const trimmed = query.trim();
  const hits: GlobalSearchHitDto[] = [];
  const warnings: string[] = [];

  if (!trimmed) {
    return { query: trimmed, hits, warnings };
  }

  if (scopes.wildcards) {
    try {
      const root = libraryService.getRoot();
      if (!root) {
        warnings.push('No wildcards folder open in the active library.');
      } else {
        const files = libraryService.loadAllFiles().map((f) => ({
          relativePath: f.relativePath,
          name: f.name,
          text: f.text,
        }));
        const { nameHits, contentHits } = searchWildcardFiles(
          files,
          trimmed,
          LIMIT_PER_KIND,
        );
        hits.push(...nameHits, ...contentHits);
      }
    } catch (e) {
      warnings.push(
        e instanceof Error ? e.message : `Wildcard search failed: ${String(e)}`,
      );
    }
  }

  if (scopes.prompts) {
    try {
      const files = listGenFiles();
      const { nameHits, contentHits } = searchGenFiles(
        files.map((file) => ({
          relativeFolder: file.relativeFolder,
          text: file.content,
        })),
        trimmed,
        LIMIT_PER_KIND,
      );
      hits.push(...nameHits, ...contentHits);
    } catch (e) {
      warnings.push(
        e instanceof Error ? e.message : `Prompt search failed: ${String(e)}`,
      );
    }
  }

  if (scopes.loras) {
    try {
      const result = await searchConfiguredLoras(trimmed, LIMIT_PER_KIND);
      for (const hit of result.hits) {
        hits.push({
          kind: 'lora',
          relativePath: hit.relativePath,
          absolutePath: hit.absolutePath,
          stem: hit.stem,
          exact: hit.exact,
        });
      }
    } catch (e) {
      warnings.push(
        e instanceof Error ? e.message : `LoRA search failed: ${String(e)}`,
      );
    }
  }

  if (scopes.checkpoints) {
    try {
      const result = await searchConfiguredCheckpoints(trimmed, LIMIT_PER_KIND);
      for (const hit of result.hits) {
        hits.push({
          kind: 'checkpoint',
          relativePath: hit.relativePath,
          absolutePath: hit.absolutePath,
          stem: hit.stem,
          exact: hit.exact,
        });
      }
    } catch (e) {
      warnings.push(
        e instanceof Error
          ? e.message
          : `Checkpoint search failed: ${String(e)}`,
      );
    }
  }

  return { query: trimmed, hits, warnings };
}
