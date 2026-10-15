import { describe, expect, it } from 'vitest';
import {
  extractPromptKeywords,
  extractTagFrequencies,
  extractTriggerWords,
  parseSafetensorsHeaderJson,
  readSafetensorsHeaderLength,
  summarizeLoraMetadata,
} from './safetensorsMetadata.js';

describe('readSafetensorsHeaderLength', () => {
  it('reads little-endian u64', () => {
    const buf = new Uint8Array(8);
    const view = new DataView(buf.buffer);
    view.setUint32(0, 42, true);
    view.setUint32(4, 0, true);
    expect(readSafetensorsHeaderLength(buf)).toBe(42);
  });
});

describe('parseSafetensorsHeaderJson', () => {
  it('separates metadata from tensors', () => {
    const header = {
      __metadata__: {
        ss_network_dim: '16',
        ss_tag_frequency: JSON.stringify({
          img: { melly: 10, smile: 3 },
        }),
      },
      'lora_unet.weight': {
        dtype: 'F16',
        shape: [4, 4],
        data_offsets: [0, 32],
      },
    };
    const parsed = parseSafetensorsHeaderJson(JSON.stringify(header));
    expect(parsed.metadata.ss_network_dim).toBe('16');
    expect(parsed.tensors).toHaveLength(1);
    expect(parsed.tensors[0]).toMatchObject({
      name: 'lora_unet.weight',
      dtype: 'F16',
      byteLength: 32,
    });
  });
});

describe('extractTagFrequencies / extractTriggerWords', () => {
  it('aggregates tags across datasets by frequency', () => {
    const metadata = {
      ss_tag_frequency: JSON.stringify({
        a: { melly: 5, smile: 2 },
        b: { melly: 5, hat: 1 },
      }),
    };
    expect(extractTagFrequencies(metadata)).toEqual([
      { tag: 'melly', count: 10 },
      { tag: 'smile', count: 2 },
      { tag: 'hat', count: 1 },
    ]);
    expect(extractTriggerWords(metadata)[0]).toBe('melly');
  });

  it('falls back to trained_words list', () => {
    expect(
      extractTriggerWords({ trained_words: '["foo", "bar"]' }),
    ).toEqual(['foo', 'bar']);
    expect(extractTriggerWords({ trained_words: 'foo, bar' })).toEqual([
      'foo',
      'bar',
    ]);
  });
});

describe('extractPromptKeywords', () => {
  it('prefers explicit trained_words over tag frequency soup', () => {
    expect(
      extractPromptKeywords({
        trained_words: 'melly, smile',
        ss_tag_frequency: JSON.stringify({
          a: { melly: 10, smile: 10, '1girl': 10, solo: 9 },
        }),
      }),
    ).toEqual(['melly', 'smile']);
  });

  it('uses highest-frequency tags when no explicit triggers', () => {
    expect(
      extractPromptKeywords({
        ss_tag_frequency: JSON.stringify({
          a: { melly: 10, smile: 10, '1girl': 3 },
        }),
      }),
    ).toEqual(['melly', 'smile']);
  });
});

describe('summarizeLoraMetadata', () => {
  it('promotes common Kohya fields', () => {
    const s = summarizeLoraMetadata({
      ss_base_model_version: 'sdxl_base_1.0',
      ss_network_dim: '32',
      ss_network_alpha: '16',
      custom_note: 'hello',
    });
    expect(s.baseModel).toBe('sdxl_base_1.0');
    expect(s.networkDim).toBe('32');
    expect(s.otherFields).toEqual([{ key: 'custom_note', value: 'hello' }]);
  });
});
