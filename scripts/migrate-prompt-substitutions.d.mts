export function migrateFromSettingsFile(settingsFile: string): {
  updated: number;
  already: number;
  missing: number;
  skippedRoot: number;
  absent: boolean;
};
