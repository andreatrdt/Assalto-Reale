import { randomBytes, randomInt } from "node:crypto";
import type {
  Clock,
  IdGenerator,
  SeedGenerator,
} from "@assalto-reale/authoritative-server";

// Concrete production implementations of the application-core ports. Identifiers
// satisfy the protocol id/invite formats; seeds are server-generated unsigned
// 32-bit values (client-supplied seeds are never used).

export class SystemClock implements Clock {
  now(): Date {
    return new Date();
  }
}

// Unambiguous uppercase invite alphabet (no O/0/I/1 confusion).
const INVITE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

export class CryptoIdGenerator implements IdGenerator {
  matchId(): string {
    return `match_${randomBytes(12).toString("hex")}`;
  }

  eventId(): string {
    return `event_${randomBytes(12).toString("hex")}`;
  }

  inviteCode(): string {
    let code = "";
    for (let index = 0; index < 8; index += 1) {
      code += INVITE_ALPHABET[randomInt(INVITE_ALPHABET.length)];
    }
    return code;
  }
}

export class CryptoSeedGenerator implements SeedGenerator {
  next(): number {
    // Unsigned 32-bit, matching the shared Mulberry32 seed contract.
    return randomInt(0, 0x1_0000_0000);
  }
}
