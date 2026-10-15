/**
 * ADS writes/deletes update NTFS LastWriteTime on the host file or folder
 * even though $DATA is untouched. Capture times first, mutate the stream,
 * then put atime/mtime back so backup tools do not see a content change.
 */
import fs from 'node:fs';

export type HostTimes = {
  atime: Date;
  mtime: Date;
};

export function captureHostTimes(hostPath: string): HostTimes | null {
  try {
    const st = fs.statSync(hostPath);
    return { atime: st.atime, mtime: st.mtime };
  } catch {
    return null;
  }
}

export function restoreHostTimes(hostPath: string, times: HostTimes): void {
  try {
    fs.utimesSync(hostPath, times.atime, times.mtime);
  } catch {
    /* host gone / not permitted — ADS mutation already finished */
  }
}

export function withPreservedHostTimesSync<T>(
  hostPath: string,
  mutate: () => T,
): T {
  const times = captureHostTimes(hostPath);
  try {
    return mutate();
  } finally {
    if (times) restoreHostTimes(hostPath, times);
  }
}

export async function withPreservedHostTimes<T>(
  hostPath: string,
  mutate: () => Promise<T>,
): Promise<T> {
  const times = captureHostTimes(hostPath);
  try {
    return await mutate();
  } finally {
    if (times) restoreHostTimes(hostPath, times);
  }
}
