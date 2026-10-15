import { describe, expect, it } from 'vitest';
import {
  autoV2FromSha256,
  normalizeAutoV2,
  pickCivitaiAutoV2,
  parseAutoV2FromHashSidecarText,
  collectAutoV2HashesFromVersions,
  unionAutoV2Hashes,
} from './modelHash.js';

describe('modelHash', () => {
  it('normalizes AutoV2 to uppercase 10 hex chars', () => {
    expect(normalizeAutoV2('a5f58eb1c3')).toBe('A5F58EB1C3');
    expect(normalizeAutoV2('A5F58EB1C3')).toBe('A5F58EB1C3');
    expect(normalizeAutoV2('too-short')).toBeNull();
    expect(normalizeAutoV2('A5F58EB1C3FF')).toBeNull();
  });

  it('derives AutoV2 from full SHA-256', () => {
    expect(
      autoV2FromSha256(
        'a5f58eb1c33616c4f06bca55af39876a7b817913cd829caa8acb111b770c85cc',
      ),
    ).toBe('A5F58EB1C3');
  });

  it('picks AutoV2 from Civitai hashes, falling back to SHA256', () => {
    expect(
      pickCivitaiAutoV2({
        AutoV2: 'A5F58EB1C3',
        SHA256:
          'A5F58EB1C33616C4F06BCA55AF39876A7B817913CD829CAA8ACB111B770C85CC',
      }),
    ).toBe('A5F58EB1C3');
    expect(
      pickCivitaiAutoV2({
        SHA256:
          'a5f58eb1c33616c4f06bca55af39876a7b817913cd829caa8acb111b770c85cc',
      }),
    ).toBe('A5F58EB1C3');
  });

  it('collects AutoV2 from every model version file', () => {
    expect(
      collectAutoV2HashesFromVersions([
        {
          files: [{ hashes: { AutoV2: '1111111111' } }],
        },
        {
          files: [
            { hashes: { AutoV2: '2222222222' } },
            { hashes: { AutoV2: '1111111111' } },
          ],
        },
      ]),
    ).toEqual(['1111111111', '2222222222']);
  });

  it('unions AutoV2 lists without duplicates', () => {
    expect(
      unionAutoV2Hashes(
        ['aaaaaaaaaa', 'bbbbbbbbbb'],
        ['BBBBBBBBBB', 'cccccccccc'],
      ),
    ).toEqual(['AAAAAAAAAA', 'BBBBBBBBBB', 'CCCCCCCCCC']);
  });

  it('parses AutoV2 from hash sidecar text', () => {
    expect(parseAutoV2FromHashSidecarText('AutoV2: A5F58EB1C3')).toBe(
      'A5F58EB1C3',
    );
    expect(
      parseAutoV2FromHashSidecarText(
        'HASH256: a5f58eb1c33616c4f06bca55af39876a7b817913cd829caa8acb111b770c85cc',
      ),
    ).toBe('A5F58EB1C3');
    // Old AutoV1 / HASH alone is not enough.
    expect(parseAutoV2FromHashSidecarText('HASH: A1B2C3D4')).toBeNull();
  });
});
