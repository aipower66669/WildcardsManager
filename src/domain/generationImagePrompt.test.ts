import { createHash } from 'node:crypto';
import { deflateSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import {
  extractGenerationPromptsFromImage,
  parseA1111Parameters,
  readPngTextChunks,
  selectLastOutputPrompts,
} from './generationImagePrompt.js';

function crc32(buf: Buffer): number {
  let c = 0xffff_ffff;
  for (let i = 0; i < buf.length; i++) {
    c ^= buf[i]!;
    for (let k = 0; k < 8; k++) {
      c = c & 1 ? (c >>> 1) ^ 0xedb8_8320 : c >>> 1;
    }
  }
  return (c ^ 0xffff_ffff) >>> 0;
}

function pngChunk(type: string, data: Buffer): Buffer {
  const typeBuf = Buffer.from(type, 'latin1');
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const crcBuf = Buffer.alloc(4);
  crcBuf.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])));
  return Buffer.concat([len, typeBuf, data, crcBuf]);
}

function minimalPngWithText(
  texts: Record<string, string>,
  compressed = false,
): Buffer {
  const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(1, 0);
  ihdr.writeUInt32BE(1, 4);
  ihdr[8] = 8;
  ihdr[9] = 0;
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;
  const chunks = [pngChunk('IHDR', ihdr)];
  for (const [key, value] of Object.entries(texts)) {
    if (compressed) {
      const body = Buffer.concat([
        Buffer.from(key, 'latin1'),
        Buffer.from([0, 0]),
        deflateSync(Buffer.from(value, 'latin1')),
      ]);
      chunks.push(pngChunk('zTXt', body));
    } else {
      const body = Buffer.concat([
        Buffer.from(key, 'latin1'),
        Buffer.from([0]),
        Buffer.from(value, 'latin1'),
      ]);
      chunks.push(pngChunk('tEXt', body));
    }
  }
  chunks.push(pngChunk('IEND', Buffer.alloc(0)));
  return Buffer.concat([sig, ...chunks]);
}

describe('readPngTextChunks', () => {
  it('reads tEXt and zTXt', () => {
    const png = minimalPngWithText({ hello: 'world' });
    expect(readPngTextChunks(png)).toEqual({ hello: 'world' });
    const z = minimalPngWithText({ parameters: 'x\nSteps: 1' }, true);
    expect(readPngTextChunks(z).parameters).toBe('x\nSteps: 1');
  });
});

describe('parseA1111Parameters', () => {
  it('splits prompt / negative / settings like My File Explorer', () => {
    const parsed = parseA1111Parameters(
      'a cat, masterpiece\nNegative prompt: blurry\nSteps: 28, Sampler: Euler, Seed: 42',
    );
    expect(parsed?.prompt).toBe('a cat, masterpiece');
    expect(parsed?.negative).toBe('blurry');
  });
});

describe('extractGenerationPromptsFromImage', () => {
  it('reads Positive and Negative from parameters (ignores Comfy prompt JSON)', () => {
    const expanded =
      'bed with Feathers print pattern quill in bedroom, <lora:koda64krea2_c1-st4000:0.8>, vintage magazine scan, faded analog photograph, film grain, muted colors';
    const promptJson = JSON.stringify({
      '3': {
        class_type: 'LoraTrainingPrompt',
        inputs: {
          text: 'bed with feathers print pattern quilt in bedroom __style-amateur__',
        },
      },
    });
    const png = minimalPngWithText({
      prompt: promptJson,
      parameters: `${expanded}\nNegative prompt: watermark, twisted body\nSteps: 10, Sampler: exp_heun_2_x0, CFG scale: 1, Seed: 3691839209, Size: 1200x1600`,
    });
    expect(extractGenerationPromptsFromImage(png)).toEqual({
      positive: expanded,
      negative: 'watermark, twisted body',
    });
  });

  it('reads Comment when that holds the parameters block', () => {
    const expanded =
      '<lora:hippie_70s_epoch_12:0.8> A photograph of a hippie, amateur flash photography';
    const png = minimalPngWithText({
      Comment: `${expanded}\nNegative prompt: lowres\nSteps: 20`,
    });
    expect(extractGenerationPromptsFromImage(png)).toEqual({
      positive: expanded,
      negative: 'lowres',
    });
  });

  it('does not use Comfy prompt JSON alone as the caption', () => {
    const prompt = {
      '3': {
        class_type: 'LoraTrainingPrompt',
        inputs: { text: 'subject, __style-amateur__' },
      },
    };
    const png = minimalPngWithText({ prompt: JSON.stringify(prompt) });
    expect(extractGenerationPromptsFromImage(png)).toBeNull();
  });

  it('returns null for images without generation parameters', () => {
    const png = minimalPngWithText({});
    expect(extractGenerationPromptsFromImage(png)).toBeNull();
    const junk = Buffer.from(createHash('sha1').update('x').digest());
    expect(extractGenerationPromptsFromImage(junk)).toBeNull();
  });
});

describe('selectLastOutputPrompts', () => {
  it('always prefers successful image captions', () => {
    expect(
      selectLastOutputPrompts(
        {
          positive:
            'bed with Feathers print pattern quill in bedroom, <lora:x:0.8>, film grain',
          negative: 'watermark, twisted body',
        },
        'bed with feathers print pattern quilt in bedroom __style-amateur__',
        'fallback negative',
      ),
    ).toEqual({
      positive:
        'bed with Feathers print pattern quill in bedroom, <lora:x:0.8>, film grain',
      negative: 'watermark, twisted body',
    });
  });

  it('falls back to constructed when metadata is missing', () => {
    expect(
      selectLastOutputPrompts(
        null,
        'constructed, __style-amateur__',
        'watermark, twisted body',
      ),
    ).toEqual({
      positive: 'constructed, __style-amateur__',
      negative: 'watermark, twisted body',
    });
  });
});
