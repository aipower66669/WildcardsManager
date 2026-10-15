import { describe, expect, it } from 'vitest';
import { versionFileIsMarkedInstalled } from './civitaiVersionMark.js';

describe('versionFileIsMarkedInstalled', () => {
  const marks = [
    {
      versionId: 10,
      fileId: 99,
      fileName: 'lustifyNSFWCheckpoint_v10Krea2.safetensors',
    },
  ];

  it('matches by file id', () => {
    expect(versionFileIsMarkedInstalled(marks, 10, 99, 'other.safetensors')).toBe(
      true,
    );
  });

  it('matches by file name when catalog omits file id', () => {
    expect(
      versionFileIsMarkedInstalled(
        marks,
        10,
        null,
        'lustifyNSFWCheckpoint_v10Krea2.safetensors',
      ),
    ).toBe(true);
  });

  it('matches thin rows with no file id via any mark on the version', () => {
    expect(versionFileIsMarkedInstalled(marks, 10, null, null)).toBe(true);
  });

  it('does not mark a different file id on the same version', () => {
    expect(
      versionFileIsMarkedInstalled(marks, 10, 100, 'other.safetensors'),
    ).toBe(false);
  });

  it('does not match a different version', () => {
    expect(
      versionFileIsMarkedInstalled(
        marks,
        11,
        null,
        'lustifyNSFWCheckpoint_v10Krea2.safetensors',
      ),
    ).toBe(false);
  });
});
