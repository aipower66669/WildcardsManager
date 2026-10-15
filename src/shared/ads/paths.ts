/**
 * NTFS Alternate Data Stream path helpers (same shape as MyFileExplorer).
 * Safe to unit-test without Win32.
 */

export const ADS_STREAM_SEPARATOR = ':';
export const ADS_DATA_SUFFIX = '$DATA';
export const ADS_MAX_PATH = 256;
export const ADS_LONG_PATH_PREFIX = '\\\\?\\';

/** NTFS stream name for Civitai AutoV2 on LoRA/checkpoint files. */
export const AUTOV2_ADS_NAME = 'AUTOV2';

/**
 * Build `path:streamName:$DATA`, prefixing `\\?\` when the result is long.
 */
export function buildStreamPath(filePath: string, streamName: string): string {
  let result = filePath;
  if (!filePath) return result;
  if (result.length === 1) result = '.\\' + result;
  result +=
    ADS_STREAM_SEPARATOR + streamName + ADS_STREAM_SEPARATOR + ADS_DATA_SUFFIX;
  if (result.length >= ADS_MAX_PATH) result = ADS_LONG_PATH_PREFIX + result;
  return result;
}
