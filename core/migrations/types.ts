import type { Annotation } from "../types.ts";

export interface StateFile {
  version?: number;
  annotations: Record<string, Annotation>;
}

export interface Migration {
  version: number;
  description: string;
  migrate: (state: StateFile) => StateFile | Promise<StateFile>;
}
