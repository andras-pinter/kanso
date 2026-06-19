export interface PrebuildResult {
  cached: boolean;
  outFile: string;
  hash: string;
}

export function prebuildEditorIfNeeded(opts?: { force?: boolean }): Promise<PrebuildResult>;
