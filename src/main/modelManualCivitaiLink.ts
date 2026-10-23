import {
  civitaiModelPageUrl,
  parseCivitaiModelPageUrl,
  type CivitaiOrigin,
} from '../domain/civitaiSnippet.js';
import {
  huggingfaceModelPageUrl,
  parseHuggingFaceModelPageUrl,
} from '../domain/huggingfaceSearch.js';
import {
  collectAutoV2HashesFromVersions,
  normalizeAutoV2,
  unionAutoV2Hashes,
} from '../domain/modelHash.js';
import { getCivitaiModel, primaryPreviewUrl, type CivitaiModel } from './civitaiClient.js';
import {
  getCivitaiOrigin,
  markCivitaiModelInstalled,
  unmarkCivitaiModelInstalled,
} from './settingsStore.js';
import {
  getCachedModel,
  insertCachedModelsIfAbsent,
  patchCachedModel,
  rememberAllAutoV2InCatalogIndex,
  type CachedCivitaiModel,
} from './civitaiCatalogCache.js';
import { hasCachedCivitaiPreview } from './civitaiPreviewCache.js';
import {
  PREVIEW_PRIORITY,
  requestCachedPreview,
} from './civitaiPreviewQueue.js';
import { localCivitaiPreviewUrl } from '../shared/civitaiPreviewUrl.js';
import {
  loadModelsStoreForPath,
  saveModelsStore,
  type ManualLinkEntry,
} from './modelRootStore.js';

export const HUGGINGFACE_LINK_ORIGIN = 'huggingface';

export type ManualCivitaiLink = {
  modelId: number;
  origin: CivitaiOrigin | typeof HUGGINGFACE_LINK_ORIGIN;
  name: string;
  pageUrl: string;
  previewUrl?: string;
};

export function isHuggingFaceSourceLink(link: {
  origin: string;
  pageUrl: string;
}): boolean {
  return (
    link.origin === HUGGINGFACE_LINK_ORIGIN ||
    parseHuggingFaceModelPageUrl(link.pageUrl) != null
  );
}

function toLink(entry: ManualLinkEntry): ManualCivitaiLink {
  return {
    modelId: entry.modelId,
    origin: entry.origin as CivitaiOrigin,
    name: entry.name,
    pageUrl: entry.pageUrl,
    previewUrl: entry.previewUrl,
  };
}

export function lookupManualCivitaiLink(
  absolutePath: string,
  autoV2?: string | null,
): ManualCivitaiLink | null {
  const ctx = loadModelsStoreForPath(absolutePath);
  if (!ctx) return null;
  const hash = normalizeAutoV2(autoV2 ?? undefined);
  if (hash && ctx.store.links.byAutoV2[hash]) {
    return toLink(ctx.store.links.byAutoV2[hash]!);
  }
  const byPath = ctx.store.links.byPath[ctx.pathKey];
  return byPath ? toLink(byPath) : null;
}

export function manualLinkToFields(link: ManualCivitaiLink): {
  civitaiModelId?: number;
  civitaiName: string;
  civitaiPageUrl: string;
  previewUrl?: string;
  previewLocalUrl?: string | null;
  civitaiLinkManual: true;
} {
  const previewUrl = link.previewUrl;
  const pageUrl = isHuggingFaceSourceLink(link)
    ? huggingfaceModelPageUrl(
        parseHuggingFaceModelPageUrl(link.pageUrl)?.repoId ?? link.name,
      )
    : link.pageUrl;
  return {
    ...(isHuggingFaceSourceLink(link) ? {} : { civitaiModelId: link.modelId }),
    civitaiName: link.name,
    civitaiPageUrl: pageUrl,
    previewUrl,
    previewLocalUrl:
      previewUrl && hasCachedCivitaiPreview(previewUrl)
        ? localCivitaiPreviewUrl(previewUrl)
        : null,
    civitaiLinkManual: true,
  };
}

/** Store the Hub page on the downloaded file (path, and AutoV2 once known). */
export function rememberHuggingFaceSourceLink(opts: {
  absolutePath: string;
  repoId: string;
  autoV2?: string | null;
}): void {
  const parsed = parseHuggingFaceModelPageUrl(huggingfaceModelPageUrl(opts.repoId));
  if (!parsed) return;
  const entry: ManualLinkEntry = {
    modelId: 0,
    origin: HUGGINGFACE_LINK_ORIGIN,
    name: parsed.repoId,
    pageUrl: huggingfaceModelPageUrl(parsed.repoId),
  };
  const ctx = loadModelsStoreForPath(opts.absolutePath);
  if (!ctx) return;
  ctx.store.links.byPath[ctx.pathKey] = entry;
  const hash = normalizeAutoV2(opts.autoV2 ?? undefined);
  if (hash) {
    const existing = ctx.store.links.byAutoV2[hash];
    if (!existing || existing.origin === HUGGINGFACE_LINK_ORIGIN) {
      ctx.store.links.byAutoV2[hash] = entry;
    }
  }
  saveModelsStore(ctx.root, ctx.store);
}

/**
 * Ensure the catalog card exists and carries the local AutoV2 (plus any API
 * hashes). Browse/Downloaded install detection uses card.autoV2Hashes ∩ local
 * files — a stub-only insert left existing cards untouched, so manual links
 * never flipped `installed`.
 */
function upsertCatalogStub(
  link: ManualCivitaiLink,
  autoV2?: string | null,
  apiModel?: CivitaiModel | null,
): void {
  const localHash = normalizeAutoV2(autoV2 ?? undefined);
  const apiHashes = collectAutoV2HashesFromVersions(apiModel?.modelVersions);
  const hashes = unionAutoV2Hashes(
    localHash ? [localHash] : undefined,
    apiHashes,
  );
  const modelType =
    typeof apiModel?.type === 'string' &&
    apiModel.type.trim().toLowerCase() === 'checkpoint'
      ? 'Checkpoint'
      : typeof apiModel?.type === 'string' && apiModel.type.trim()
        ? apiModel.type
        : 'LORA';

  const existing = getCachedModel(link.origin, link.modelId);
  if (!existing) {
    const now = new Date().toISOString();
    const row: CachedCivitaiModel = {
      id: link.modelId,
      origin: link.origin,
      name: link.name,
      type: modelType,
      nsfw: Boolean(apiModel?.nsfw),
      tags: [],
      trainedWords: [],
      previewUrl: link.previewUrl,
      previewMissing: !link.previewUrl,
      autoV2: hashes[0] ?? localHash ?? undefined,
      autoV2Hashes: hashes.length > 0 ? hashes : undefined,
      pageUrl: link.pageUrl,
      earlyAccess: false,
      firstSeenAt: now,
      updatedAt: now,
    };
    insertCachedModelsIfAbsent([row]);
  } else {
    patchCachedModel(link.origin, link.modelId, {
      ...(link.previewUrl && !existing.previewUrl
        ? { previewUrl: link.previewUrl, previewMissing: false }
        : {}),
      ...(!existing.autoV2 && (hashes[0] || localHash)
        ? { autoV2: hashes[0] ?? localHash ?? undefined }
        : {}),
      ...(hashes.length > 0 ? { autoV2Hashes: hashes } : {}),
    });
  }

  const row = getCachedModel(link.origin, link.modelId);
  if (row) rememberAllAutoV2InCatalogIndex(row);

  // Mark installed so Browse (hideInstalled) hides the card even when the
  // local AutoV2 is absent from Civitai’s published hashes (AIR / rename).
  if (getCivitaiOrigin() === link.origin) {
    markCivitaiModelInstalled(link.modelId);
  }
}

async function fetchModelCard(
  origin: CivitaiOrigin,
  modelId: number,
): Promise<CivitaiModel | null> {
  try {
    if (getCivitaiOrigin() === origin) {
      return await getCivitaiModel(modelId);
    }
    const res = await fetch(`${origin}/api/v1/models/${modelId}`, {
      headers: { Accept: 'application/json' },
    });
    if (!res.ok) return null;
    return (await res.json()) as CivitaiModel;
  } catch {
    return null;
  }
}

/**
 * Save a manual Civitai model page URL for a local file (by AutoV2 and/or path).
 * Optionally refreshes name/preview from the API.
 */
export async function setManualCivitaiLink(opts: {
  absolutePath: string;
  autoV2?: string | null;
  pageUrl: string;
}): Promise<ManualCivitaiLink> {
  const hf = parseHuggingFaceModelPageUrl(opts.pageUrl);
  if (hf) {
    rememberHuggingFaceSourceLink({
      absolutePath: opts.absolutePath,
      repoId: hf.repoId,
      autoV2: opts.autoV2,
    });
    return {
      modelId: 0,
      origin: HUGGINGFACE_LINK_ORIGIN,
      name: hf.repoId,
      pageUrl: huggingfaceModelPageUrl(hf.repoId),
    };
  }

  const parsed = parseCivitaiModelPageUrl(opts.pageUrl);
  if (!parsed) {
    throw new Error(
      'Enter a Civitai model URL like https://civitai.com/models/12345/name, or a Hugging Face repo URL.',
    );
  }

  let name =
    parsed.slug?.replace(/-/g, ' ') ||
    `Model ${parsed.modelId}`;
  let previewUrl: string | undefined;

  const model = await fetchModelCard(parsed.origin, parsed.modelId);
  if (model) {
    if (model.name?.trim()) name = model.name.trim();
    previewUrl = primaryPreviewUrl(model) ?? undefined;
    if (previewUrl) {
          void requestCachedPreview(
            previewUrl,
            PREVIEW_PRIORITY.library,
            parsed.modelId,
          );
    }
  }

  const link: ManualCivitaiLink = {
    modelId: parsed.modelId,
    origin: parsed.origin,
    name,
    pageUrl: civitaiModelPageUrl(parsed.origin, parsed.modelId, name),
    previewUrl,
  };

  const ctx = loadModelsStoreForPath(opts.absolutePath);
  if (ctx) {
    const entry: ManualLinkEntry = { ...link };
    ctx.store.links.byPath[ctx.pathKey] = entry;
    const hash = normalizeAutoV2(opts.autoV2 ?? undefined);
    if (hash) ctx.store.links.byAutoV2[hash] = entry;
    saveModelsStore(ctx.root, ctx.store);
  }

  upsertCatalogStub(link, normalizeAutoV2(opts.autoV2 ?? undefined), model);
  return link;
}

export function clearManualCivitaiLink(opts: {
  absolutePath: string;
  autoV2?: string | null;
}): void {
  const prior = lookupManualCivitaiLink(opts.absolutePath, opts.autoV2);
  const ctx = loadModelsStoreForPath(opts.absolutePath);
  if (ctx) {
    delete ctx.store.links.byPath[ctx.pathKey];
    const hash = normalizeAutoV2(opts.autoV2 ?? undefined);
    if (hash) delete ctx.store.links.byAutoV2[hash];
    saveModelsStore(ctx.root, ctx.store);
  }

  if (prior && getCivitaiOrigin() === prior.origin) {
    unmarkCivitaiModelInstalled(prior.modelId);
  }
}
