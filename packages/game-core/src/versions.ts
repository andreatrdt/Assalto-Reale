export const CURRENT_GAME_RULES_VERSION = 2 as const;
/** Backward-compatible public name retained for existing replay consumers. */
export const GAME_RULES_VERSION = CURRENT_GAME_RULES_VERSION;
export const REPLAY_SCHEMA_VERSION = 2 as const;
export const SUPPORTED_GAME_RULES_VERSIONS = [1, 2] as const;
export const SUPPORTED_REPLAY_SCHEMA_VERSIONS = [1, 2] as const;
