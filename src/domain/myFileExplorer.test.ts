import { describe, expect, it } from 'vitest';
import { myFileExplorerUrl } from './myFileExplorer.js';

describe('myFileExplorerUrl', () => {
  it('encodes a Windows file path for reveal', () => {
    expect(myFileExplorerUrl('reveal', 'D:\\Projects\\shot.png')).toBe(
      'mfe://reveal?path=D%3A%5CProjects%5Cshot.png',
    );
  });

  it('encodes a folder path for open', () => {
    expect(myFileExplorerUrl('open', 'D:\\Projects')).toBe(
      'mfe://open?path=D%3A%5CProjects',
    );
  });

  it('rejects an empty path', () => {
    expect(() => myFileExplorerUrl('open', '   ')).toThrow(/Empty path/);
  });
});
