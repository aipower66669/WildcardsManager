import type { LibraryConfig } from './settingsStore.js';
import type { LibraryConfigDto } from '../shared/contracts.js';

export function toLibraryConfigDto(lib: LibraryConfig): LibraryConfigDto {
  return {
    id: lib.id,
    name: lib.name,
    wildcardsRoot: lib.wildcardsRoot,
    loraFolder: lib.loraFolder,
    checkpointFolder: lib.checkpointFolder,
    imagesFolder: lib.imagesFolder,
    videosFolder: lib.videosFolder,
    mastersFolder: lib.mastersFolder,
    trainingLibraryFolder: lib.trainingLibraryFolder,
    promptsFolder: lib.promptsFolder,
    generationOutputRealistic: lib.generationOutputRealistic,
    generationOutputHentai: lib.generationOutputHentai,
    generationOutput3d: lib.generationOutput3d,
    benchmarkOutputFolder: lib.benchmarkOutputFolder,
    lastRootFile: lib.lastRootFile,
    enabledArchitectures: [...lib.enabledArchitectures],
    enabledSdxlFamilies: [...lib.enabledSdxlFamilies],
    enabledCivitaiCategories: [...lib.enabledCivitaiCategories],
    validationPlatform: lib.validationPlatform ?? 'comfyui',
    generationFamily: lib.generationFamily === 'sdxl' ? 'sdxl' : 'krea2',
    civitaiOrigin: lib.civitaiOrigin ?? 'https://civitai.com',
  };
}
