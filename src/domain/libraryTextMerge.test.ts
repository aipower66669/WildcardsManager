import { describe, expect, it } from 'vitest';
import {
  mergeLibraryTextBuffers,
  resolveEditorSaveAgainstDisk,
} from './libraryTextMerge.js';

describe('mergeLibraryTextBuffers', () => {
  it('returns either side when equal', () => {
    expect(mergeLibraryTextBuffers('a', 'a', '')).toBe('a');
  });

  it('takes disk when it is a pure append onto live', () => {
    const live = 'hello';
    const disk = 'hello\n\n<lora:Foo:1>\n';
    expect(mergeLibraryTextBuffers(live, disk, 'hello')).toBe(disk);
  });

  it('keeps live when the user typed past disk', () => {
    expect(mergeLibraryTextBuffers('hello!', 'hello', 'hello')).toBe('hello!');
  });

  it('three-way merges LoRA append onto unsaved live edits', () => {
    const saved = 'line1\n';
    const live = 'line1\nuser edit\n';
    const disk = 'line1\n\n<lora:Bar:1>\n';
    expect(mergeLibraryTextBuffers(live, disk, saved)).toBe(
      'line1\nuser edit\n\n<lora:Bar:1>\n',
    );
  });

  it('does not duplicate an append already present in live', () => {
    const saved = 'base\n';
    const live = 'base\n\n<lora:Bar:1>\nextra\n';
    const disk = 'base\n\n<lora:Bar:1>\n';
    expect(mergeLibraryTextBuffers(live, disk, saved)).toBe(live);
  });

  it('handles append after trailing whitespace strip on live', () => {
    const live = 'hello  \n';
    const disk = 'hello\n\n<lora:X:1>\n';
    expect(mergeLibraryTextBuffers(live, disk, 'hello  \n')).toBe(disk);
  });

  it('keeps live when the user deleted and disk is still the saved baseline', () => {
    const saved = 'hello world';
    expect(mergeLibraryTextBuffers('hello ', saved, saved)).toBe('hello ');
    expect(mergeLibraryTextBuffers('hellorld', saved, saved)).toBe('hellorld');
    expect(mergeLibraryTextBuffers('', saved, saved)).toBe('');
  });

  it('still takes a real disk append after the user deleted', () => {
    const saved = 'hello world';
    const live = 'hello ';
    const disk = 'hello \n\n<lora:Foo:1>\n';
    expect(mergeLibraryTextBuffers(live, disk, saved)).toBe(disk);
  });

  it('takes disk on structural rewrite (convert-to-child pointer)', () => {
    const saved = 'line one\nline two\nweight tags\n';
    const live = saved;
    const disk = '__outfit_v2__\n';
    expect(mergeLibraryTextBuffers(live, disk, saved)).toBe(disk);
  });

  it('takes disk when live diverged and disk was fully rewritten', () => {
    const saved = 'original body\n';
    const live = 'original body\nuser typed more\n';
    const disk = '__child__\n';
    expect(mergeLibraryTextBuffers(live, disk, saved)).toBe(disk);
  });
});

describe('resolveEditorSaveAgainstDisk', () => {
  it('is a noop when disk already matches', () => {
    expect(resolveEditorSaveAgainstDisk('a', 'a')).toEqual({
      action: 'noop',
      writtenText: 'a',
    });
  });

  it('does not write backwards over a disk append that raced the save', () => {
    const text = 'hello';
    const disk = 'hello\n\n<lora:Foo:1>\n';
    expect(resolveEditorSaveAgainstDisk(text, disk, 'hello')).toEqual({
      action: 'notify',
      writtenText: disk,
    });
  });

  it('writes a user delete when disk is still the basedOn baseline', () => {
    expect(
      resolveEditorSaveAgainstDisk('hello ', 'hello world', 'hello world'),
    ).toEqual({
      action: 'write',
      writtenText: 'hello ',
    });
  });

  it('three-way merges when disk and live both diverged from basedOn', () => {
    const saved = 'line1\n';
    const live = 'line1\nuser\n';
    const disk = 'line1\n\n<lora:Bar:1>\n';
    expect(resolveEditorSaveAgainstDisk(live, disk, saved)).toEqual({
      action: 'write',
      writtenText: 'line1\nuser\n\n<lora:Bar:1>\n',
    });
  });

  it('does not clobber a convert-to-child pointer with the old editor body', () => {
    const saved = 'full wildcard body\n';
    const live = saved;
    const disk = '__child_key__\n';
    expect(resolveEditorSaveAgainstDisk(live, disk, saved)).toEqual({
      action: 'notify',
      writtenText: disk,
    });
  });
});
