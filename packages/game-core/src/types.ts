export type Player = "Black" | "White";
export type PawnType = "AttackPawn" | "DefensePawn" | "ConquestPawn";
export type PieceType = PawnType | "King";
export type Vec2 = readonly [number, number];
export type PieceId = string;

export interface GameConfig {
  rows: number;
  cols: number;
  specialCount: number;
  transformEnabled: boolean;
  transformRound: number;
}

export interface Piece {
  player: Player;
  type: PieceType;
}

export type Grid = Array<Array<Piece | null>>;

export interface TerritoryClaim {
  claimant: Player;
  createdTurn: number;
  matureTurn: number;
}

export interface SpecialControl {
  controlled: Record<Player, Vec2[]>;
  requiredMajority: number;
  claim: TerritoryClaim | null;
}

export interface VictoryResult {
  winner: Player;
  reason: "king_capture" | "territory" | "timeout";
  loser?: Player | null;
}

export interface DefendedKingPreview {
  attackerId: PieceId;
  kingId: PieceId;
  attackerOrigin: Vec2;
  kingPosition: Vec2;
  attackDirection: Vec2;
  bounceDirection: Vec2;
  attackPath: Vec2[];
  bouncePath: Vec2[];
  landingPosition: Vec2;
  eligibleDefenderIds: PieceId[];
  triggersTransform: boolean;
  actionCost: number;
  endsTurn: boolean;
}

export type ActionKind = "move" | "capture" | "pass" | "transform" | "invalid";

export interface Action {
  kind: ActionKind;
  player: Player | "";
  start?: Vec2;
  end?: Vec2;
  cost: number;
  capture: boolean;
  capturedPlayer?: Player;
  capturedPieceType?: PieceType;
  targetPieceType?: PieceType;
  defendedKing?: DefendedKingPreview | null;
  selectedDefender?: Vec2 | null;
  endsTurn: boolean;
  error?: string | null;
}

export interface TransitionEvent {
  kind: "move" | "capture" | "pass" | "defended_king" | "bounce" | "transform_available" | "transform";
  data: Record<string, unknown>;
}

export interface TransitionResult {
  action: Action;
  events: TransitionEvent[];
  victory: VictoryResult | null;
  specialControl: SpecialControl | null;
  error?: string | null;
  endsTurn: boolean;
  nextMovesThisTurn: number;
  nextKingMoved: boolean;
}

export interface PlacementResult {
  ok: boolean;
  reason?: string;
}

export interface BoardState {
  config: GameConfig;
  grid: Grid;
  specialSquares: Vec2[];
  transformSquares: Vec2[];
  controlledSquares: Record<Player, Vec2[]>;
  capturedPieces: Record<Player, Record<PieceType, number>>;
  territoryClaim: TerritoryClaim | null;
}
