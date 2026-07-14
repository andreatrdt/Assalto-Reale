# Multiplayer protocol v2 validation

Phase B.7 defines the transport-independent protocol contract only. It does not introduce a server, database, authentication provider or network transport.

The protocol is accepted only when all repository gates remain green and the following protocol-specific guarantees are demonstrated:

- strict TypeScript compilation without DOM/browser libraries;
- JSON encode/decode round trips;
- runtime rejection of malformed envelopes, commands and events;
- compile-time compatibility between wire game commands and game-core commands;
- explicit Defended King and Transform decision messages;
- semantic Defended-King route selection with server-recomputed validation;
- optimistic match-version checks;
- ordered aggregate event streams;
- authentication credentials excluded from actor payloads;
- plain-Node package smoke test.

The pull-request CI is the authoritative validation of the published branch.
