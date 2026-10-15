import { describe, expect, it } from 'vitest';
import { isComfyLaunchPath } from './ensureComfyRunning.js';

describe('isComfyLaunchPath', () => {
  it('accepts common Windows launchers', () => {
    expect(isComfyLaunchPath('D:\\AI\\ComfyUI\\run_nvidia_gpu.bat')).toBe(true);
    expect(isComfyLaunchPath('C:/ComfyUI/run.cmd')).toBe(true);
    expect(isComfyLaunchPath('C:/ComfyUI/ComfyUI.exe')).toBe(true);
    expect(isComfyLaunchPath('C:/Users/me/Desktop/ComfyUI.lnk')).toBe(true);
    expect(isComfyLaunchPath('/opt/comfy/start.sh')).toBe(true);
  });

  it('rejects unrelated files', () => {
    expect(isComfyLaunchPath('D:\\AI\\ComfyUI\\README.md')).toBe(false);
    expect(isComfyLaunchPath('workflow.json')).toBe(false);
  });
});
