import { createBoard, createPiece, getPiece, setPiece, toPythonSnapshot } from "../../packages/game-core/dist/index.js";

const board = createBoard();
setPiece(board, [0, 0], createPiece("King", "Black"));

const piece = getPiece(board, [0, 0]);
const snapshot = toPythonSnapshot(board);

if (piece?.player !== "Black" || piece.type !== "King" || snapshot.grid[0][0]?.player !== "Black") {
  throw new Error("game-core Node smoke check failed");
}

console.log("game-core Node smoke check passed");
