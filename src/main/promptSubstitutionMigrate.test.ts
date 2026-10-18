import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { migrateFromSettingsFile } from '../../scripts/migrate-prompt-substitutions.mjs';

const temps: string[] = [];

function tempDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wcm-prompt-sub-'));
  temps.push(dir);
  return dir;
}

afterEach(() => {
  for (const dir of temps.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

describe('migrate prompt substitutions', () => {
  it('adds an empty promptSubstitutions list and leaves an existing list', () => {
    const root = tempDir();
    const wildcards = path.join(root, 'wildcards');
    const other = path.join(root, 'other-wildcards');
    fs.mkdirSync(wildcards);
    fs.mkdirSync(other);
    const missingSidecar = path.join(root, 'wildcards.wcm');
    const presentSidecar = path.join(root, 'other-wildcards.wcm');
    fs.mkdirSync(missingSidecar);
    fs.mkdirSync(presentSidecar);
    fs.writeFileSync(
      path.join(missingSidecar, 'library.json'),
      `${JSON.stringify({ version: 1, ignoredCheckpoints: [] })}\n`,
    );
    const existing = [
      {
        modelContains: 'Kroma',
        find: '__loraname__',
        replace: '__loraname-KromaVersion__',
      },
    ];
    fs.writeFileSync(
      path.join(presentSidecar, 'library.json'),
      `${JSON.stringify({ version: 1, promptSubstitutions: existing })}\n`,
    );
    const settingsFile = path.join(root, 'settings.json');
    fs.writeFileSync(
      settingsFile,
      JSON.stringify({
        libraries: [
          { id: 'a', wildcardsRoot: wildcards },
          { id: 'b', wildcardsRoot: other },
          { id: 'c', wildcardsRoot: '' },
        ],
      }),
    );

    const first = migrateFromSettingsFile(settingsFile);
    expect(first.updated).toBe(1);
    expect(first.already).toBe(1);
    expect(first.missing).toBe(1);

    const added = JSON.parse(
      fs.readFileSync(path.join(missingSidecar, 'library.json'), 'utf8'),
    ) as { promptSubstitutions: unknown; ignoredCheckpoints: unknown };
    expect(added.promptSubstitutions).toEqual([]);
    expect(added.ignoredCheckpoints).toEqual([]);

    const kept = JSON.parse(
      fs.readFileSync(path.join(presentSidecar, 'library.json'), 'utf8'),
    ) as { promptSubstitutions: unknown };
    expect(kept.promptSubstitutions).toEqual(existing);

    const second = migrateFromSettingsFile(settingsFile);
    expect(second.updated).toBe(0);
    expect(second.already).toBe(2);
  });
});
