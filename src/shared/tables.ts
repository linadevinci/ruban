export const SYNCED_TABLES = [
  'settings', 'dayLogs', 'weights', 'calorieEntries', 'runs', 'weekPlans', 'cycles',
] as const;

export type SyncedTableName = (typeof SYNCED_TABLES)[number];
