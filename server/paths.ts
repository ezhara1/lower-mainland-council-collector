import path from "node:path";

export const appDir = path.resolve(process.env.COLLECTOR_APP_DIR ?? process.cwd());
export const dataDir = path.resolve(
  process.env.COLLECTOR_DATA_DIR ?? path.join(appDir, ".data"),
);

export const appPath = (...segments: string[]) => path.join(appDir, ...segments);
export const dataPath = (...segments: string[]) => path.join(dataDir, ...segments);
