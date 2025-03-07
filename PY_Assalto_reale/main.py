import pygame
import random
import time
import copy
import os

pygame.mixer.init()
CURRENT_DIR = os.path.dirname(__file__)
sound_path = os.path.join(CURRENT_DIR, "assets", "move_chess.wav")
move_sound = pygame.mixer.Sound(sound_path)


flash_effects = {}  # key: (row, col), value: time when flash started
FLASH_DURATION = 2.0  # total seconds of flashing
BLINK_INTERVAL = 0.3  # how fast it blinks on/off

# -----------------------------------------------------------------------------
# Updated Constants for a 12x12 board
# -----------------------------------------------------------------------------
WIDTH, HEIGHT = 800, 650  # Overall window size for visibility
ROWS, COLS = 12, 12       # Board dimensions: 12 rows x 12 columns
SQ_SIZE = WIDTH // (COLS + 4)  # Square size (with some extra margin for UI)
BUTTON_X, BUTTON_Y, BUTTON_W, BUTTON_H = WIDTH - 110, HEIGHT // 2 - 20, 100, 40
SCOREBOARD_X, SCOREBOARD_Y = BUTTON_X, BUTTON_Y - 70  # Scoreboard position
CAPTURE_COUNTER_X, CAPTURE_COUNTER_Y = WIDTH - 160, HEIGHT - 200  # Capture counter position 
TURN_X, TURN_Y, TURN_WIDTH, TURN_HIGHT = BUTTON_X+100, HEIGHT-400, 100, 40
PLACEMENT_ICON_X, PLACEMENT_ICON_Y = SCOREBOARD_X-90, SCOREBOARD_Y + 65
PLACEMENT_ICON_W, PLACEMENT_ICON_H = 100, 50

# For example, position the undo/redo window below the turn indicator in your right panel
UNDO_WINDOW_X = SCOREBOARD_X 
UNDO_WINDOW_Y = TURN_Y + TURN_HIGHT + 60
UNDO_WINDOW_W, UNDO_WINDOW_H = 100, 40

# Reset Button (to clear the board and return to placement phase)
RESET_BUTTON_X = SCOREBOARD_X
RESET_BUTTON_Y = UNDO_WINDOW_Y + UNDO_WINDOW_H - 200
RESET_BUTTON_W, RESET_BUTTON_H = 100, 40

# Quit Button (to exit the game)
QUIT_BUTTON_X = RESET_BUTTON_X
QUIT_BUTTON_Y = RESET_BUTTON_Y + RESET_BUTTON_H - 100
QUIT_BUTTON_W, QUIT_BUTTON_H = 100, 40

# -----------------------------------------------------------------------------
# Colors and Piece Definitions
# -----------------------------------------------------------------------------
WHITE = (255, 255, 255)
BLACK = (0, 0, 0)
LIGHT_BROWN = (222, 184, 135)
DARK_BROWN = (139, 69, 19)
GREEN = (61, 77, 48)  # Special squares color
HIGHLIGHT = (255, 165, 0)  # Selected piece highlight
RED_HIGHLIGHT = (255, 0, 0, 150)  # Possible capture highlight
GRAY = (99, 102, 106, 100)  # Valid move highlight (semi-transparent)
BUTTON_COLOR = (125, 125, 125)  # Button color

# Pieces available for each player
PIECE_ORDER = ["King"] + ["AttackPawn"] * 4 + ["DefensePawn"] * 4 + ["ConquestPawn"] * 4
PIECE_LABELS = {"AttackPawn": "A", "DefensePawn": "D", "ConquestPawn": "C", "King": "K"}

# -----------------------------------------------------------------------------
# Pygame Initialization
# -----------------------------------------------------------------------------
pygame.init()
screen = pygame.display.set_mode((WIDTH, HEIGHT))
pygame.display.set_caption("Assalto Reale")
clock = pygame.time.Clock()
font = pygame.font.SysFont("bookmanoldstyle", 20)

# -----------------------------------------------------------------------------
# Game State Variables
# -----------------------------------------------------------------------------
board = [[None for _ in range(COLS)] for _ in range(ROWS)]
special_squares = set()
controlled_squares = {"Black": set(), "White": set()}  # Tracks controlled special squares
selected_piece = None  # Currently selected piece
captured_pieces = {
    "Black": {"AttackPawn": 0, "DefensePawn": 0, "ConquestPawn": 0, "King": 0},
    "White": {"AttackPawn": 0, "DefensePawn": 0, "ConquestPawn": 0, "King": 0}
}
both_at_four = False
placing_pieces = True  # Whether we're in the placement phase
candidate_winner = None
move_history = []
redo_history = []
game_over = False  # Global flag to indicate game over, so that undo can restore state if needed
turn_counter = 0
candidate_turn_index = None


pieces_left = {
    "Black": {"AttackPawn": 4, "DefensePawn": 4, "ConquestPawn": 4, "King": 1},
    "White": {"AttackPawn": 4, "DefensePawn": 4, "ConquestPawn": 4, "King": 1}
}

players = ["Black", "White"]
current_player = 0  # 0 = Black, 1 = White
pieces_placed = {"Black": 0, "White": 0}
# Turn sequence: first turn 1 piece, then 24 turns of 2 pieces, then final turn 1 piece
turn_sequence = [1] + [2] * 12 + [1]  
turn_index = 0
turn_pieces_count = 0  # Number of pieces placed in the current turn
moves_this_turn = 0  # Number of moves made this turn

# -----------------------------------------------------------------------------
# Generation of Special Squares (Modified for 12x12 Board)
# -----------------------------------------------------------------------------
def generate_special_squares():
    attempts = 0
    # For a 12x12 board, choose rows and cols in a central range (e.g. from 2 to ROWS-3)
    while len(special_squares) < 5 and attempts < 100000:
        row = random.randint(1, ROWS - 2)
        col = random.randint(3, COLS - 4)
        # Ensure a minimum distance of 3 squares between special squares
        if all(max(abs(row - r), abs(col - c)) >= 3 for r, c in special_squares):
            special_squares.add((row, col))
        attempts += 1

generate_special_squares()

###############################################################################
#                        FUNZIONI PER REGOLARE LE CATTURE                     #
###############################################################################
def can_capture_shape(piece_moving, start, end):
    """
    Verifica la forma di cattura consentita dal tipo di pedone:
      - AttackPawn: linea retta (1 casella in orizzontale o verticale)
      - DefensePawn: diagonale di 1 casella
      - ConquestPawn: a 'L' (come un Cavallo)
      - Re o altri pezzi: di default non considerati per cattura speciale
    """
    mover_type = piece_moving["type"]
    row_s, col_s = start
    row_e, col_e = end
    
    delta_row = abs(row_e - row_s)
    delta_col = abs(col_e - col_s)

    if mover_type == "AttackPawn":
        # 1 casella in orizzontale (delta_row=0, delta_col=1)
        # o 1 casella in verticale (delta_row=1, delta_col=0)
        return (delta_row == 2 and delta_col == 0) or (delta_row == 0 and delta_col == 2)

    elif mover_type == "DefensePawn":
        # 1 casella in diagonale
        return (delta_row == 2 and delta_col == 2)

    elif mover_type == "ConquestPawn":
        # Movimento a L del Cavallo (2+1 o 1+2)
        return (delta_row == 2 and delta_col == 1) or (delta_row == 1 and delta_col == 2)

    # Se è il Re o altro, ritorna False di default (se seguiamo le regole standard)
    return False

def is_allowed_capture_type(piece_moving, piece_target):
    """
    Regole di compatibilità sulla cattura:
      - AttackPawn  -> cattura King e DefensePawn
      - DefensePawn -> cattura ConquestPawn
      - ConquestPawn-> cattura AttackPawn
    """
    mover_type = piece_moving["type"]
    target_type = piece_target["type"]

    if mover_type == "AttackPawn":
        return (target_type == "King" or target_type == "DefensePawn")
    elif mover_type == "DefensePawn":
        return (target_type == "ConquestPawn")
    elif mover_type == "ConquestPawn":
        return (target_type == "AttackPawn")
    
    return False

###############################################################################
#                   FUNZIONE PRINCIPALE DI VALIDAZIONE MOSSA                  #
###############################################################################
def is_valid_move(piece, start, end):
    row_start, col_start = start
    row_end, col_end = end

    # Check board bounds.
    if not (0 <= row_end < ROWS and 0 <= col_end < COLS):
        return False
    if (row_start, col_start) == (row_end, col_end):
        return False

    delta_row = abs(row_end - row_start)
    delta_col = abs(col_end - col_start)
    target_piece = board[row_end][col_end]

    # Capture move: enemy piece at destination.
    if target_piece and target_piece["player"] != piece["player"]:
        if piece["type"] == "AttackPawn":
            # Option 1: one-square capture (vertical or horizontal).
            if (delta_row, delta_col) in [(1, 0), (0, 1)]:
                return is_allowed_capture_type(piece, target_piece)
            # Option 2: two-square capture (jump).
            elif (delta_row, delta_col) in [(2, 0), (0, 2)]:
                if moves_this_turn != 0:
                    return False
                # If capturing the King, allow the jump even if the intermediate square is occupied.
                if target_piece["type"] == "King":
                    return is_allowed_capture_type(piece, target_piece)
                # For other pieces, ensure the intermediate square is empty.
                mid_row = (row_start + row_end) // 2
                mid_col = (col_start + col_end) // 2
                if board[mid_row][mid_col] is not None:
                    return False
                return is_allowed_capture_type(piece, target_piece)
            else:
                return False

        elif piece["type"] == "DefensePawn":
            # One-square diagonal capture.
            if (delta_row, delta_col) == (1, 1):
                return is_allowed_capture_type(piece, target_piece)
            # Two-square diagonal capture allowed only on first move.
            elif (delta_row, delta_col) == (2, 2):
                if moves_this_turn != 0:
                    return False
                return is_allowed_capture_type(piece, target_piece)
            else:
                return False

        elif piece["type"] == "ConquestPawn":
            # ConquestPawn captures only in L-shape and only if it is the first move.
            if (delta_row, delta_col) in [(2, 1), (1, 2)] and moves_this_turn == 0:
                return is_allowed_capture_type(piece, target_piece)
            else:
                return False
        else:
            return False
    else:
        # Normal (non-capture) move: destination must be empty.
        if target_piece:
            return False
        if max(delta_row, delta_col) <= 1:
            return True
        return False


###############################################################################
#                             DISEGNO DELLA SCACCHIERA                        #
###############################################################################
def sanitize_board():
    """Iterate over the board and set any invalid cell to None."""
    for i in range(ROWS):
        for j in range(COLS):
            cell = board[i][j]
            if cell is not None:
                # Check if cell is a dict with both required keys.
                if not (isinstance(cell, dict) and "player" in cell and "type" in cell):
                    board[i][j] = None

def draw_board():
    # First, sanitize the board.
    sanitize_board()
    
    screen.fill(GRAY)
    for row in range(ROWS):
        for col in range(COLS):
            base_color = LIGHT_BROWN if (row + col) % 2 == 0 else DARK_BROWN
            pygame.draw.rect(screen, base_color, (col * SQ_SIZE, row * SQ_SIZE, SQ_SIZE, SQ_SIZE))
    
    for (r, c) in special_squares:
        pygame.draw.circle(screen, GREEN, (c * SQ_SIZE + SQ_SIZE//2, r * SQ_SIZE + SQ_SIZE//2), SQ_SIZE//3 + 5)
    
    for row_idx in range(ROWS):
        for col_idx in range(COLS):
            cell = board[row_idx][col_idx]
            if cell:
                # At this point cell is expected to be a valid dict.
                piece = cell
                piece_color = BLACK if piece["player"] == "Black" else WHITE
                center_x = col_idx * SQ_SIZE + SQ_SIZE // 2
                center_y = row_idx * SQ_SIZE + SQ_SIZE // 2
                pygame.draw.circle(screen, piece_color, (center_x, center_y), SQ_SIZE // 3)
                label = PIECE_LABELS.get(piece["type"], "?")
                text_color = WHITE if piece["player"] == "Black" else BLACK
                text = font.render(label, True, text_color)
                text_rect = text.get_rect(center=(center_x, center_y))
                screen.blit(text, text_rect)

    now = time.time()
    for (r, c) in list(flash_effects.keys()):
        elapsed = now - flash_effects[(r, c)]
        if elapsed < FLASH_DURATION:
            blink_count = int(elapsed // BLINK_INTERVAL)
            overlay_color = (0, 255, 0, 120) if blink_count % 2 == 0 else (0, 255, 0, 0)
            overlay_surf = pygame.Surface((SQ_SIZE, SQ_SIZE), pygame.SRCALPHA)
            overlay_surf.fill(overlay_color)
            screen.blit(overlay_surf, (c * SQ_SIZE, r * SQ_SIZE))
        else:
            del flash_effects[(r, c)]

    if placing_pieces:
        piece_type = get_next_piece_type_for_player(players[current_player])
        if piece_type:
            overlay_color = (128, 128, 128, 100)
            for r in range(ROWS):
                for c in range(COLS):
                    if is_square_disallowed_for_placement(r, c, players[current_player], piece_type):
                        overlay_surf = pygame.Surface((SQ_SIZE, SQ_SIZE), pygame.SRCALPHA)
                        overlay_surf.fill(overlay_color)
                        screen.blit(overlay_surf, (c * SQ_SIZE, r * SQ_SIZE))

    if selected_piece:
        sr, sc = selected_piece
        piece = board[sr][sc]
        if piece:
            valid_moves = get_valid_moves(piece, selected_piece)
            for (r, c) in valid_moves:
                cx = c * SQ_SIZE + SQ_SIZE // 2
                cy = r * SQ_SIZE + SQ_SIZE // 2
                target_piece = board[r][c]
                if target_piece and target_piece["player"] != piece["player"]:
                    pygame.draw.circle(screen, (255, 0, 0, 80), (cx, cy), SQ_SIZE // 6)
                else:
                    pygame.draw.circle(screen, (128, 128, 128, 80), (cx, cy), SQ_SIZE // 6)

    # Draw row numbers on the right.
    for row in range(ROWS):
        label = font.render(str(ROWS - row), True, BLACK)
        x = 610  # Adjust as needed.
        y = row * SQ_SIZE + SQ_SIZE/2 - label.get_height()/2
        screen.blit(label, (x, y))
    
    # Draw column letters below the board.
    for col in range(COLS):
        letter = chr(ord('A') + col)
        label = font.render(letter, True, BLACK)
        x = col * SQ_SIZE + SQ_SIZE/2 - label.get_width()/2
        y = ROWS * SQ_SIZE + 5
        screen.blit(label, (x, y))


def get_valid_moves(piece, position):
    row, col = position
    valid_moves = []
    for r in range(ROWS):
        for c in range(COLS):
            if is_valid_move(piece, (row, col), (r, c)):
                valid_moves.append((r, c))
    return valid_moves

def is_square_disallowed_for_placement(row, col, player, piece_type):
    if not (0 <= row < ROWS and 0 <= col < COLS):
        return True
    if (row, col) in special_squares:
        return True
    if piece_type == "ConquestPawn":
        for (r_s, c_s) in special_squares:
            if max(abs(row - r_s), abs(col - c_s)) < 3:
                return True
    if piece_type == "AttackPawn":
        # For a 12x12 board, allow Black only in columns 0-2 and White only in columns 9-11.
        if player == "Black" and col >= 2:
            return True
        if player == "White" and col < (COLS - 2):
            return True
    return False
###############################################################################
#                           FASI DI PIAZZAMENTO INIZIALE                      #
###############################################################################

def get_next_piece_type_for_player(player):
    for p_type in PIECE_ORDER:
        if pieces_left[player][p_type] > 0:
            return p_type
    return None

def place_piece(pos):
    global current_player, turn_index, turn_pieces_count, placing_pieces
    col, row = pos[0] // SQ_SIZE, pos[1] // SQ_SIZE
    
    if not (0 <= row < ROWS and 0 <= col < COLS):
        return  # Out of board
    if board[row][col] is not None:
        return  # Occupied cell
    if (row, col) in special_squares:
        return  # Cannot place on a special square

    piece_type = next((p for p in PIECE_ORDER if pieces_left[players[current_player]][p] > 0), None)
    if piece_type:
        if piece_type == "ConquestPawn":
            for (r_s, c_s) in special_squares:
                distance = max(abs(row - r_s), abs(col - c_s))
                if distance < 3:
                    return

        if piece_type == "AttackPawn":
            if players[current_player] == "Black" and col >= 2:
                return
            if players[current_player] == "White" and col < (COLS - 2):
                return

        board[row][col] = {"type": piece_type, "player": players[current_player]}
        pieces_left[players[current_player]][piece_type] -= 1
        pieces_placed[players[current_player]] += 1
        turn_pieces_count += 1
        
        if turn_pieces_count >= turn_sequence[turn_index]:
            current_player = 1 - current_player
            if turn_index < len(turn_sequence) - 1:
                turn_index += 1
            turn_pieces_count = 0

        if sum(pieces_placed.values()) == 26:
            placing_pieces = False

candidate_winner = None

def check_special_squares():
    """
    Called whenever control of a special square might change.
    If a player first controls 3 special squares, they become the pending (candidate) winner.
    If both players reach 3, both_at_four mode is activated.
    """
    global candidate_winner, both_at_four, candidate_turn_index, turn_counter
    black_count = len(controlled_squares["Black"])
    white_count = len(controlled_squares["White"])

    if both_at_four:
        return

    if candidate_winner is None:
        if black_count >= 3 and white_count >= 3:
            both_at_four = True
        elif black_count >= 3:
            candidate_winner = "Black"
            candidate_turn_index = turn_counter  # Record the turn when candidate is set.
        elif white_count >= 3:
            candidate_winner = "White"
            candidate_turn_index = turn_counter
    else:
        # If both players eventually reach 3, enter both_at_four mode.
        if black_count >= 3 and white_count >= 3:
            both_at_four = True

def check_candidate_win():
    """
    Checks for a pending win condition.
    A candidate winner only wins if, after one full opponent turn (i.e. when turn_counter has increased
    by at least 2 relative to when they were set), they still control 3 special squares.
    Otherwise, the pending win is canceled.
    """
    global candidate_winner, candidate_turn_index, turn_counter
    # We wait until two turn increments have occurred:
    if candidate_winner is not None and (turn_counter - candidate_turn_index >= 2):  
        if len(controlled_squares[candidate_winner]) >= 3:
            flash_winner_king(candidate_winner,1)
        else:
            candidate_winner = None

def end_turn():
    global current_player, moves_this_turn, selected_piece, turn_counter
    current_player = 1 - current_player
    moves_this_turn = 0
    selected_piece = None
    turn_counter += 1
    # You can also call check_candidate_win() here if needed.
    check_candidate_win()  # If you have candidate win logic.

def flash_winner_king(winner,flag):
    """
    Finds the king belonging to 'winner' on the board and flashes it
    for a few seconds before closing the game.
    """
    king_pos = None
    # Search for the winner's king.
    for r in range(ROWS):
        for c in range(COLS):
            piece = board[r][c]
            if piece and piece.get("type") == "King" and piece.get("player") == winner:
                king_pos = (r, c)
                break
        if king_pos:
            break
    if king_pos is None:
        return
    if flag == 1:
        flash_duration = 3000
    else:
        flash_duration = 300  # duration in milliseconds (0.3 seconds)

    start_time = pygame.time.get_ticks()
    
    while pygame.time.get_ticks() - start_time < flash_duration:
        draw_everything()  # redraw board and UI elements
        r, c = king_pos
        # Create a flash overlay (yellow with pulsating alpha)
        flash_overlay = pygame.Surface((SQ_SIZE, SQ_SIZE), pygame.SRCALPHA)
        # Alpha will alternate every 100ms.
        alpha = 128 if ((pygame.time.get_ticks() - start_time) // 100) % 2 == 0 else 0
        if flag == 1:
            flash_overlay.fill((0, 255, 0, alpha))
        else: 
            flash_overlay.fill((255, 0, 0, alpha))
        screen.blit(flash_overlay, (c * SQ_SIZE, r * SQ_SIZE))
        pygame.display.flip()
        pygame.time.delay(50)
    


##########################################################
#                    stalemate                          #
##########################################################

def check_stalemate(player):
    """
    Returns True if 'player' has NO valid moves,
    else False.
    """
    for r in range(ROWS):
        for c in range(COLS):
            piece = board[r][c]
            if piece and piece["player"] == player:
                # Find valid moves for this piece
                valid = get_valid_moves(piece, (r, c))
                if valid:
                    return False  # Found at least one move
    return True  # No moves found for any piece

###############################################################################
#                              GESTIONE DEI CLICK                             #
###############################################################################
def handle_click(pos):
    global selected_piece, current_player, moves_this_turn, game_over

    mx, my = pos

    # --- 1. UI Buttons: Undo/Redo, PASS ---
    if (UNDO_WINDOW_X <= mx <= UNDO_WINDOW_X + UNDO_WINDOW_W and 
        UNDO_WINDOW_Y <= my <= UNDO_WINDOW_Y + UNDO_WINDOW_H):
        if mx < UNDO_WINDOW_X + UNDO_WINDOW_W / 2:
            undo_move()
        # (If you later implement redo, uncomment below)
        # else:
        #     redo_move()
        return

    if (BUTTON_X <= pos[0] <= BUTTON_X + BUTTON_W and 
        BUTTON_Y <= pos[1] <= BUTTON_Y + BUTTON_H):
        end_turn()
        return

    # --- 2. Placement Phase ---
    if placing_pieces:
        place_piece(pos)
        return

    # --- 3. Game Over Check ---
    if game_over:
        return

    # --- 4. Convert Click to Board Coordinates ---
    col = pos[0] // SQ_SIZE
    row = pos[1] // SQ_SIZE
    if not (0 <= row < ROWS and 0 <= col < COLS):
        return

    # --- 5. If a Piece is Selected, Try to Move/Capture ---
    if selected_piece is not None:
        start_pos = selected_piece
        piece = board[start_pos[0]][start_pos[1]]
        if piece and piece["player"] == players[current_player]:
            # If a ConquestPawn is leaving a special square, remove its control.
            if piece["type"] == "ConquestPawn" and start_pos in special_squares:
                if start_pos in controlled_squares[piece["player"]]:
                    controlled_squares[piece["player"]].remove(start_pos)

            if is_valid_move(piece, start_pos, (row, col)):
                target_piece = board[row][col]
                delta_row = abs(row - start_pos[0])
                delta_col = abs(col - start_pos[1])

                # --- Special Case: AttackPawn vs. King ---
                                # --- Special Case: AttackPawn vs. King ---
                if (piece["type"] == "AttackPawn" and target_piece and 
                    target_piece["type"] == "King" and (delta_row, delta_col) in [(1, 0), (0, 1), (2, 0), (0, 2)]):
                    defense_pos = get_defense_pawn_adjacent_to_king(row, col, target_piece["player"])
                    if defense_pos is not None:
                        # Repulsion branch: animate repulsion and remove the defending pawn.
                        # (Removed flash_winner_king call from this branch.)
                        path = repulse_attack_pawn_path(start_pos, (row, col))
                        for pos_step in path[1:]:
                            board[start_pos[0]][start_pos[1]] = None
                            board[pos_step[0]][pos_step[1]] = piece
                            draw_everything()
                            pygame.display.flip()
                            pygame.time.delay(200)  # Delay between steps
                            start_pos = pos_step  # Update for next step
                        new_pos = path[-1]
                        def_r, def_c = defense_pos
                        captured = {"defense": (board[def_r][def_c].copy(), (def_r, def_c))}
                        board[def_r][def_c] = None
                        record_move(selected_piece, new_pos, piece, captured)
                        moves_this_turn = 2  # Consumes both moves.
                        end_turn()  # This now switches the turn.
                        return
                    else:
                        # Sacrifice branch: no defender available.
                        captured = {"king": target_piece}
                        prev_snapshot = copy.deepcopy(board)
                        board[start_pos[0]][start_pos[1]] = None
                        board[row][col] = None
                        new_snapshot = copy.deepcopy(board)
                        record_move_sacrifice(selected_piece, (row, col), piece, captured, prev_snapshot, new_snapshot)
                        moves_this_turn = 2
                        game_over = True
                        flash_winner_king(piece["player"], 1)
                        end_turn()  # End the turn even in the sacrifice branch.
                        return
                else:
                    # --- Normal Move / Capture Branch ---
                    if target_piece and target_piece["player"] != piece["player"]:
                        captured = target_piece.copy()
                        if target_piece["type"] == "ConquestPawn":
                            if (row, col) in controlled_squares[target_piece["player"]]:
                                controlled_squares[target_piece["player"]].remove((row, col))
                        captured_pieces[players[current_player]][target_piece["type"]] += 1
                        board[row][col] = None
                        record_move(selected_piece, (row, col), piece, captured)
                    else:
                        record_move(selected_piece, (row, col), piece, None)

                    board[row][col] = piece
                    board[start_pos[0]][start_pos[1]] = None
                    if piece["type"] == "ConquestPawn" and (row, col) in special_squares:
                        controlled_squares[piece["player"]].add((row, col))
                        check_special_squares()
                        flash_effects[(row, col)] = time.time()
                    
                    # After a normal move, if the move consumed all moves (moves_this_turn == 0), complete the turn.
                    if moves_this_turn == 0:
                        complete_turn()
                    
                    selected_piece = None
                    return
            else:
                selected_piece = None
        else:
            selected_piece = None
    else:
        # --- 6. No Piece Selected: Attempt to Select a Friendly Piece ---
        if board[row][col] and board[row][col]["player"] == players[current_player]:
            selected_piece = (row, col)
        else:
            selected_piece = None

def complete_turn():
    global turn_counter, selected_piece
    # Do any additional tasks that should happen when a turn is completed.
    selected_piece = None
    turn_counter += 1
    check_candidate_win()
    # (Optional) If using both_at_four mode, you can add additional win-checking logic here.

###############################################################################
#                              RESET GAME                                     #
###############################################################################

def reset_game():
    global board, pieces_left, pieces_placed, placing_pieces, move_history, redo_history, turn_index, turn_pieces_count, moves_this_turn, current_player, controlled_squares, captured_pieces, selected_piece
    # Clear the board.
    board = [[None for _ in range(COLS)] for _ in range(ROWS)]
    # Reset piece counts for each player.
    pieces_left = {
        "Black": {"AttackPawn": 4, "DefensePawn": 4, "ConquestPawn": 4, "King": 1},
        "White": {"AttackPawn": 4, "DefensePawn": 4, "ConquestPawn": 4, "King": 1}
    }
    pieces_placed = {"Black": 0, "White": 0}
    placing_pieces = True

    # Reset turn data.
    turn_index = 0
    turn_pieces_count = 0
    moves_this_turn = 0
    current_player = 0  # Assume Black starts

    # Clear move histories.
    move_history.clear()
    redo_history.clear()

    # Clear controlled special squares and captured pieces.
    controlled_squares = {"Black": set(), "White": set()}
    captured_pieces = {
        "Black": {"AttackPawn": 0, "DefensePawn": 0, "ConquestPawn": 0, "King": 0},
        "White": {"AttackPawn": 0, "DefensePawn": 0, "ConquestPawn": 0, "King": 0}
    }

    # Clear selected piece.
    selected_piece = None


###############################################################################
#                              DISEGNO INTERFACCIA                            #
###############################################################################

def draw_everything():
    draw_board()
    draw_turn()
    draw_button()
    draw_scoreboard()
    draw_capture_counter()
    draw_placement_icon()
    draw_undo_window()
    draw_reset_button()
    draw_quit_button()
    pygame.display.flip()

def draw_reset_button():
    pygame.draw.rect(screen, BUTTON_COLOR, (RESET_BUTTON_X, RESET_BUTTON_Y, RESET_BUTTON_W, RESET_BUTTON_H))
    pygame.draw.rect(screen, BLACK, (RESET_BUTTON_X, RESET_BUTTON_Y, RESET_BUTTON_W, RESET_BUTTON_H), 2)
    text = font.render("Reset", True, WHITE)
    text_x = RESET_BUTTON_X + (RESET_BUTTON_W - text.get_width()) // 2
    text_y = RESET_BUTTON_Y + (RESET_BUTTON_H - text.get_height()) // 2
    screen.blit(text, (text_x, text_y))

def draw_quit_button():
    pygame.draw.rect(screen, BUTTON_COLOR, (QUIT_BUTTON_X, QUIT_BUTTON_Y, QUIT_BUTTON_W, QUIT_BUTTON_H))
    pygame.draw.rect(screen, BLACK, (QUIT_BUTTON_X, QUIT_BUTTON_Y, QUIT_BUTTON_W, QUIT_BUTTON_H), 2)
    text = font.render("Quit", True, WHITE)
    text_x = QUIT_BUTTON_X + (QUIT_BUTTON_W - text.get_width()) // 2
    text_y = QUIT_BUTTON_Y + (QUIT_BUTTON_H - text.get_height()) // 2
    screen.blit(text, (text_x, text_y))

def draw_turn():
    if current_player == 0:
        pygame.draw.circle(screen, BLACK, (SCOREBOARD_X-40, SCOREBOARD_Y+30), 20)
    else:
        pygame.draw.circle(screen, WHITE, (SCOREBOARD_X-40, SCOREBOARD_Y+30), 20)

def draw_button():
    pygame.draw.rect(screen, BUTTON_COLOR, (BUTTON_X, BUTTON_Y, BUTTON_W, BUTTON_H))
    pygame.draw.rect(screen, BLACK, (BUTTON_X, BUTTON_Y, BUTTON_W, BUTTON_H), 2)
    text = font.render("PASS", True, WHITE)
    screen.blit(text, (BUTTON_X + 20, BUTTON_Y + 10))

def draw_scoreboard():
    pygame.draw.rect(screen, BLACK, (SCOREBOARD_X, SCOREBOARD_Y, BUTTON_W, 60), 2)
    pygame.draw.rect(screen, WHITE, (SCOREBOARD_X, SCOREBOARD_Y, BUTTON_W, 30))
    pygame.draw.rect(screen, BLACK, (SCOREBOARD_X, SCOREBOARD_Y, BUTTON_W, 30))
    text_black = font.render(f"Black: {len(controlled_squares['Black'])}", True, WHITE)
    text_white = font.render(f"White: {len(controlled_squares['White'])}", True, BLACK)
    screen.blit(text_black, (SCOREBOARD_X + 10, SCOREBOARD_Y + 5))
    screen.blit(text_white, (SCOREBOARD_X + 10, SCOREBOARD_Y + 30))

def draw_capture_counter():
    pygame.draw.rect(screen, GRAY, (CAPTURE_COUNTER_X, CAPTURE_COUNTER_Y, 200, 100))
    y_offset = 5
    for player, data in captured_pieces.items():
        for piece_type, count in data.items():
            for i in range(count):
                piece_color = BLACK if player == "White" else WHITE
                pygame.draw.circle(screen, piece_color,
                                   (CAPTURE_COUNTER_X + 20 + i * 25, CAPTURE_COUNTER_Y + y_offset + 10), 10)
                text = font.render(PIECE_LABELS[piece_type], True, WHITE if player == "White" else BLACK)
                text_rect = text.get_rect(center=(CAPTURE_COUNTER_X + 20 + i * 25, CAPTURE_COUNTER_Y + y_offset + 10))
                screen.blit(text, text_rect)
            y_offset += 25

def draw_placement_icon():
    if placing_pieces:
        next_piece_type = get_next_piece_type_for_player(players[current_player])
        if next_piece_type is not None:
            # Determine center and radius for the icon
            center_x = PLACEMENT_ICON_X + PLACEMENT_ICON_W // 2
            center_y = PLACEMENT_ICON_Y + PLACEMENT_ICON_H // 2
            radius = min(PLACEMENT_ICON_W, PLACEMENT_ICON_H) // 2 - 5

            # Set the piece color and contrasting text color based on the current player
            if players[current_player] == "Black":
                piece_color = BLACK
                label_color = WHITE
            else:
                piece_color = WHITE
                label_color = BLACK

            # Draw the circle (icon)
            pygame.draw.circle(screen, piece_color, (center_x, center_y), radius)

            # Draw the letter (icon label) in the center of the circle
            label = font.render(PIECE_LABELS[next_piece_type], True, label_color)
            label_rect = label.get_rect(center=(center_x, center_y))
            screen.blit(label, label_rect)

def draw_undo_window():
    # Draw a background rectangle for the undo window
    pygame.draw.rect(screen, GRAY, (UNDO_WINDOW_X, UNDO_WINDOW_Y, UNDO_WINDOW_W/2-5, UNDO_WINDOW_H))
    pygame.draw.rect(screen, BLACK, (UNDO_WINDOW_X, UNDO_WINDOW_Y, UNDO_WINDOW_W/2-5, UNDO_WINDOW_H), 2)
    
    # Draw left arrow (for undo)
    left_arrow = [
        (UNDO_WINDOW_X + 10, UNDO_WINDOW_Y + UNDO_WINDOW_H // 2),
        (UNDO_WINDOW_X + 30, UNDO_WINDOW_Y + 10),
        (UNDO_WINDOW_X + 30, UNDO_WINDOW_Y + UNDO_WINDOW_H - 10)
    ]
    pygame.draw.polygon(screen, BLACK, left_arrow)
    
    # # Draw right arrow (for redo)
    # right_arrow = [
    #     (UNDO_WINDOW_X + UNDO_WINDOW_W - 10, UNDO_WINDOW_Y + UNDO_WINDOW_H // 2),
    #     (UNDO_WINDOW_X + UNDO_WINDOW_W - 30, UNDO_WINDOW_Y + 10),
    #     (UNDO_WINDOW_X + UNDO_WINDOW_W - 30, UNDO_WINDOW_Y + UNDO_WINDOW_H - 10)
    # ]
    # pygame.draw.polygon(screen, BLACK, right_arrow)


#############################################################
#                       KING CAPTURE                        #
#############################################################
def get_defense_pawn_adjacent_to_king(king_row, king_col, king_player):
    """
    Restituisce la posizione (r, c) di un DefensePawn adiacente al Re 
    dello stesso colore (king_player), oppure None se non c'è.
    """
    directions = [
        (-1, 0), (1, 0), (0, -1), (0, 1),
        (-1, -1), (-1, 1), (1, -1), (1, 1)
    ]
    for dr, dc in directions:
        rr = king_row + dr
        cc = king_col + dc
        if 0 <= rr < ROWS and 0 <= cc < COLS:
            piece_def = board[rr][cc]
            if piece_def and piece_def["type"] == "DefensePawn" and piece_def["player"] == king_player:
                return (rr, cc)
    return None

def rotate_direction_clockwise(dr, dc):
    """
    Ruota la direzione (dr, dc) di 90° in senso orario:
    (1,0)->(0,1), (0,1)->(-1,0), ecc.
    """
    return (-dc, dr)

def in_bounds(pos):
    r, c = pos
    return 0 <= r < ROWS and 0 <= c < COLS

def score(pos):
    # Score is the distance from the closest board edge.
    r, c = pos
    return min(r, ROWS - 1 - r, c, COLS - 1 - c)

def rotate_direction_clockwise(dr, dc):
    # Standard clockwise rotation: (dr, dc) -> (-dc, dr)
    return (-dc, dr)

def rotate_direction_counterclockwise(dr, dc):
    # Counterclockwise rotation: (dr, dc) -> (dc, -dr)
    return (dc, -dr)

def repulse_attack_pawn_path(start_pos, king_pos, steps=5):
    """
    Returns a list of board positions representing the repulsion path.
    Normally the pawn moves one square in the repulsion direction.
    However, if the next square is occupied, it counts how many consecutive 
    squares are occupied and jumps over the entire block (landing in the first empty cell).
    Each time a jump is needed, it checks if the landing cell is within boundaries 
    and empty; if not, it attempts to rotate the direction.
    """
    path = [start_pos]
    curr_r, curr_c = start_pos
    rK, cK = king_pos

    # Compute unit vector from king to pawn.
    dr = curr_r - rK
    dc = curr_c - cK
    if dr != 0:
        dr //= abs(dr)
    if dc != 0:
        dc //= abs(dc)
    
    for _ in range(steps):
        # Compute the next cell in the repulsion direction.
        next_r = curr_r + dr
        next_c = curr_c + dc
        
        # If next cell is off-board, try alternatives (rotate).
        if not in_bounds((next_r, next_c)):
            candidates = []
            cw_dr, cw_dc = rotate_direction_clockwise(dr, dc)
            if in_bounds((curr_r + cw_dr, curr_c + cw_dc)):
                candidates.append((cw_dr, cw_dc))
            ccw_dr, ccw_dc = rotate_direction_counterclockwise(dr, dc)
            if in_bounds((curr_r + ccw_dr, curr_c + ccw_dc)):
                candidates.append((ccw_dr, ccw_dc))
            if candidates:
                best = max(candidates, key=lambda d: score((curr_r + d[0], curr_c + d[1])))
                dr, dc = best[0], best[1]
                next_r = curr_r + dr
                next_c = curr_c + dc
            else:
                break  # No valid alternative.
        
        # If the next cell is empty, simply move one square.
        if board[next_r][next_c] is None:
            curr_r, curr_c = next_r, next_c
            path.append((curr_r, curr_c))
        else:
            # Otherwise, count how many consecutive cells are occupied.
            count = 0
            temp_r, temp_c = next_r, next_c
            while in_bounds((temp_r, temp_c)) and board[temp_r][temp_c] is not None:
                count += 1
                temp_r += dr
                temp_c += dc
            # Landing cell is one square after the contiguous block.
            landing_r = curr_r + (count + 1) * dr
            landing_c = curr_c + (count + 1) * dc

            # Check if landing cell is in bounds and empty.
            if (not in_bounds((landing_r, landing_c))) or board[landing_r][landing_c] is not None:
                # Try alternative directions for the jump.
                candidates = []
                cw_dr, cw_dc = rotate_direction_clockwise(dr, dc)
                alt_r = curr_r + (count + 1) * cw_dr
                alt_c = curr_c + (count + 1) * cw_dc
                if in_bounds((alt_r, alt_c)) and board[alt_r][alt_c] is None:
                    candidates.append((cw_dr, cw_dc, (alt_r, alt_c)))
                ccw_dr, ccw_dc = rotate_direction_counterclockwise(dr, dc)
                alt_r2 = curr_r + (count + 1) * ccw_dr
                alt_c2 = curr_c + (count + 1) * ccw_dc
                if in_bounds((alt_r2, alt_c2)) and board[alt_r2][alt_c2] is None:
                    candidates.append((ccw_dr, ccw_dc, (alt_r2, alt_c2)))
                if candidates:
                    best = max(candidates, key=lambda item: score(item[2]))
                    dr, dc = best[0], best[1]
                    landing_r, landing_c = best[2]
                else:
                    break  # Cannot find an alternative landing cell.
            # Update current position to landing cell.
            curr_r, curr_c = landing_r, landing_c
            path.append((curr_r, curr_c))
        # End of this step.
    return path

###############################################################################
#                              UNDO/REDO                                      #
###############################################################################

def record_move(start_pos, end_pos, moved_piece, captured_piece):
    global current_player, moves_this_turn
    prev_state = {
        'current_player': current_player,
        'moves_this_turn': moves_this_turn,
        'controlled': {
            'Black': controlled_squares["Black"].copy(),
            'White': controlled_squares["White"].copy()
        }
    }
    delta = max(abs(end_pos[0] - start_pos[0]), abs(end_pos[1] - start_pos[1]))
    
    # Riproduci il suono in base al tipo di mossa
    # Play sound based on move type.
    if captured_piece is not None:
        move_sound.play()  # Sound for capture
        move_cost = 2
    else:
        move_sound.play()     # Sound for normal move
        move_cost = 1
    
    new_moves = moves_this_turn + move_cost
    if new_moves >= 2:
        # If the move cost meets or exceeds 2, the turn is complete.
        new_state = {'current_player': 1 - current_player, 'moves_this_turn': 0}
    else:
        new_state = {'current_player': current_player, 'moves_this_turn': new_moves}
    
    move_history.append({
         'from': start_pos,
         'to': end_pos,
         'piece': moved_piece.copy(),
         'captured': captured_piece.copy() if captured_piece is not None else None,
         'prev_state': prev_state,
         'new_state': new_state,
         'prev_special': prev_state['controlled'],
         'new_special': {
             'Black': controlled_squares["Black"].copy(),
             'White': controlled_squares["White"].copy()
         }
    })
    redo_history.clear()
    # Update global state based on the move.
    current_player = new_state['current_player']
    moves_this_turn = new_state['moves_this_turn']

def record_move_sacrifice(start_pos, end_pos, moved_piece, captured_info, prev_snapshot, new_snapshot):
    global current_player, moves_this_turn
    prev_state = {
         'current_player': current_player,
         'moves_this_turn': moves_this_turn,
         'board_snapshot': prev_snapshot,
         'controlled': {
             'Black': controlled_squares["Black"].copy(),
             'White': controlled_squares["White"].copy()
         }
    }
    new_state = {
         'current_player': 1 - current_player,
         'moves_this_turn': 0,
         'board_snapshot': new_snapshot,
         'controlled': {
             'Black': controlled_squares["Black"].copy(),
             'White': controlled_squares["White"].copy()
         }
    }
    move_history.append({
         'from': start_pos,
         'to': end_pos,
         'piece': moved_piece.copy(),
         'captured': captured_info,  # e.g. {"king": king_piece}
         'sacrifice': True,          # Flag to indicate a sacrifice move
         'captured': captured_info,
         'sacrifice': True,
         'prev_state': prev_state,
         'new_state': new_state
    })
    redo_history.clear()
    current_player = new_state['current_player']
    moves_this_turn = new_state['moves_this_turn']

def undo_move():
    global moves_this_turn, current_player, board, controlled_squares, game_over
    if not move_history:
        return
    last_move = move_history.pop()
    redo_history.append(last_move)
    if last_move.get('sacrifice'):
        board = copy.deepcopy(last_move['prev_state']['board_snapshot'])
        controlled_squares["Black"] = last_move['prev_state']['controlled']["Black"].copy()
        controlled_squares["White"] = last_move['prev_state']['controlled']["White"].copy()
    else:
        from_pos = last_move['from']
        to_pos = last_move['to']
        moved_piece = last_move['piece']
        captured_piece = last_move['captured']
        board[to_pos[0]][to_pos[1]] = None
        board[from_pos[0]][from_pos[1]] = moved_piece
        if captured_piece:
            # If captured_piece is a dict with key "defense", restore it to its original position.
            if isinstance(captured_piece, dict) and "defense" in captured_piece:
                def_data, def_pos = captured_piece["defense"]
                board[def_pos[0]][def_pos[1]] = def_data
            else:
                board[to_pos[0]][to_pos[1]] = captured_piece
        controlled_squares["Black"] = last_move['prev_state']['controlled']["Black"].copy()
        controlled_squares["White"] = last_move['prev_state']['controlled']["White"].copy()
    prev_state = last_move['prev_state']
    current_player = prev_state['current_player']
    moves_this_turn = prev_state['moves_this_turn']
    game_over = False

# def recalc_conquest_control():
#     """
#     Recalculate controlled special squares from the current board.
#     For each special square, if it is occupied by a ConquestPawn,
#     add that square to that player's control.
#     """
#     # Clear old data
#     controlled_squares["Black"].clear()
#     controlled_squares["White"].clear()
    
#     for (r, c) in special_squares:
#         piece = board[r][c]
#         if piece and piece["type"] == "ConquestPawn":
#             controlled_squares[piece["player"]].add((r, c))

# def recount_all_captures():
#     """
#     Recalculate the captured pieces counts by comparing the board
#     with the original totals. (This requires you to know how many pieces
#     each player started with.) For example, if Black started with 4 AttackPawns
#     and now there are 2 on the board, then 2 have been captured.
#     """
#     # For simplicity, assume pieces_left holds the original totals.
#     remaining_black = {"AttackPawn": 0, "DefensePawn": 0, "ConquestPawn": 0, "King": 0}
#     remaining_white = {"AttackPawn": 0, "DefensePawn": 0, "ConquestPawn": 0, "King": 0}
    
#     for r in range(ROWS):
#         for c in range(COLS):
#             piece = board[r][c]
#             if piece:
#                 if piece["player"] == "Black":
#                     remaining_black[piece["type"]] += 1
#                 else:
#                     remaining_white[piece["type"]] += 1
                    
#     for ptype in ["AttackPawn", "DefensePawn", "ConquestPawn", "King"]:
#         # The difference between the original total and the remaining pieces is the number captured.
#         captured_pieces["Black"][ptype] = pieces_left["Black"][ptype] - remaining_black[ptype]
#         captured_pieces["White"][ptype] = pieces_left["White"][ptype] - remaining_white[ptype]

###############################################################################
#                              LOOP PRINCIPALE                                #
###############################################################################
running = True
while running:
    for event in pygame.event.get():
        if event.type == pygame.QUIT:
            running = False
        elif event.type == pygame.MOUSEBUTTONDOWN:
            mx, my = event.pos
            if (UNDO_WINDOW_X <= mx <= UNDO_WINDOW_X + UNDO_WINDOW_W and 
                UNDO_WINDOW_Y <= my <= UNDO_WINDOW_Y + UNDO_WINDOW_H):
                if mx < UNDO_WINDOW_X + UNDO_WINDOW_W / 2:
                    undo_move()
                #else:
                    #redo_move()
            elif (RESET_BUTTON_X <= mx <= RESET_BUTTON_X + RESET_BUTTON_W and 
                  RESET_BUTTON_Y <= my <= RESET_BUTTON_Y + RESET_BUTTON_H):
                reset_game()
            elif (QUIT_BUTTON_X <= mx <= QUIT_BUTTON_X + QUIT_BUTTON_W and 
                  QUIT_BUTTON_Y <= my <= QUIT_BUTTON_Y + QUIT_BUTTON_H):
                pygame.quit()
                exit()
            else:
                handle_click(event.pos)
    
    draw_everything()
    clock.tick(30)