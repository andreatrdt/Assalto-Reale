export function buildReleaseMetadata(
  env?: Record<string, string | undefined>,
  options?: { version?: string; now?: () => Date },
): {
  repository: string;
  commit: string;
  builtAt: string;
  version: string;
  application: string;
};
