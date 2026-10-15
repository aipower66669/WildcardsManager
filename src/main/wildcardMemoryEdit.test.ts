import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('electron', () => ({
  app: { getPath: () => path.join(os.tmpdir(), 'wcm-wme-settings') },
  BrowserWindow: { getAllWindows: () => [] },
}));

const applyOp = vi.fn();
const liveText = vi.fn();

vi.mock('./openFileLiveText.js', () => ({
  requestOpenFileApplyOp: (...args: unknown[]) => applyOp(...args),
  requestOpenFileLiveText: (...args: unknown[]) => liveText(...args),
}));

import { libraryService } from './libraryService.js';
import { resetHistory, undo } from './mutationService.js';
import { saveFile } from './refactorService.js';
import { applyLoraWildcardOpInMemory } from './wildcardMemoryEdit.js';

const temps: string[] = [];

function makeRoot(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wcm-wme-'));
  temps.push(dir);
  return dir;
}

afterEach(() => {
  resetHistory();
  libraryService.closeRoot();
  applyOp.mockReset();
  liveText.mockReset();
  for (const dir of temps.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

beforeEach(() => {
  applyOp.mockResolvedValue(null);
  liveText.mockResolvedValue(null);
});

const appendOp = {
  type: 'append' as const,
  snippet: '<lora:Foo:1>',
  fileStem: 'Foo',
};

describe('applyLoraWildcardOpInMemory', () => {
  it('persists to disk when the category file is not open', async () => {
    const root = makeRoot();
    const file = path.join(root, 'cats.txt');
    fs.writeFileSync(file, 'siamese\n');
    libraryService.openRoot(root);

    const result = await applyLoraWildcardOpInMemory(
      'cats.txt',
      appendOp,
      'Add LoRA reference to cats.txt',
    );
    expect(result.changed).toBe(true);
    expect(libraryService.readFile('cats.txt').text).toContain('<lora:Foo:1>');
    expect(fs.readFileSync(file, 'utf8')).toContain('<lora:Foo:1>');
    expect(libraryService.hasUnsavedMemory('cats.txt')).toBe(false);
  });

  it('keeps the edit in memory when the live editor applied it', async () => {
    const root = makeRoot();
    const file = path.join(root, 'cats.txt');
    fs.writeFileSync(file, 'siamese\n');
    libraryService.openRoot(root);

    applyOp.mockResolvedValue({
      before: 'siamese\nuser note\n',
      text: 'siamese\nuser note\n\n<lora:Foo:1>\n',
      changed: true,
    });

    const result = await applyLoraWildcardOpInMemory(
      'cats.txt',
      appendOp,
      'Add LoRA reference to cats.txt',
    );
    expect(result.changed).toBe(true);
    expect(libraryService.readFile('cats.txt').text).toBe(
      'siamese\nuser note\n\n<lora:Foo:1>\n',
    );
    expect(libraryService.hasUnsavedMemory('cats.txt')).toBe(true);
    expect(fs.readFileSync(file, 'utf8')).toBe('siamese\n');
  });

  it('uses live editor text when the apply bridge is missing', async () => {
    const root = makeRoot();
    const file = path.join(root, 'cats.txt');
    fs.writeFileSync(file, 'siamese\n');
    libraryService.openRoot(root);

    applyOp.mockResolvedValue(null);
    liveText.mockResolvedValue('siamese\ndirty\n');

    const result = await applyLoraWildcardOpInMemory(
      'cats.txt',
      appendOp,
      'Add LoRA reference to cats.txt',
    );
    expect(result.changed).toBe(true);
    expect(libraryService.readFile('cats.txt').text).toBe(
      'siamese\ndirty\n\n<lora:Foo:1>\n',
    );
    expect(fs.readFileSync(file, 'utf8')).toBe('siamese\n');
  });

  it('does not write when the snippet is already present', async () => {
    const root = makeRoot();
    const file = path.join(root, 'cats.txt');
    fs.writeFileSync(file, 'siamese\n\n<lora:Foo:1>\n');
    libraryService.openRoot(root);

    const result = await applyLoraWildcardOpInMemory(
      'cats.txt',
      appendOp,
      'Add LoRA reference to cats.txt',
    );
    expect(result.changed).toBe(false);
    expect(fs.readFileSync(file, 'utf8')).toBe('siamese\n\n<lora:Foo:1>\n');
  });

  it('persists a memory-only edit when saveFile runs', async () => {
    const root = makeRoot();
    const file = path.join(root, 'cats.txt');
    fs.writeFileSync(file, 'siamese\n');
    libraryService.openRoot(root);

    applyOp.mockResolvedValue({
      before: 'siamese\n',
      text: 'siamese\n\n<lora:Foo:1>\n',
      changed: true,
    });
    await applyLoraWildcardOpInMemory(
      'cats.txt',
      appendOp,
      'Add LoRA reference to cats.txt',
    );

    const saved = saveFile('cats.txt', 'siamese\n\n<lora:Foo:1>\n');
    expect(saved.writtenText).toContain('<lora:Foo:1>');
    expect(fs.readFileSync(file, 'utf8')).toContain('<lora:Foo:1>');
    expect(libraryService.hasUnsavedMemory('cats.txt')).toBe(false);
  });

  it('undo of a memory-only edit restores RAM and leaves disk alone', async () => {
    const root = makeRoot();
    const file = path.join(root, 'cats.txt');
    fs.writeFileSync(file, 'siamese\n');
    libraryService.openRoot(root);

    applyOp.mockResolvedValue({
      before: 'siamese\nedit\n',
      text: 'siamese\nedit\n\n<lora:Foo:1>\n',
      changed: true,
    });
    await applyLoraWildcardOpInMemory(
      'cats.txt',
      appendOp,
      'Add LoRA reference to cats.txt',
    );
    undo();
    expect(libraryService.readFile('cats.txt').text).toBe('siamese\nedit\n');
    expect(fs.readFileSync(file, 'utf8')).toBe('siamese\n');
  });
});
