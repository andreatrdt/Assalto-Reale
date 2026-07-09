// Pure builder for the deployed release-metadata.json. Kept side-effect-free so
// it can be unit-tested. The commit must be the *tested* source commit: in a
// workflow_run deploy, GITHUB_SHA points at the default branch, so the workflow
// passes the tested head SHA via SOURCE_COMMIT, which takes precedence here.
export function buildReleaseMetadata(env = {}, { version, now = () => new Date() } = {}) {
  const commit = env.SOURCE_COMMIT || env.GITHUB_SHA || "unknown";
  return {
    repository: env.GITHUB_REPOSITORY || "andreatrdt/Assalto-Reale",
    commit,
    builtAt: now().toISOString(),
    version: version || "0.0.0",
    application: "Assalto Reale React web client",
  };
}
