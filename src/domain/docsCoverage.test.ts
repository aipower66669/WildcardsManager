import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

/**
 * UI geometry, one-time flags, and library bookkeeping. A new behavior key
 * does not belong here: name it somewhere under docs/.
 */
const UNDOCUMENTED_SETTINGS_KEYS = new Set([
  'recentRoots',
  'detailsPanelWidth',
  'filesPanelWidth',
  'panelWidthsByTab',
  'promptsSamplesCollapsed',
  'generationPreviewCollapsed',
  'promptCoverageWindow',
  'benchmarkResultsWindow',
  'benchmarkResultsView',
  'simulationIterations',
  'simulationSeed',
  'graphLayoutStyle',
  'workspaceListFilters',
  'convertChildSuffix',
  'archiveToMaybeMigrated',
  'civitaiBrowserDetached',
  'civitaiWindowState',
  'hfWindowState',
  'civitaiSplitRatio',
  'civitaiCardMinWidth',
  'windowState',
  'libraries',
  'activeLibraryId',
]);

function read(rel: string): string {
  return fs.readFileSync(path.join(root, rel), 'utf8');
}

function docsText(): string {
  const dir = path.join(root, 'docs');
  return fs
    .readdirSync(dir)
    .filter((name) => name.endsWith('.md'))
    .map((name) => fs.readFileSync(path.join(dir, name), 'utf8'))
    .join('\n');
}

function unionLiterals(source: string, typeName: string): string[] {
  const match = source.match(
    new RegExp(`(?:export )?type ${typeName} =([\\s\\S]*?);`),
  );
  if (!match) throw new Error(`missing type ${typeName}`);
  return [...match[1]!.matchAll(/'([^']+)'/g)].map((hit) => hit[1]!);
}

function sliceTypeBody(source: string, header: string): string {
  const at = source.indexOf(header);
  if (at < 0) throw new Error(`missing ${header}`);
  const brace = source.indexOf('{', at);
  let depth = 0;
  for (let i = brace; i < source.length; i += 1) {
    const ch = source[i];
    if (ch === '{') depth += 1;
    else if (ch === '}') {
      depth -= 1;
      if (depth === 0) return source.slice(brace + 1, i);
    }
  }
  throw new Error(`unclosed ${header}`);
}

function propertyNames(body: string): { name: string; deprecated: boolean }[] {
  const found: { name: string; deprecated: boolean }[] = [];
  let depth = 0;
  let comment = '';
  for (const line of body.split('\n')) {
    const open = (line.match(/\{/g) ?? []).length;
    const close = (line.match(/\}/g) ?? []).length;
    if (depth === 0) {
      const prop = /^\s*(?:readonly\s+)?([A-Za-z_][A-Za-z0-9_]*)\??\s*:/.exec(
        line,
      );
      const trimmed = line.trim();
      if (
        prop &&
        !trimmed.startsWith('*') &&
        !trimmed.startsWith('//') &&
        !trimmed.startsWith('/*')
      ) {
        found.push({
          name: prop[1]!,
          deprecated: /@deprecated/.test(comment),
        });
        comment = '';
        depth += open - close;
        continue;
      }
      if (
        trimmed.startsWith('*') ||
        trimmed.startsWith('//') ||
        trimmed.startsWith('/*') ||
        trimmed.endsWith('*/')
      ) {
        comment += `${line}\n`;
      } else if (trimmed !== '') {
        comment = '';
      }
    }
    depth += open - close;
    if (depth < 0) depth = 0;
  }
  return found;
}

function customMenuLabels(source: string): string[] {
  const start = source.indexOf('function buildAppMenu');
  const end = source.indexOf('\nfunction ', start + 1);
  const body = source.slice(start, end === -1 ? source.length : end);
  const standard = new Set(['File', 'Edit', 'View', 'Window']);
  return [...body.matchAll(/label:\s*'([^']+)'/g)]
    .map((hit) => hit[1]!)
    .filter((label) => !standard.has(label));
}

describe('docs coverage', () => {
  const docs = docsText();

  it('names every issue code in the source docs', () => {
    const domain = unionLiterals(read('src/domain/types.ts'), 'IssueCode');
    const contracts = unionLiterals(read('src/shared/contracts.ts'), 'IssueCode');
    expect(contracts).toEqual(domain);
    const missing = domain.filter((code) => !docs.includes(code));
    expect(missing).toEqual([]);
  });

  it('names every custom application-menu label in the source docs', () => {
    const labels = customMenuLabels(read('src/main/index.ts'));
    expect(labels.length).toBeGreaterThan(0);
    const missing = labels.filter((label) => !docs.includes(label));
    expect(missing).toEqual([]);
  });

  it('names every library and settings key that is not UI chrome', () => {
    const settings = read('src/main/settingsStore.ts');
    const keys = [
      ...propertyNames(sliceTypeBody(settings, 'export type LibraryConfig')),
      ...propertyNames(sliceTypeBody(settings, 'type Settings =')),
    ];
    expect(keys.length).toBeGreaterThan(20);
    const missing = [
      ...new Set(
        keys
          .filter((key) => !key.deprecated)
          .map((key) => key.name)
          .filter(
            (name) => !UNDOCUMENTED_SETTINGS_KEYS.has(name) && !docs.includes(name),
          ),
      ),
    ].sort();
    expect(missing).toEqual([]);
  });
});
