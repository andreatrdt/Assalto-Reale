import { describe, expect, it } from "vitest";
import fixtures from "../../../tests/fixtures/python-engine-fixtures.json";
import { mulberry32 } from "./random";
import { fromPythonSnapshot, type PythonBoardSnapshot } from "./serialization";
import { generateSpecialSquares } from "./specialSquares";
import { generateTransformSquare } from "./transform";

// Cross-runtime parity for the shared Mulberry32 PRNG (docs/rules-parity-contract.md).
// The fixtures are produced by the Python reference engine; here the TypeScript
// engine must reproduce them byte-for-byte. This is the proof that seeded
// Special/Transform Square generation is now engine-identical.

describe("shared PRNG parity (Python reference vs TypeScript)", () => {
  it.each(fixtures.prng.map((c) => c.seed))("mulberry32(%d) reproduces the Python sequence", (seed) => {
    const expected = fixtures.prng.find((c) => c.seed === seed)!.values;
    const rng = mulberry32(seed);
    const actual = expected.map(() => rng());
    expect(actual).toEqual(expected);
  });

  it.each(fixtures.special_generation.map((c) => c.name))("special square generation matches Python for %s", (name) => {
    const fixture = fixtures.special_generation.find((c) => c.name === name)!;
    const board = fromPythonSnapshot(fixture.initial as unknown as PythonBoardSnapshot);
    const generated = generateSpecialSquares(board.config, fixture.count, fixture.seed);
    expect(generated).toEqual(fixture.squares);
  });

  it.each(fixtures.transform_generation.map((c) => c.name))("transform square selection matches Python for %s", (name) => {
    const fixture = fixtures.transform_generation.find((c) => c.name === name)!;
    const board = fromPythonSnapshot(fixture.initial as unknown as PythonBoardSnapshot);
    const generated = generateTransformSquare(board, fixture.seed);
    expect(generated).toBe(fixture.generated);
    const square = board.transformSquares.length > 0 ? board.transformSquares[0] : null;
    expect(square).toEqual(fixture.square);
  });
});
