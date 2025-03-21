**Assalto Reale**

Assalto Reale is a strategic, turn-based board game designed for 2 to 4 players. This repository contains the complete source code and assets for the game implementation using Python and Pygame.

**Game Objective**

The primary goal of the game is to strategically control special squares, eliminate opposing pieces, and ultimately dominate the board by either capturing the opponent's King or controlling special areas of the board.

**Game Components**

A square board of either 12x12 (for 2-player mode) or 18x18 (for 4-player mode).

Special squares marked distinctively on the board.

**Pieces for each player:**

> King (1 per player)

> Attack Pawns (4 per player)

> Defense Pawns (4 per player)

> Conquest Pawns (4 per player)

**Game Modes**

2 Players: Compete one-on-one.

4 Players: Free-for-all battle involving four players.

2 vs 2: Team-based gameplay.

**Setup**

Each player starts by placing their pieces strategically according to the game's placement rules.

Special squares are randomly generated on the board at the beginning of the game.

**Gameplay Rules**

Players take turns to move their pieces. Each turn, a player can make up to two moves.

Pieces have unique movement and capturing abilities:

> King: Central piece; must be protected from capture.

> Attack Pawn: Specialized in capturing enemy pieces and attacking opposing Kings.

> Defense Pawn: Protects other pieces, especially Kings.

> Conquest Pawn: Controls and captures special squares.

Capture enemy pieces by moving onto their occupied square.

Special squares can be controlled using Conquest Pawns, granting strategic advantages.

Capturing the opposing player's King or controlling designated special squares results in victory.

**Controls**

Click on a piece to select it.

Click on a valid destination square to move the selected piece.

**UI buttons:**

PASS: Ends your turn.

UNDO: Reverts the last move.

RESET: Restarts the placement phase.

QUIT: Exits the game.

**Assets and Sounds**

All game piece images and sounds are stored in the assets/ folder.

vRunning the Game**

Make sure Python and Pygame are installed. Execute the game with:

python joint_main.py

**Contributions**

Andrea Berti

Enjoy playing Assalto Reale!

