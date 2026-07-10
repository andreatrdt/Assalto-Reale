export * from "./actions.js";
export * from "./board.js";
export * from "./config.js";
export * from "./defendedKing.js";
export * from "./placement.js";
export * from "./serialization.js";
export * from "./specialSquares.js";
export * from "./territory.js";
export * from "./transform.js";
export * from "./types.js";
export * from "./victory.js";

// Canonical match command API (createMatch / applyCommand / getLegalActions /
// advanceTurn / checkVictory / resolveDefendedKing / resolveTransform) plus its
// types, setup primitives and JSON codecs. These are part of the package's
// public surface and are consumed by the web app and the authoritative server.
export * from "./matchTypes.js";
export * from "./matchSetup.js";
export * from "./match.js";
export * from "./matchSerialization.js";
