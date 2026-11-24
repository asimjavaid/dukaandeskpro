export function migrate(dbPath?: string): {
  dbPath: string;
  applied: string[];
  skipped: string[];
};
export function resolveDbPath(explicit?: string): string;
export const MIGRATIONS_DIR: string;
export const pg: {
  isPgMode(): boolean;
  resolvePgUrl(dbPath?: string): string;
  migratePg(dbPath?: string): { dbPath: string; applied: string[]; skipped: string[]; engine: 'postgres' };
  openDatabase(target?: string, opts?: { readonly?: boolean; fileMustExist?: boolean }): any;
  dbNameForPath(p: string): string;
  PG_MIGRATIONS_DIR: string;
};
