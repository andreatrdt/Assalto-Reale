# joint_main.py

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


# DIMENSIONS
WIDTH, HEIGHT = 1000, 812  # Overall window size for visibility
ROWS, COLS = 12, 12       # Board dimensions: 12 rows x 12 columns
SQ_SIZE = WIDTH // (COLS + 4)  # Square size (with some extra margin for UI)

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
RED = (203, 32, 39)  # Red color for invalid moves
BLUE = (32, 39, 203)  # Blue color for valid moves

# Load images for BLACK
black_attack_image   = pygame.image.load(os.path.join(CURRENT_DIR, "assets", "black_attack_pawn.png"))
black_defense_image  = pygame.image.load(os.path.join(CURRENT_DIR, "assets", "black_defense_pawn.png"))
black_conquest_image = pygame.image.load(os.path.join(CURRENT_DIR, "assets", "black_conquest_pawn.png"))
black_king_image     = pygame.image.load(os.path.join(CURRENT_DIR, "assets", "black_king.png"))

# Load images for WHITE
white_attack_image   = pygame.image.load(os.path.join(CURRENT_DIR, "assets", "white_attack_pawn.png"))
white_defense_image  = pygame.image.load(os.path.join(CURRENT_DIR, "assets", "white_defense_pawn.png"))
white_conquest_image = pygame.image.load(os.path.join(CURRENT_DIR, "assets", "white_conquest_pawn.png"))
white_king_image     = pygame.image.load(os.path.join(CURRENT_DIR, "assets", "white_king.png"))

# Load images for Red
red_attack_image   = pygame.image.load(os.path.join(CURRENT_DIR, "assets", "red_attack_pawn.png"))
red_defense_image  = pygame.image.load(os.path.join(CURRENT_DIR, "assets", "red_defense_pawn.png"))
red_conquest_image = pygame.image.load(os.path.join(CURRENT_DIR, "assets", "red_conquest_pawn.png"))
red_king_image     = pygame.image.load(os.path.join(CURRENT_DIR, "assets", "red_king.png"))

# Load images for Blue similarly...
blue_attack_image   = pygame.image.load(os.path.join(CURRENT_DIR, "assets", "blue_attack_pawn.png"))
blue_defense_image  = pygame.image.load(os.path.join(CURRENT_DIR, "assets", "blue_defense_pawn.png"))
blue_conquest_image = pygame.image.load(os.path.join(CURRENT_DIR, "assets", "blue_conquest_pawn.png"))
blue_king_image     = pygame.image.load(os.path.join(CURRENT_DIR, "assets", "blue_king.png"))

# If necessary, resize them to fit your square size SQ_SIZE
# For example, to make them half the square size:
black_attack_image   = pygame.transform.scale(black_attack_image,   (2*SQ_SIZE//3, 2*SQ_SIZE//3))
black_defense_image  = pygame.transform.scale(black_defense_image,  (2*SQ_SIZE//3, 2*SQ_SIZE//3))
black_conquest_image = pygame.transform.scale(black_conquest_image, (2*SQ_SIZE//3, 2*SQ_SIZE//3))
black_king_image     = pygame.transform.scale(black_king_image,     (2*SQ_SIZE//3, 2*SQ_SIZE//3))

white_attack_image   = pygame.transform.scale(white_attack_image,   (2*SQ_SIZE//3, 2*SQ_SIZE//3))
white_defense_image  = pygame.transform.scale(white_defense_image,  (2*SQ_SIZE//3, 2*SQ_SIZE//3))
white_conquest_image = pygame.transform.scale(white_conquest_image, (2*SQ_SIZE//3, 2*SQ_SIZE//3))
white_king_image     = pygame.transform.scale(white_king_image,     (2*SQ_SIZE//3, 2*SQ_SIZE//3))

# Scale them similar to others
red_attack_image   = pygame.transform.scale(red_attack_image,   (2*SQ_SIZE//3, 2*SQ_SIZE//3))
red_defense_image  = pygame.transform.scale(red_defense_image,  (2*SQ_SIZE//3, 2*SQ_SIZE//3))
red_conquest_image = pygame.transform.scale(red_conquest_image, (2*SQ_SIZE//3, 2*SQ_SIZE//3))
red_king_image     = pygame.transform.scale(red_king_image,     (2*SQ_SIZE//3, 2*SQ_SIZE//3))

# Scale them similar to others
blue_attack_image   = pygame.transform.scale(blue_attack_image,   (2*SQ_SIZE//3, 2*SQ_SIZE//3))
blue_defense_image  = pygame.transform.scale(blue_defense_image,  (2*SQ_SIZE//3, 2*SQ_SIZE//3))
blue_conquest_image = pygame.transform.scale(blue_conquest_image, (2*SQ_SIZE//3, 2*SQ_SIZE//3))
blue_king_image     = pygame.transform.scale(blue_king_image,     (2*SQ_SIZE//3, 2*SQ_SIZE//3))



# Create a dictionary for easy lookup
PIECE_IMAGES = {
    "Black": {
        "AttackPawn": black_attack_image,
        "DefensePawn": black_defense_image,
        "ConquestPawn": black_conquest_image,
        "King": black_king_image
    },
    "White": {
        "AttackPawn": white_attack_image,
        "DefensePawn": white_defense_image,
        "ConquestPawn": white_conquest_image,
        "King": white_king_image
    },
    "Red": {
        "AttackPawn": red_attack_image,
        "DefensePawn": red_defense_image,
        "ConquestPawn": red_conquest_image,
        "King": red_king_image
    },
    "Blue": {
        "AttackPawn": blue_attack_image,
        "DefensePawn": blue_defense_image,
        "ConquestPawn": blue_conquest_image,
        "King": blue_king_image
    }

}

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

selected_piece = None  # Currently selected piece

both_at_four = False
placing_pieces = True  # Whether we're in the placement phase
candidate_winner = None
move_history = []
redo_history = []
game_over = False  # Global flag to indicate game over, so that undo can restore state if needed
turn_counter = 0
candidate_turn_index = None


turn_index = 0
turn_pieces_count = 0  # Number of pieces placed in the current turn
moves_this_turn = 0  # Number of moves made this turn


def auto_place_pieces_2P():
    global board, pieces_left, pieces_placed, placing_pieces
    # Loop over the two players: "Black" and "White"
    for player in players:  # players = ["Black", "White"]
        for piece_type in PIECE_ORDER:
            # While there are still pieces of this type for the player:
            while pieces_left[player][piece_type] > 0:
                valid_positions = []
                for r in range(ROWS):
                    for c in range(COLS):
                        # Only consider empty cells that are not special squares.
                        if board[r][c] is None and (r, c) not in special_squares:
                            # Use your existing placement validation.
                            if not is_square_disallowed_for_placement(r, c, player, piece_type):
                                valid_positions.append((r, c))
                if valid_positions:
                    pos = random.choice(valid_positions)
                    board[pos[0]][pos[1]] = {"type": piece_type, "player": player}
                    pieces_left[player][piece_type] -= 1
                    pieces_placed[player] += 1
                else:
                    # Should not happen if board design is correct.
                    break
    # End the placement phase.
    placing_pieces = False

def auto_place_pieces_4P():
    global board, pieces_left, pieces_placed, placing_pieces
    # Loop over the four players: "Black", "White", "Red", "Blue"
    for player in players:  # players = ["Black", "White", "Red", "Blue"]
        for piece_type in PIECE_ORDER:
            while pieces_left[player][piece_type] > 0:
                valid_positions = []
                for r in range(ROWS):
                    for c in range(COLS):
                        if board[r][c] is None and (r, c) not in special_squares:
                            if not is_square_disallowed_for_placement(r, c, player, piece_type):
                                valid_positions.append((r, c))
                if valid_positions:
                    pos = random.choice(valid_positions)
                    board[pos[0]][pos[1]] = {"type": piece_type, "player": player}
                    pieces_left[player][piece_type] -= 1
                    pieces_placed[player] += 1
                else:
                    break
    placing_pieces = False

def main_menu():
    # Ensure pygame is initialized and screen, font, and constants (WIDTH, HEIGHT, BUTTON_COLOR, WHITE) are defined.
    menu_running = True
    clock = pygame.time.Clock()

    # Define button rectangles for mode selection.
    twoP_button = pygame.Rect(WIDTH // 2 - 100, HEIGHT // 2 - 60, 200, 50)
    fourP_button = pygame.Rect(WIDTH // 2 - 100, HEIGHT // 2 + 10, 200, 50)
    two_vs_two_button = pygame.Rect(WIDTH // 2 - 100, HEIGHT // 2 + 80, 200, 50)

    while menu_running:
        for event in pygame.event.get():
            if event.type == pygame.QUIT:
                pygame.quit()
                exit()
            elif event.type == pygame.MOUSEBUTTONDOWN:
                mouse_pos = event.pos
                if twoP_button.collidepoint(mouse_pos):
                    return "2P"
                elif fourP_button.collidepoint(mouse_pos):
                    return "4P"
                elif two_vs_two_button.collidepoint(mouse_pos):
                    return "2v2"

        # Draw menu background
        screen.fill((30, 30, 30))  # Dark gray background

        # Draw title text
        title_text = font.render("Select Game Mode", True, WHITE)
        title_rect = title_text.get_rect(center=(WIDTH // 2, HEIGHT // 2 - 150))
        screen.blit(title_text, title_rect)

        # Draw buttons
        pygame.draw.rect(screen, BUTTON_COLOR, twoP_button)
        pygame.draw.rect(screen, BUTTON_COLOR, fourP_button)
        pygame.draw.rect(screen, BUTTON_COLOR, two_vs_two_button)

        # Draw button labels
        twoP_label = font.render("2 Player", True, WHITE)
        twoP_label_rect = twoP_label.get_rect(center=twoP_button.center)
        screen.blit(twoP_label, twoP_label_rect)

        fourP_label = font.render("4 Player", True, WHITE)
        fourP_label_rect = fourP_label.get_rect(center=fourP_button.center)
        screen.blit(fourP_label, fourP_label_rect)

        two_vs_two_label = font.render("2 vs 2", True, WHITE)
        two_vs_two_label_rect = two_vs_two_label.get_rect(center=two_vs_two_button.center)
        screen.blit(two_vs_two_label, two_vs_two_label_rect)

        pygame.display.flip()
        clock.tick(60)


mode = main_menu()  # Get the game mode from the main menu

AUTO_PLACEMENT = True

if mode == "2P":
    WIDTH, HEIGHT = 1000, 812  # Overall window size for visibility
    ROWS, COLS = 12, 12       # Board dimensions: 12 rows x 12 columns
    SQ_SIZE = WIDTH // (COLS + 4)  # Square size (with some extra margin for UI)
    BUTTON_X, BUTTON_Y, BUTTON_W, BUTTON_H = WIDTH - 140, HEIGHT // 2 - 25, 125, 50
    SCOREBOARD_X, SCOREBOARD_Y = BUTTON_X, BUTTON_Y - 88  # Scoreboard position
    CAPTURE_COUNTER_X, CAPTURE_COUNTER_Y = WIDTH - 200, HEIGHT - 312  # Capture counter position 
    TURN_X, TURN_Y, TURN_WIDTH, TURN_HIGHT = BUTTON_X+125, HEIGHT-500, 125, 50

    PLACEMENT_ICON_X, PLACEMENT_ICON_Y = SCOREBOARD_X-113, SCOREBOARD_Y + 82
    PLACEMENT_ICON_W, PLACEMENT_ICON_H = 125, 63

    # For example, position the undo/redo window below the turn indicator in your right panel
    UNDO_WINDOW_X = SCOREBOARD_X 
    UNDO_WINDOW_Y = TURN_Y + TURN_HIGHT + 75
    UNDO_WINDOW_W, UNDO_WINDOW_H = 125, 50

    # Reset Button (to clear the board and return to placement phase)
    RESET_BUTTON_X = SCOREBOARD_X
    RESET_BUTTON_Y = UNDO_WINDOW_Y + UNDO_WINDOW_H - 250
    RESET_BUTTON_W, RESET_BUTTON_H = 125, 50

    # Quit Button (to exit the game)
    QUIT_BUTTON_X = RESET_BUTTON_X
    QUIT_BUTTON_Y = RESET_BUTTON_Y + RESET_BUTTON_H - 125
    QUIT_BUTTON_W, QUIT_BUTTON_H = 125, 50

    screen = pygame.display.set_mode((WIDTH, HEIGHT))
    pygame.display.set_caption("Assalto Reale")
    clock = pygame.time.Clock()
    font = pygame.font.SysFont("bookmanoldstyle", 20)
    captured_pieces = {
    "Black": {"AttackPawn": 0, "DefensePawn": 0, "ConquestPawn": 0, "King": 0},
    "White": {"AttackPawn": 0, "DefensePawn": 0, "ConquestPawn": 0, "King": 0}
    }
    pieces_left = {
    "Black": {"AttackPawn": 4, "DefensePawn": 4, "ConquestPawn": 4, "King": 1},
    "White": {"AttackPawn": 4, "DefensePawn": 4, "ConquestPawn": 4, "King": 1}
    }

    special_squares = set()

    players = ["Black", "White"]
    current_player = 0  # 0 = Black, 1 = White
    pieces_placed = {"Black": 0, "White": 0}
    special_squares = set()
    controlled_squares = {"Black": set(), "White": set()}  # Tracks controlled special squares
    turn_sequence = [1] + [2] * 12 + [1]  

    # if AUTO_PLACEMENT:
    #     auto_place_pieces_2P()


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
        if piece_type == "King":
            if player == "Black" and col >= COLS / 2:
                return True
            if player == "White" and col < COLS / 2:
                return True
        return False
    
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
                
            if piece_type == "King":
                if players[current_player] == "Black" and col >= COLS / 2:
                    return
                if players[current_player] == "White" and col < COLS / 2:
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
    
    def end_turn():
        global current_player, moves_this_turn, selected_piece, turn_counter
        current_player = 1 - current_player
        moves_this_turn = 0
        selected_piece = None
        turn_counter += 1
        # You can also call check_candidate_win() here if needed.
        check_candidate_win()  # If you have candidate win logic.
    
    def handle_click(pos):
        global selected_piece, current_player, moves_this_turn, game_over

        mx, my = pos

        # --- 1. UI Buttons: Undo/Redo, PASS ---
        if (UNDO_WINDOW_X <= mx <= UNDO_WINDOW_X + UNDO_WINDOW_W and 
            UNDO_WINDOW_Y <= my <= UNDO_WINDOW_Y + UNDO_WINDOW_H):
            undo_move()
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
            if (UNDO_WINDOW_X <= mx <= UNDO_WINDOW_X + UNDO_WINDOW_W and 
                UNDO_WINDOW_Y <= my <= UNDO_WINDOW_Y + UNDO_WINDOW_H):
                undo_move()
            # Also check if click is on the QUIT button.
            elif (QUIT_BUTTON_X <= mx <= QUIT_BUTTON_X + QUIT_BUTTON_W and 
                QUIT_BUTTON_Y <= my <= QUIT_BUTTON_Y + QUIT_BUTTON_H):
                pygame.quit()
                exit()
            # Ignore all other clicks.
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
                    if (piece["type"] == "AttackPawn" and target_piece and 
                        target_piece["type"] == "King" and (delta_row, delta_col) in [(1, 0), (0, 1), (2, 0), (0, 2)]):
                        defense_pos = get_defense_pawn_adjacent_to_king(row, col, target_piece["player"])
                        if defense_pos is not None:
                            # Repulsion branch: animate repulsion and remove the defending pawn.
                            path = repulse_attack_pawn_path(start_pos, (row, col))
                            for pos_step in path[1:]:
                                board[start_pos[0]][start_pos[1]] = None
                                board[pos_step[0]][pos_step[1]] = piece
                                draw_everything()
                                pygame.display.flip()
                                pygame.time.delay(200)
                                start_pos = pos_step
                            new_pos = path[-1]
                            def_r, def_c = defense_pos
                            captured = {"defense": (board[def_r][def_c].copy(), (def_r, def_c))}
                            board[def_r][def_c] = None
                            record_move(selected_piece, new_pos, piece, captured)
                            # Update the captured counter for the defense pawn.
                            captured_pieces[players[current_player]]["DefensePawn"] += 1
                            return
                        else:
                            # Sacrifice branch: no defender available.
                            captured = {"king": target_piece}
                            prev_snapshot = copy.deepcopy(board)
                            board[start_pos[0]][start_pos[1]] = None
                            board[row][col] = None
                            new_snapshot = copy.deepcopy(board)
                            record_move_sacrifice(selected_piece, (row, col), piece, captured, prev_snapshot, new_snapshot)
                            moves_this_turn = 0
                            game_over = True
                            flash_winner_king(piece["player"], 1)
                            end_turn()
                            return
                    else:
                        # --- Normal Move / Capture Branch ---
                        if target_piece and target_piece["player"] != piece["player"]:
                            captured = target_piece.copy()
                            # Record the move before modifying the control and captured counters.
                            record_move(selected_piece, (row, col), piece, captured)
                            # If the target is a ConquestPawn on a special square, remove its control.
                            if target_piece["type"] == "ConquestPawn":
                                if (row, col) in controlled_squares[target_piece["player"]]:
                                    controlled_squares[target_piece["player"]].remove((row, col))
                            # Then update the captured counter for the target piece.
                            captured_pieces[players[current_player]][target_piece["type"]] += 1
                            board[row][col] = None
                        else:
                            record_move(selected_piece, (row, col), piece, None)

                        board[row][col] = piece
                        board[start_pos[0]][start_pos[1]] = None
                        if piece["type"] == "ConquestPawn" and (row, col) in special_squares:
                            controlled_squares[piece["player"]].add((row, col))
                            check_special_squares()
                            flash_effects[(row, col)] = time.time()
                        
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

    def draw_board():
        # First, sanitize the board.
        sanitize_board()
        
        # Fill the background.
        screen.fill(GRAY)
        
        # Draw board squares.
        for row in range(ROWS):
            for col in range(COLS):
                base_color = LIGHT_BROWN if (row + col) % 2 == 0 else DARK_BROWN
                pygame.draw.rect(screen, base_color, (col * SQ_SIZE, row * SQ_SIZE, SQ_SIZE, SQ_SIZE))
        
        # Draw special squares (if any).
        for (r, c) in special_squares:
            pygame.draw.circle(screen, GREEN, (c * SQ_SIZE + SQ_SIZE // 2, r * SQ_SIZE + SQ_SIZE // 2), SQ_SIZE // 3 + 5)
        
        # Draw pieces using custom icons.
        # Assumes PIECE_IMAGES is a dict structured as:
        # PIECE_IMAGES = { "Black": { "AttackPawn": surface, "DefensePawn": surface, ... },
        #                  "White": { "AttackPawn": surface, "DefensePawn": surface, ... } }
        for row_idx in range(ROWS):
            for col_idx in range(COLS):
                cell = board[row_idx][col_idx]
                if cell:
                    piece = cell
                    # Retrieve the corresponding image.
                    piece_image = PIECE_IMAGES[piece["player"]][piece["type"]]
                    piece_rect = piece_image.get_rect()
                    # Center the image in the square.
                    piece_rect.center = (col_idx * SQ_SIZE + SQ_SIZE // 2,
                                        row_idx * SQ_SIZE + SQ_SIZE // 2)
                    screen.blit(piece_image, piece_rect)
        
        # Handle flash effects (for moves, win indication, etc.).
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
        
        # During placement phase, overlay forbidden squares.
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
        
        # If a piece is selected, show its valid moves.
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
        
        # Draw row numbers on the right side.
        for row in range(ROWS):
            label = font.render(str(ROWS - row), True, BLACK)
            x = 750  # Adjust as needed.
            y = row * SQ_SIZE + SQ_SIZE / 2 - label.get_height() / 2
            screen.blit(label, (x, y))
        
        # Draw column letters below the board.
        for col in range(COLS):
            letter = chr(ord('A') + col)
            label = font.render(letter, True, BLACK)
            x = col * SQ_SIZE + SQ_SIZE / 2 - label.get_width() / 2
            y = ROWS * SQ_SIZE + 5
            screen.blit(label, (x, y))

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
        text = font.render("RESET", True, WHITE)
        text_x = RESET_BUTTON_X + (RESET_BUTTON_W - text.get_width()) // 2
        text_y = RESET_BUTTON_Y + (RESET_BUTTON_H - text.get_height()) // 2
        screen.blit(text, (text_x, text_y))

    def draw_quit_button():
        pygame.draw.rect(screen, BUTTON_COLOR, (QUIT_BUTTON_X, QUIT_BUTTON_Y, QUIT_BUTTON_W, QUIT_BUTTON_H))
        pygame.draw.rect(screen, BLACK, (QUIT_BUTTON_X, QUIT_BUTTON_Y, QUIT_BUTTON_W, QUIT_BUTTON_H), 2)
        text = font.render("QUIT", True, WHITE)
        text_x = QUIT_BUTTON_X + (QUIT_BUTTON_W - text.get_width()) // 2
        text_y = QUIT_BUTTON_Y + (QUIT_BUTTON_H - text.get_height()) // 2
        screen.blit(text, (text_x, text_y))

    def draw_turn():
        if current_player == 0:
            pygame.draw.circle(screen, BLACK, (SCOREBOARD_X-50, SCOREBOARD_Y+38), 25)
        else:
            pygame.draw.circle(screen, WHITE, (SCOREBOARD_X-50, SCOREBOARD_Y+38), 25)

    def draw_button():
        pygame.draw.rect(screen, BUTTON_COLOR, (BUTTON_X, BUTTON_Y, BUTTON_W, BUTTON_H))
        pygame.draw.rect(screen, BLACK, (BUTTON_X, BUTTON_Y, BUTTON_W, BUTTON_H), 2)
        text = font.render("PASS", True, WHITE)
        screen.blit(text, (BUTTON_X + 25, BUTTON_Y + 13))

    def draw_scoreboard():
        pygame.draw.rect(screen, BLACK, (SCOREBOARD_X, SCOREBOARD_Y, BUTTON_W, 75), 2)
        pygame.draw.rect(screen, WHITE, (SCOREBOARD_X, SCOREBOARD_Y, BUTTON_W, 38))
        pygame.draw.rect(screen, BLACK, (SCOREBOARD_X, SCOREBOARD_Y, BUTTON_W, 38))
        text_black = font.render(f"Black: {len(controlled_squares['Black'])}", True, WHITE)
        text_white = font.render(f"White: {len(controlled_squares['White'])}", True, BLACK)
        screen.blit(text_black, (SCOREBOARD_X + 13, SCOREBOARD_Y + 7))
        screen.blit(text_white, (SCOREBOARD_X + 13, SCOREBOARD_Y + 38))

    def draw_capture_counter():
        # Check if any captured pieces exist.
        any_captured = any(
            captured_pieces[player][ptype] > 0 
            for player in ["Black", "White"] 
            for ptype in captured_pieces[player]
        )
        if not any_captured:
            return  # Do not draw the capture counter if no pieces have been captured.
        
        # Set the capture counter dimensions.
        counter_width = 250
        counter_height = 256  # Enough space to display 4 rows in each half.
        
        # Clear the area by drawing a background rectangle.
        pygame.draw.rect(screen, GRAY, (CAPTURE_COUNTER_X, CAPTURE_COUNTER_Y, counter_width, counter_height))
        
        # Draw a horizontal divider to separate the two groups.
        divider_y = CAPTURE_COUNTER_Y + counter_height // 2
        
        # Use a fixed order for piece types.
        piece_order = ["King", "AttackPawn", "DefensePawn", "ConquestPawn"]
        
        # Layout parameters.
        row_height = (counter_height // 2) // 4  # Each half divided into 4 rows.
        icon_size = 25     # Each icon will be scaled to 20x20.
        icon_spacing = 7   # Horizontal spacing between icons.
        
        # --- Top Half: Captured Black pieces (i.e. Black pieces captured by White) ---
        y_top = CAPTURE_COUNTER_Y + 7
        for i, p_type in enumerate(piece_order):
            x = CAPTURE_COUNTER_X + 7
            count = captured_pieces["Black"][p_type]
            for _ in range(count):
                icon = PIECE_IMAGES["Black"][p_type]
                small_icon = pygame.transform.scale(icon, (icon_size, icon_size))
                screen.blit(small_icon, (x, y_top + i * row_height))
                x += icon_size + icon_spacing

        # --- Bottom Half: Captured White pieces (i.e. White pieces captured by Black) ---
        y_bottom = divider_y # +5
        for i, p_type in enumerate(piece_order):
            x = CAPTURE_COUNTER_X + 7
            count = captured_pieces["White"][p_type]
            for _ in range(count):
                icon = PIECE_IMAGES["White"][p_type]
                small_icon = pygame.transform.scale(icon, (icon_size, icon_size))
                screen.blit(small_icon, (x, y_bottom + i * row_height))
                x += icon_size + icon_spacing

    def draw_placement_icon():
        if placing_pieces:
            next_piece_type = get_next_piece_type_for_player(players[current_player])
            if next_piece_type is not None:
                # Retrieve the PNG icon for the next piece from the current player's images.
                piece_icon = PIECE_IMAGES[players[current_player]][next_piece_type]
                # Scale the icon to fit within the placement icon area (with a small margin).
                icon_width = PLACEMENT_ICON_W - 75
                icon_height = PLACEMENT_ICON_H - 13
                scaled_icon = pygame.transform.scale(piece_icon, (icon_width, icon_height))
                # Center the icon in the designated placement area.
                icon_x = PLACEMENT_ICON_X + (PLACEMENT_ICON_W - icon_width) // 2
                icon_y = PLACEMENT_ICON_Y + (PLACEMENT_ICON_H - icon_height) // 2
                screen.blit(scaled_icon, (icon_x, icon_y))

    def draw_undo_window():
        # Draw a background rectangle for the undo window
        pygame.draw.rect(screen, GRAY, (UNDO_WINDOW_X, UNDO_WINDOW_Y, UNDO_WINDOW_W/2-7, UNDO_WINDOW_H))
        pygame.draw.rect(screen, BLACK, (UNDO_WINDOW_X, UNDO_WINDOW_Y, UNDO_WINDOW_W/2-7, UNDO_WINDOW_H), 2)
        
        # Draw left arrow (for undo)
        left_arrow = [
            (UNDO_WINDOW_X + 13, UNDO_WINDOW_Y + UNDO_WINDOW_H // 2),
            (UNDO_WINDOW_X + 38, UNDO_WINDOW_Y + 13),
            (UNDO_WINDOW_X + 38, UNDO_WINDOW_Y + UNDO_WINDOW_H - 13)
        ]
        pygame.draw.polygon(screen, BLACK, left_arrow)
        
        # # Draw right arrow (for redo)
        # right_arrow = [
        #     (UNDO_WINDOW_X + UNDO_WINDOW_W - 10, UNDO_WINDOW_Y + UNDO_WINDOW_H // 2),
        #     (UNDO_WINDOW_X + UNDO_WINDOW_W - 30, UNDO_WINDOW_Y + 10),
        #     (UNDO_WINDOW_X + UNDO_WINDOW_W - 30, UNDO_WINDOW_Y + UNDO_WINDOW_H - 10)
        # ]
        # pygame.draw.polygon(screen, BLACK, right_arrow)

    def record_move(start_pos, end_pos, moved_piece, captured_piece):
        global current_player, moves_this_turn
        prev_state = {
            'current_player': current_player,
            'moves_this_turn': moves_this_turn,
            'controlled': {
                'Black': controlled_squares["Black"].copy(),
                'White': controlled_squares["White"].copy()
            },
            'captured': {
                'Black': captured_pieces["Black"].copy(),
                'White': captured_pieces["White"].copy()
            },
            # Save the special square win state as well.
            'candidate_winner': candidate_winner,
            'both_at_four': both_at_four
        }
        delta = max(abs(end_pos[0] - start_pos[0]), abs(end_pos[1] - start_pos[1]))
        move_sound.play()  # Play move sound.
        
        # For capture moves: cost 1 if adjacent (delta==1) and 2 if jump (delta==2)
        if captured_piece is not None:
            move_cost = 1 if delta == 1 else 2
        else:
            move_cost = 1

        new_moves = moves_this_turn + move_cost
        if new_moves >= 2:
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
        global moves_this_turn, current_player, board, controlled_squares, captured_pieces, candidate_winner, both_at_four, game_over
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
        # Restore captured pieces from the previous state.
        captured_pieces["Black"] = last_move['prev_state']['captured']["Black"].copy()
        captured_pieces["White"] = last_move['prev_state']['captured']["White"].copy()
        # Restore special square win state.
        candidate_winner = last_move['prev_state'].get('candidate_winner', None)
        both_at_four = last_move['prev_state'].get('both_at_four', False)
        
        prev_state = last_move['prev_state']
        current_player = prev_state['current_player']
        moves_this_turn = prev_state['moves_this_turn']
        game_over = False
elif mode == "4P":
    WIDTH, HEIGHT = 1000, 812  # Overall window size for visibility
    ROWS, COLS = 18,18       # Board dimensions:  rows x columns
    SQ_SIZE = WIDTH // (COLS + 4)  # Square size (with some extra margin for UI)
    BUTTON_X, BUTTON_Y, BUTTON_W, BUTTON_H = WIDTH - 140, HEIGHT // 2 - 25, 125, 50
    SCOREBOARD_X, SCOREBOARD_Y = BUTTON_X, BUTTON_Y - 88  # Scoreboard position
    CAPTURE_COUNTER_X, CAPTURE_COUNTER_Y = WIDTH - 200, HEIGHT - 312  # Capture counter position 
    TURN_X, TURN_Y, TURN_WIDTH, TURN_HIGHT = BUTTON_X+125, HEIGHT-500, 125, 50

    PLACEMENT_ICON_X, PLACEMENT_ICON_Y = SCOREBOARD_X, SCOREBOARD_Y - 200
    PLACEMENT_ICON_W, PLACEMENT_ICON_H = 125, 63

    # For example, position the undo/redo window below the turn indicator in your right panel
    UNDO_WINDOW_X = SCOREBOARD_X 
    UNDO_WINDOW_Y = TURN_Y + TURN_HIGHT + 75
    UNDO_WINDOW_W, UNDO_WINDOW_H = 125, 50

    # Reset Button (to clear the board and return to placement phase)
    RESET_BUTTON_X = SCOREBOARD_X
    RESET_BUTTON_Y = UNDO_WINDOW_Y + UNDO_WINDOW_H - 250
    RESET_BUTTON_W, RESET_BUTTON_H = 125, 50

    # Quit Button (to exit the game)
    QUIT_BUTTON_X = SCOREBOARD_X
    QUIT_BUTTON_Y = UNDO_WINDOW_Y + UNDO_WINDOW_H - 300
    QUIT_BUTTON_W, QUIT_BUTTON_H = 125, 50

    screen = pygame.display.set_mode((WIDTH, HEIGHT))
    pygame.display.set_caption("Assalto Reale")
    clock = pygame.time.Clock()
    font = pygame.font.SysFont("bookmanoldstyle", 20)
    board = [[None for _ in range(COLS)] for _ in range(ROWS)]

    players = ["Black", "White", "Red", "Blue"]
    current_player = 0  # Starting with Black
    special_squares = set()

    # Update pieces left for each player
    pieces_left = {
        "Black": {"AttackPawn": 4, "DefensePawn": 4, "ConquestPawn": 4, "King": 1},
        "White": {"AttackPawn": 4, "DefensePawn": 4, "ConquestPawn": 4, "King": 1},
        "Red":   {"AttackPawn": 4, "DefensePawn": 4, "ConquestPawn": 4, "King": 1},
        "Blue":  {"AttackPawn": 4, "DefensePawn": 4, "ConquestPawn": 4, "King": 1}
    }

    # Update controlled squares and captured pieces similarly:
    controlled_squares = {
        "Black": set(), "White": set(), "Red": set(), "Blue": set()
    }

    captured_pieces = {
        "Black": {"AttackPawn": 0, "DefensePawn": 0, "ConquestPawn": 0, "King": 0},
        "White": {"AttackPawn": 0, "DefensePawn": 0, "ConquestPawn": 0, "King": 0},
        "Red":   {"AttackPawn": 0, "DefensePawn": 0, "ConquestPawn": 0, "King": 0},
        "Blue":  {"AttackPawn": 0, "DefensePawn": 0, "ConquestPawn": 0, "King": 0}
    }

    
    pieces_placed = {"Black": 0, "White": 0, "Red": 0, "Blue": 0}  # Number of pieces placed by each player


    # Turn sequence: first turn 1 piece, then 24 turns of 2 pieces, then final turn 1 piece
    turn_sequence = [1]*52

    def generate_special_squares():
        attempts = 0
        # For a 12x12 board, choose rows and cols in a central range (e.g. from 2 to ROWS-3)
        while len(special_squares) < 11 and attempts < 1000000:
            row = random.randint(3, ROWS - 4)
            col = random.randint(3, COLS - 4)
            # Ensure a minimum distance of 3 squares between special squares
            if all(max(abs(row - r), abs(col - c)) >= 3 for r, c in special_squares):
                special_squares.add((row, col))
            attempts += 1
    
    def is_square_disallowed_for_placement(row, col, player, piece_type):
        # Always disallow if out of bounds or on a special square.
        if not (0 <= row < ROWS and 0 <= col < COLS):
            return True
        if (row, col) in special_squares:
            return True

        # For ConquestPawn, enforce the minimum distance rule from special squares.
        if piece_type == "ConquestPawn":
            for (r_s, c_s) in special_squares:
                if max(abs(row - r_s), abs(col - c_s)) < 3:
                    return True

        # For AttackPawn, restrict placement to the designated quadrant and a rotated L shape.
        if piece_type == "AttackPawn":
            if player == "Black":
                # Must be in the top-left quadrant.
                if not (row < ROWS // 2 and col < COLS // 2):
                    return True
                # Allowed only if in the first 3 rows or in the first 3 columns.
                if not (row < 3 or col < 3):
                    return True
            elif player == "White":
                # Must be in the top-right quadrant.
                if not (row < ROWS // 2 and col >= COLS // 2):
                    return True
                # Allowed only if in the first 3 rows or in the last 3 columns.
                if not (row < 3 or col >= COLS - 3):
                    return True
            elif player == "Red":
                # Must be in the bottom-left quadrant.
                if not (row >= ROWS // 2 and col < COLS // 2):
                    return True
                # Allowed only if in the last 3 rows or in the first 3 columns.
                if not (row >= ROWS - 3 or col < 3):
                    return True
            elif player == "Blue":
                # Must be in the bottom-right quadrant.
                if not (row >= ROWS // 2 and col >= COLS // 2):
                    return True
                if not (row >= ROWS - 3 or col >= COLS - 3):
                    return True
        if piece_type == "King":


            if player == "Black":
                # Must be in the top-left quadrant.
                if not (row < ROWS // 2 and col < COLS // 2):
                    return True

            elif player == "White":
                # Must be in the top-right quadrant.
                if not (row < ROWS // 2 and col >= COLS // 2):
                    return True

            elif player == "Red":
                # Must be in the bottom-left quadrant.
                if not (row >= ROWS // 2 and col < COLS // 2):
                    return True
            elif player == "Blue":
                # Must be in the bottom-right quadrant.
                if not (row >= ROWS // 2 and col >= COLS // 2):
                    return True

    def place_piece(pos):
        global current_player, placing_pieces

        col, row = pos[0] // SQ_SIZE, pos[1] // SQ_SIZE

        # Check if the click is within bounds, the square is empty, and it's not a special square.
        if not (0 <= row < ROWS and 0 <= col < COLS):
            return
        if board[row][col] is not None:
            return
        if (row, col) in special_squares:
            return

        # Determine which piece to place next for the current player.
        piece_type = next((p for p in PIECE_ORDER if pieces_left[players[current_player]][p] > 0), None)
        if piece_type is None:
            return
        if is_square_disallowed_for_placement(row, col, players[current_player], piece_type):
            return

        # Place the piece.
        board[row][col] = {"type": piece_type, "player": players[current_player]}
        pieces_left[players[current_player]][piece_type] -= 1
        pieces_placed[players[current_player]] += 1

        # Alternate current player after each placement.
        current_player = (current_player + 1) % len(players)

        # End placement phase only when all players have placed all pieces.
        if all(pieces_placed[player] == len(PIECE_ORDER) for player in players):
            placing_pieces = False
        
    def handle_click(pos):
        global selected_piece, current_player, moves_this_turn, game_over

        mx, my = pos

        # --- 1. UI Buttons: Undo/Redo, PASS ---
        if (UNDO_WINDOW_X <= mx <= UNDO_WINDOW_X + UNDO_WINDOW_W and 
            UNDO_WINDOW_Y <= my <= UNDO_WINDOW_Y + UNDO_WINDOW_H):
            undo_move()
            return

        if (BUTTON_X <= pos[0] <= BUTTON_X + BUTTON_W and 
            (BUTTON_Y+122) <= pos[1] <= (BUTTON_Y+122) + BUTTON_H):
            end_turn()
            return


        # --- 2. Placement Phase ---
        if placing_pieces:
            place_piece(pos)
            return

        # --- 3. Game Over Check ---
        if game_over:
            # Check if click is on the UNDO button.
            if (UNDO_WINDOW_X <= mx <= UNDO_WINDOW_X + UNDO_WINDOW_W and 
                UNDO_WINDOW_Y <= my <= UNDO_WINDOW_Y + UNDO_WINDOW_H):
                undo_move()
            # Also check if click is on the QUIT button.
            elif (QUIT_BUTTON_X <= mx <= QUIT_BUTTON_X + QUIT_BUTTON_W and 
                QUIT_BUTTON_Y <= my <= QUIT_BUTTON_Y + QUIT_BUTTON_H):
                pygame.quit()
                exit()
        # Ignore all other clicks.
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
                    if (piece["type"] == "AttackPawn" and target_piece and 
                        target_piece["type"] == "King" and (delta_row, delta_col) in [(1, 0), (0, 1), (2, 0), (0, 2)]):
                        defense_pos = get_defense_pawn_adjacent_to_king(row, col, target_piece["player"])
                        if defense_pos is not None:
                            # Repulsion branch: animate repulsion and remove the defending pawn.
                            path = repulse_attack_pawn_path(start_pos, (row, col))
                            for pos_step in path[1:]:
                                board[start_pos[0]][start_pos[1]] = None
                                board[pos_step[0]][pos_step[1]] = piece
                                draw_everything()
                                pygame.display.flip()
                                pygame.time.delay(200)
                                start_pos = pos_step
                            new_pos = path[-1]
                            def_r, def_c = defense_pos
                            captured = {"defense": (board[def_r][def_c].copy(), (def_r, def_c))}
                            board[def_r][def_c] = None
                            record_move(selected_piece, new_pos, piece, captured)
                            # Update the captured counter for the defense pawn.
                            captured_pieces[players[current_player]]["DefensePawn"] += 1
                            return
                        else:
                            # Sacrifice branch: no defender available.
                            captured = {"king": target_piece}
                            prev_snapshot = copy.deepcopy(board)
                            board[start_pos[0]][start_pos[1]] = None
                            board[row][col] = None
                            new_snapshot = copy.deepcopy(board)
                            record_move_sacrifice(selected_piece, (row, col), piece, captured, prev_snapshot, new_snapshot)
                            moves_this_turn = 0
                            game_over = True
                            flash_winner_king(piece["player"], 1)
                            end_turn()
                            return
                    else:
                        # --- Normal Move / Capture Branch ---
                        if target_piece and target_piece["player"] != piece["player"]:
                            captured = target_piece.copy()
                            # Record the move before modifying the control and captured counters.
                            record_move(selected_piece, (row, col), piece, captured)
                            # If the target is a ConquestPawn on a special square, remove its control.
                            if target_piece["type"] == "ConquestPawn":
                                if (row, col) in controlled_squares[target_piece["player"]]:
                                    controlled_squares[target_piece["player"]].remove((row, col))
                            # Then update the captured counter for the target piece.
                            captured_pieces[players[current_player]][target_piece["type"]] += 1
                            board[row][col] = None
                        else:
                            record_move(selected_piece, (row, col), piece, None)

                        board[row][col] = piece
                        board[start_pos[0]][start_pos[1]] = None
                        if piece["type"] == "ConquestPawn" and (row, col) in special_squares:
                            controlled_squares[piece["player"]].add((row, col))
                            check_special_squares()
                            flash_effects[(row, col)] = time.time()
                        
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

    def end_turn():
        global current_player, moves_this_turn, selected_piece, turn_counter
        # Instead of 1 - current_player, use modulo arithmetic:
        current_player = (current_player + 1) % len(players)
        moves_this_turn = 0
        selected_piece = None
        turn_counter += 1
        check_candidate_win()  # (May need additional reworking for 4 players.)

    def draw_board():
        # First, sanitize the board.
        sanitize_board()
        
        # Fill the background.
        screen.fill(GRAY)
        
        # Draw board squares.
        for row in range(ROWS):
            for col in range(COLS):
                base_color = LIGHT_BROWN if (row + col) % 2 == 0 else DARK_BROWN
                pygame.draw.rect(screen, base_color, (col * SQ_SIZE, row * SQ_SIZE, SQ_SIZE, SQ_SIZE))
        
        # Draw special squares (if any).
        for (r, c) in special_squares:
            pygame.draw.circle(screen, GREEN, (c * SQ_SIZE + SQ_SIZE // 2, r * SQ_SIZE + SQ_SIZE // 2), SQ_SIZE // 3 + 5)
        
        # Draw pieces using custom icons.
        # Assumes PIECE_IMAGES is a dict structured as:
        # PIECE_IMAGES = { "Black": { "AttackPawn": surface, "DefensePawn": surface, ... },
        #                  "White": { "AttackPawn": surface, "DefensePawn": surface, ... } }
        for row_idx in range(ROWS):
            for col_idx in range(COLS):
                cell = board[row_idx][col_idx]
                if cell:
                    piece = cell
                    # Retrieve the corresponding image.
                    piece_image = PIECE_IMAGES[piece["player"]][piece["type"]]
                    piece_rect = piece_image.get_rect()
                    # Center the image in the square.
                    piece_rect.center = (col_idx * SQ_SIZE + SQ_SIZE // 2,
                                        row_idx * SQ_SIZE + SQ_SIZE // 2)
                    screen.blit(piece_image, piece_rect)
        
        # Handle flash effects (for moves, win indication, etc.).
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
        
        # During placement phase, overlay forbidden squares.
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
        
        # If a piece is selected, show its valid moves.
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
        
        # Draw row numbers on the right side.
        for row in range(ROWS):
            label = font.render(str(ROWS - row), True, BLACK)
            x = 820  # Adjust as needed.
            y = row * SQ_SIZE + SQ_SIZE / 2 - label.get_height() / 2
            screen.blit(label, (x, y))
        
        # Draw column letters below the board.
        for col in range(COLS):
            letter = chr(ord('A') + col)
            label = font.render(letter, True, BLACK)
            x = col * SQ_SIZE + SQ_SIZE / 2 - label.get_width() / 2
            y = ROWS * SQ_SIZE + 5
            screen.blit(label, (x, y))

    def draw_everything():
        draw_board()
        draw_turn()
        draw_button()
        draw_scoreboard()
        #draw_capture_counter()
        draw_placement_icon()
        draw_undo_window()
        draw_reset_button()
        draw_quit_button()
        pygame.display.flip()

    def draw_reset_button():
        pygame.draw.rect(screen, BUTTON_COLOR, (RESET_BUTTON_X, RESET_BUTTON_Y, RESET_BUTTON_W, RESET_BUTTON_H))
        pygame.draw.rect(screen, BLACK, (RESET_BUTTON_X, RESET_BUTTON_Y, RESET_BUTTON_W, RESET_BUTTON_H), 2)
        text = font.render("RESET", True, WHITE)
        text_x = RESET_BUTTON_X + (RESET_BUTTON_W - text.get_width()) // 2
        text_y = RESET_BUTTON_Y + (RESET_BUTTON_H - text.get_height()) // 2
        screen.blit(text, (text_x, text_y))

    def draw_quit_button():
        pygame.draw.rect(screen, BUTTON_COLOR, (QUIT_BUTTON_X, QUIT_BUTTON_Y, QUIT_BUTTON_W, QUIT_BUTTON_H))
        pygame.draw.rect(screen, BLACK, (QUIT_BUTTON_X, QUIT_BUTTON_Y, QUIT_BUTTON_W, QUIT_BUTTON_H), 2)
        text = font.render("QUIT", True, WHITE)
        text_x = QUIT_BUTTON_X + (QUIT_BUTTON_W - text.get_width()) // 2
        text_y = QUIT_BUTTON_Y + (QUIT_BUTTON_H - text.get_height()) // 2
        screen.blit(text, (text_x, text_y))

    def draw_turn():
        # Example: Draw a circle in a location that indicates the current player's turn.
        # You might decide on a fixed location or a rotating indicator.
        current_color = current_player  # This will be a string like "Black", "White", etc.
        # Define positions for each player's turn indicator (example positions)
        icon_width = PLACEMENT_ICON_W - 75
        turn_positions = {
            "Black": (PLACEMENT_ICON_X + (PLACEMENT_ICON_W - icon_width) // 2 + 27, SCOREBOARD_Y -200),
            "White": (PLACEMENT_ICON_X + (PLACEMENT_ICON_W - icon_width) // 2 + 27, SCOREBOARD_Y -200),
            "Red":   (PLACEMENT_ICON_X + (PLACEMENT_ICON_W - icon_width) // 2 + 27, SCOREBOARD_Y -200),
            "Blue":  (PLACEMENT_ICON_X + (PLACEMENT_ICON_W - icon_width) // 2 + 27, SCOREBOARD_Y -200)
        }
        pos = turn_positions[players[current_player]]
        # You may choose to simply fill a circle with the player's color (or render a label)
        pygame.draw.circle(screen, pygame.Color(players[current_player]), pos, 25)

    def draw_button():
        pygame.draw.rect(screen, BUTTON_COLOR, (BUTTON_X, BUTTON_Y+122, BUTTON_W, BUTTON_H))
        pygame.draw.rect(screen, BLACK, (BUTTON_X, BUTTON_Y+122, BUTTON_W, BUTTON_H), 2)
        text = font.render("PASS", True, WHITE)
        screen.blit(text, (BUTTON_X + 25, BUTTON_Y + 135))

    def draw_scoreboard():
        scoreboard_height = 150
        segment_height = scoreboard_height / 4
        border_thickness = 8  # Increase border thickness here

        # Draw a thick black border around the entire scoreboard area
        pygame.draw.rect(screen, BLACK, (SCOREBOARD_X, SCOREBOARD_Y, BUTTON_W, scoreboard_height), border_thickness)
        
        players_info = [
            ("Black", WHITE, BLACK),
            ("White", BLACK, WHITE),
            ("Red", WHITE, RED),
            ("Blue", WHITE, BLUE)
        ]
        
        for i, (player, text_color, fill_color) in enumerate(players_info):
            seg_y = SCOREBOARD_Y + int(i * segment_height)
            seg_h = int(segment_height)
            pygame.draw.rect(screen, fill_color, (SCOREBOARD_X, seg_y, BUTTON_W, seg_h))
            text = font.render(f"{player}: {len(controlled_squares[player])}", True, text_color)
            text_y = seg_y + (seg_h - text.get_height()) // 2
            screen.blit(text, (SCOREBOARD_X + 13, text_y))

    def draw_capture_counter():
        # Check if any captured pieces exist.
        any_captured = any(
            captured_pieces[player][ptype] > 0 
            for player in ["Black", "White"] 
            for ptype in captured_pieces[player]
        )
        if not any_captured:
            return  # Do not draw the capture counter if no pieces have been captured.
        
        # Set the capture counter dimensions.
        counter_width = 250
        counter_height = 256  # Enough space to display 4 rows in each half.
        
        # Clear the area by drawing a background rectangle.
        pygame.draw.rect(screen, GRAY, (CAPTURE_COUNTER_X, CAPTURE_COUNTER_Y, counter_width, counter_height))
        
        # Draw a horizontal divider to separate the two groups.
        divider_y = CAPTURE_COUNTER_Y + counter_height // 2
        
        # Use a fixed order for piece types.
        piece_order = ["King", "AttackPawn", "DefensePawn", "ConquestPawn"]
        
        # Layout parameters.
        row_height = (counter_height // 2) // 4  # Each half divided into 4 rows.
        icon_size = 25     # Each icon will be scaled to 20x20.
        icon_spacing = 7   # Horizontal spacing between icons.
        
        # --- Top Half: Captured Black pieces (i.e. Black pieces captured by White) ---
        y_top = CAPTURE_COUNTER_Y + 7
        for i, p_type in enumerate(piece_order):
            x = CAPTURE_COUNTER_X + 7
            count = captured_pieces["Black"][p_type]
            for _ in range(count):
                icon = PIECE_IMAGES["Black"][p_type]
                small_icon = pygame.transform.scale(icon, (icon_size, icon_size))
                screen.blit(small_icon, (x, y_top + i * row_height))
                x += icon_size + icon_spacing

        # --- Bottom Half: Captured White pieces (i.e. White pieces captured by Black) ---
        y_bottom = divider_y # +5
        for i, p_type in enumerate(piece_order):
            x = CAPTURE_COUNTER_X + 7
            count = captured_pieces["White"][p_type]
            for _ in range(count):
                icon = PIECE_IMAGES["White"][p_type]
                small_icon = pygame.transform.scale(icon, (icon_size, icon_size))
                screen.blit(small_icon, (x, y_bottom + i * row_height))
                x += icon_size + icon_spacing

    def draw_placement_icon():
        if placing_pieces:
            next_piece_type = get_next_piece_type_for_player(players[current_player])
            if next_piece_type is not None:
                # Retrieve the PNG icon for the next piece from the current player's images.
                piece_icon = PIECE_IMAGES[players[current_player]][next_piece_type]
                # Scale the icon to fit within the placement icon area (with a small margin).
                icon_width = PLACEMENT_ICON_W - 75
                icon_height = PLACEMENT_ICON_H - 13
                scaled_icon = pygame.transform.scale(piece_icon, (icon_width, icon_height))
                # Center the icon in the designated placement area.
                icon_x = PLACEMENT_ICON_X + (PLACEMENT_ICON_W - icon_width) // 2
                icon_y = PLACEMENT_ICON_Y + (PLACEMENT_ICON_H - icon_height) // 2 +30
                screen.blit(scaled_icon, (icon_x, icon_y))

    def draw_undo_window():
        # Draw a background rectangle for the undo window
        pygame.draw.rect(screen, GRAY, (UNDO_WINDOW_X, UNDO_WINDOW_Y + 10, UNDO_WINDOW_W/2-7, UNDO_WINDOW_H))
        pygame.draw.rect(screen, BLACK, (UNDO_WINDOW_X, UNDO_WINDOW_Y + 10, UNDO_WINDOW_W/2-7, UNDO_WINDOW_H), 2)
        
        # Draw left arrow (for undo)
        left_arrow = [
            (UNDO_WINDOW_X + 13, UNDO_WINDOW_Y + 10 + UNDO_WINDOW_H // 2),
            (UNDO_WINDOW_X + 38, UNDO_WINDOW_Y + 23),
            (UNDO_WINDOW_X + 38, UNDO_WINDOW_Y + UNDO_WINDOW_H - 3)
        ]
        pygame.draw.polygon(screen, BLACK, left_arrow)
        
        # # Draw right arrow (for redo)
        # right_arrow = [
        #     (UNDO_WINDOW_X + UNDO_WINDOW_W - 10, UNDO_WINDOW_Y + UNDO_WINDOW_H // 2),
        #     (UNDO_WINDOW_X + UNDO_WINDOW_W - 30, UNDO_WINDOW_Y + 10),
        #     (UNDO_WINDOW_X + UNDO_WINDOW_W - 30, UNDO_WINDOW_Y + UNDO_WINDOW_H - 10)
        # ]
        # pygame.draw.polygon(screen, BLACK, right_arrow)

    def record_move(start_pos, end_pos, moved_piece, captured_piece):
        global current_player, moves_this_turn
        prev_state = {
            'current_player': current_player,
            'moves_this_turn': moves_this_turn,
            'controlled': {
                'Black': controlled_squares["Black"].copy(),
                'White': controlled_squares["White"].copy(),
                'Red': controlled_squares["Red"].copy(),
                'Blue': controlled_squares["Blue"].copy()
            },
            'captured': {
                'Black': captured_pieces["Black"].copy(),
                'White': captured_pieces["White"].copy(),
                'Red': captured_pieces["Red"].copy(),
                'Blue': captured_pieces["Blue"].copy()
            },
            'candidate_winner': candidate_winner,
            'both_at_four': both_at_four
        }
        move_sound.play()  # Play move sound.

        # Every move now counts as 1 move.
        new_moves = moves_this_turn + 1

        # If the player has completed 2 moves, rotate the turn.
        if new_moves >= 2:
            new_state = {'current_player': (current_player + 1) % len(players), 'moves_this_turn': 0}
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
                'White': controlled_squares["White"].copy(),
                'Red': controlled_squares["Red"].copy(),
                'Blue': controlled_squares["Blue"].copy()
            }
        })
        redo_history.clear()
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
                'White': controlled_squares["White"].copy(),
                'Red': controlled_squares["Red"].copy(),
                'Blue': controlled_squares["Blue"].copy()
            },
            'captured': {
                'Black': captured_pieces["Black"].copy(),
                'White': captured_pieces["White"].copy(),
                'Red': captured_pieces["Red"].copy(),
                'Blue': captured_pieces["Blue"].copy()
            }
        }
        new_state = {
            'current_player': (current_player + 1) % len(players),
            'moves_this_turn': 0,
            'board_snapshot': new_snapshot,
            'controlled': {
                'Black': controlled_squares["Black"].copy(),
                'White': controlled_squares["White"].copy(),
                'Red': controlled_squares["Red"].copy(),
                'Blue': controlled_squares["Blue"].copy()
            }
        }
        move_history.append({
            'from': start_pos,
            'to': end_pos,
            'piece': moved_piece.copy(),
            'captured': captured_info,
            'sacrifice': True,
            'prev_state': prev_state,
            'new_state': new_state
        })
        redo_history.clear()
        current_player = new_state['current_player']
        moves_this_turn = new_state['moves_this_turn']

    def undo_move():
        global moves_this_turn, current_player, board, controlled_squares, captured_pieces, candidate_winner, both_at_four, game_over
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
        # Restore captured pieces from the previous state.
        captured_pieces["Black"] = last_move['prev_state']['captured']["Black"].copy()
        captured_pieces["White"] = last_move['prev_state']['captured']["White"].copy()
        # Restore special square win state.
        candidate_winner = last_move['prev_state'].get('candidate_winner', None)
        both_at_four = last_move['prev_state'].get('both_at_four', False)
        
        prev_state = last_move['prev_state']
        current_player = prev_state['current_player']
        moves_this_turn = prev_state['moves_this_turn']
        game_over = False
elif mode == "2v2":
    WIDTH, HEIGHT = 1000, 812  # Dimensione finestra
    ROWS, COLS = 12, 12        # Board 18x18 (puoi modificare se preferisci)
    SQ_SIZE = WIDTH // (COLS + 4)  # Calcolo dimensioni casella
    BUTTON_X, BUTTON_Y, BUTTON_W, BUTTON_H = WIDTH - 140, HEIGHT // 2 - 25, 125, 50
    SCOREBOARD_X, SCOREBOARD_Y = BUTTON_X, BUTTON_Y - 88
    CAPTURE_COUNTER_X, CAPTURE_COUNTER_Y = WIDTH - 200, HEIGHT - 312
    TURN_X, TURN_Y, TURN_WIDTH, TURN_HIGHT = BUTTON_X + 125, HEIGHT - 500, 125, 50

    PLACEMENT_ICON_X, PLACEMENT_ICON_Y = SCOREBOARD_X - 113, SCOREBOARD_Y + 82
    PLACEMENT_ICON_W, PLACEMENT_ICON_H = 125, 63

    UNDO_WINDOW_X = SCOREBOARD_X
    UNDO_WINDOW_Y = TURN_Y + TURN_HIGHT + 75
    UNDO_WINDOW_W, UNDO_WINDOW_H = 125, 50

    RESET_BUTTON_X = SCOREBOARD_X
    RESET_BUTTON_Y = UNDO_WINDOW_Y + UNDO_WINDOW_H - 250
    RESET_BUTTON_W, RESET_BUTTON_H = 125, 50

    QUIT_BUTTON_X = RESET_BUTTON_X
    QUIT_BUTTON_Y = RESET_BUTTON_Y + RESET_BUTTON_H - 125
    QUIT_BUTTON_W, QUIT_BUTTON_H = 125, 50

    screen = pygame.display.set_mode((WIDTH, HEIGHT))
    pygame.display.set_caption("Assalto Reale - Modalità 2 vs 2")
    clock = pygame.time.Clock()
    font = pygame.font.SysFont("bookmanoldstyle", 20)

    # --------------------------------------------------------------------------------
    # Organizzazione RUOLI:
    # Black_general  -> Re + 6 AttackPawn
    # Black_guardian -> 6 DefensePawn + 6 ConquestPawn
    # White_general  -> Re + 6 AttackPawn
    # White_guardian -> 6 DefensePawn + 6 ConquestPawn
    # --------------------------------------------------------------------------------

    # Questi 4 ruoli si alternano. L'indice current_role_index cicla su 0..3
    turn_roles = ["Black_general", "White_general", "Black_guardian", "White_guardian"]
    current_role_index = 0  # Parte con Black_general

    def get_current_role():
        """Restituisce una stringa fra 'Black_general', 'White_general', 'Black_guardian', 'White_guardian'."""
        return turn_roles[current_role_index]

    def parse_color_and_controller(role_name):
        """
        Ritorna (colore, controller) = ('Black'/'White', 'general'/'guardian').
        Esempio: 'Black_general' -> ('Black','general')
        """
        if role_name == "Black_general":
            return ("Black", "general")
        elif role_name == "Black_guardian":
            return ("Black", "guardian")
        elif role_name == "White_general":
            return ("White", "general")
        else:
            return ("White", "guardian")

    # --------------------------------------------------------------------------------
    # Pezzi rimanenti da piazzare per ciascun RUOLO
    # --------------------------------------------------------------------------------
    pieces_left = {
        "Black_general":   {"King": 1, "AttackPawn": 6, "DefensePawn": 0, "ConquestPawn": 0},
        "Black_guardian":  {"King": 0, "AttackPawn": 0, "DefensePawn": 6, "ConquestPawn": 6},
        "White_general":   {"King": 1, "AttackPawn": 6, "DefensePawn": 0, "ConquestPawn": 0},
        "White_guardian":  {"King": 0, "AttackPawn": 0, "DefensePawn": 6, "ConquestPawn": 6}
    }

    # --------------------------------------------------------------------------------
    # Pedine catturate. Es.: "Black_general" ha catturato X pedine
    # Puoi anche differenziare chi cattura cosa, ma qui semplifichiamo il conteggio
    # --------------------------------------------------------------------------------
    captured_pieces = {
        "Black_general":   {"AttackPawn": 0, "DefensePawn": 0, "ConquestPawn": 0, "King": 0},
        "Black_guardian":  {"AttackPawn": 0, "DefensePawn": 0, "ConquestPawn": 0, "King": 0},
        "White_general":   {"AttackPawn": 0, "DefensePawn": 0, "ConquestPawn": 0, "King": 0},
        "White_guardian":  {"AttackPawn": 0, "DefensePawn": 0, "ConquestPawn": 0, "King": 0},
    }

    # --------------------------------------------------------------------------------
    # Caselle speciali: solo i "ConquestPawn" controllano una casella
    # controlled_squares: "Black" -> set di posizioni, "White" -> set di posizioni
    # --------------------------------------------------------------------------------
    controlled_squares = {
        "Black": set(),
        "White": set()
    }

    # --------------------------------------------------------------------------------
    # Per la fase di posizionamento manuale:
    # Quante pedine ha già piazzato ogni RUOLO
    # --------------------------------------------------------------------------------
    pieces_placed = {
        "Black_general":  0,
        "Black_guardian": 0,
        "White_general":  0,
        "White_guardian": 0
    }

    # Board 18x18 (inizialmente vuoto)
    board = [[None for _ in range(COLS)] for _ in range(ROWS)]

    special_squares = set()
    move_history = []
    redo_history = []
    game_over = False
    selected_piece = None
    moves_this_turn = 0  # Quante mosse ha fatto il ruolo corrente nel suo turno
    turn_counter = 0

    # Logica “candidate winner”
    candidate_winner = None
    candidate_turn_index = None
    both_at_four = False

    placing_pieces = True  # Fase di piazzamento
    FLASH_DURATION = 2.0
    BLINK_INTERVAL = 0.3

    # In 2 vs 2, potresti definire un turn_sequence diverso
    # Ma qui definiamo che ogni RUOLO piazza 19 pezzi (1 King + 18 Pawn).
    # Di solito si fa un "giro" in cui ciascuno piazza 1 o 2 pedine a turno.
    # Esempio semplificato:
    turn_sequence = 2*[1] + 13*[2]  # primi 2 turni = piazza 1 pezzo, poi 13 turni da 2 pezzi...
    turn_index = 0
    turn_pieces_count = 0

    # ------------------------------------------------------------------------------
    # Funzione generazione Caselle Speciali
    # ------------------------------------------------------------------------------

    def generate_special_squares():
        attempts = 0
        desired_count = 5  # Quante caselle speciali vuoi?
        while len(special_squares) < desired_count and attempts < 500000:
            row = random.randint(1, ROWS - 2)
            col = random.randint(1, COLS - 2)
            # distanza minima 3 fra le special squares
            if all(max(abs(row - r), abs(col - c)) >= 3 for (r, c) in special_squares):
                special_squares.add((row, col))
            attempts += 1

    generate_special_squares()

    # --------------------------------------------------------------------------------
    # Funzioni per la fase di piazzamento
    # --------------------------------------------------------------------------------
    def is_square_disallowed_for_placement(row, col, role_name, piece_type):
        """
        Decidi le restrizioni di piazzamento iniziale per i vari tipi di pedine,
        in base a come preferisci posizionarle sul board 18x18.
        Di seguito un esempio semplificato:
        """
        if not (0 <= row < ROWS and 0 <= col < COLS):
            return True
        if (row, col) in special_squares:
            return True

        color, controller = parse_color_and_controller(role_name)

        # Esempio: impedisci che un ConquestPawn si piazzi a meno di 3 caselle da uno special square
        if piece_type == "ConquestPawn":
            for (rs, cs) in special_squares:
                if max(abs(row - rs), abs(col - cs)) < 3:
                    return True

        # A scelta si possono definire zone specifiche. Es.:
        # - i neri (Black) piazzano i pezzi nella parte alta/sinistra
        # - i bianchi (White) piazzano nella parte bassa/destra
        # Oppure vincoli più stretti. Qui un esempio semplice:
        if color == "Black" and row > 7:
            return True
        if color == "White" and row < 10:
            return True

        # Se preferisci altre regole di “lock” per King o AttackPawn, aggiungile:
        # ...
        return False

    def place_piece(pos):
        print("[DEBUG] Ho chiamato place_piece, pos =", pos)
        col = pos[0] // SQ_SIZE
        row = pos[1] // SQ_SIZE
        print(f"[DEBUG] row={row}, col={col}")

        if not (0 <= row < ROWS and 0 <= col < COLS):
            print("[DEBUG] Fuori dalla scacchiera, return")
            return

        if board[row][col] is not None:
            print("[DEBUG] La cella non è vuota, return")
            return

        # Esempio di vincolo: se (row, col) in special_squares non si può piazzare
        if (row, col) in special_squares:
            print("[DEBUG] E' una special square, return")
            return

        role_now = get_current_role()  # es: "Black_general"
        print("[DEBUG] Ruolo corrente =", role_now)

        # Verifico i pezzi disponibili
        for p_type in ["King","AttackPawn","DefensePawn","ConquestPawn"]:
            if pieces_left[role_now][p_type] > 0:
                # Esempio, controlla se la cella è vietata
                if is_square_disallowed_for_placement(row, col, role_now, p_type):
                    print("[DEBUG] Cella vietata per", p_type)
                    return

                # Se arrivi qui, piazzi il pezzo
                board[row][col] = {
                    "type": p_type,
                    "player": "Black" if "Black" in role_now else "White",  
                    "controller": role_now 
                }
                pieces_left[role_now][p_type] -= 1
                print(f"[DEBUG] Piazzato {p_type} su r={row},c={col}")
                break

    def advance_placement_turn():
        """
        Passa il turno di piazzamento al ruolo successivo
        tenendo conto della turn_sequence per gestire quanti pezzi piazzare per turno.
        """
        global turn_index, turn_pieces_count, current_role_index
        turn_pieces_count = 0
        if turn_index < len(turn_sequence) - 1:
            turn_index += 1

        # Avanza di 1 nel giro dei 4 ruoli
        current_role_index = (current_role_index + 1) % 4

    # --------------------------------------------------------------------------------
    # FASE DI GIOCO (dopo piazzamento)
    # --------------------------------------------------------------------------------

    def end_turn():
        """
        Quando un ruolo ha terminato il suo turno di mosse (o usa "PASS"),
        passiamo la mano al ruolo successivo: (Black_general-> White_general-> Black_guardian-> White_guardian -> repeat)
        """
        global current_role_index, moves_this_turn, selected_piece, turn_counter, game_over

        if game_over:
            return

        moves_this_turn = 0
        selected_piece = None
        current_role_index = (current_role_index + 1) % 4
        turn_counter += 1
        check_candidate_win()

    def complete_turn():
        """
        Quando la primissima mossa in un turno è completata, puoi chiamare qui
        eventuale logica aggiuntiva.
        """
        global turn_counter, selected_piece
        selected_piece = None
        turn_counter += 1
        check_candidate_win()

    def handle_click(pos):
        """
        Gestisce il click sulla board di gioco, quando NON siamo più in piazzamento.
        """
        global selected_piece, game_over

        mx, my = pos

        # Se la partita è finita, controlliamo se ha cliccato su UNDO o QUIT
        if game_over:
            if (UNDO_WINDOW_X <= mx <= UNDO_WINDOW_X + UNDO_WINDOW_W and
                UNDO_WINDOW_Y <= my <= UNDO_WINDOW_Y + UNDO_WINDOW_H):
                undo_move()
            elif (QUIT_BUTTON_X <= mx <= QUIT_BUTTON_X + QUIT_BUTTON_W and
                  QUIT_BUTTON_Y <= my <= QUIT_BUTTON_Y + QUIT_BUTTON_H):
                pygame.quit()
                exit()
            return

        # Converte la posizione in coordinate di board
        col = mx // SQ_SIZE
        row = my // SQ_SIZE
        if not (0 <= row < ROWS and 0 <= col < COLS):
            return

        role_now = get_current_role()
        color_now, controller_now = parse_color_and_controller(role_now)

        # Se c’è un pezzo già selezionato e vogliamo spostarlo
        if selected_piece is not None:
            start_r, start_c = selected_piece
            piece = board[start_r][start_c]
            if piece and piece["controller"] == role_now:
                # Se il pezzo lascia una special square come ConquestPawn, rimuovo controllo
                if piece["type"] == "ConquestPawn" and (start_r, start_c) in special_squares:
                    if (start_r, start_c) in controlled_squares[piece["player"]]:
                        controlled_squares[piece["player"]].remove((start_r, start_c))

                # Verifica se la mossa è valida
                if is_valid_move(piece, (start_r, start_c), (row, col)):
                    target_piece = board[row][col]
                    delta_r = abs(row - start_r)
                    delta_c = abs(col - start_c)

                    # Cattura speciale: AttackPawn vs King
                    # -> Logica di repulsione o sacrificio
                    if (piece["type"] == "AttackPawn" and target_piece and
                        target_piece["type"] == "King" and (delta_r, delta_c) in [(1,0),(0,1),(2,0),(0,2)]):

                        defense_pos = get_defense_pawn_adjacent_to_king(row, col, target_piece["player"])
                        if defense_pos is not None:
                            # Repulsione
                            path = repulse_attack_pawn_path((start_r, start_c), (row, col))
                            animate_repulsion(piece, path)
                            # Rimuovo il DefensePawn
                            def_r, def_c = defense_pos
                            captured = {"defense": (board[def_r][def_c].copy(), (def_r, def_c))}
                            board[def_r][def_c] = None
                            record_move((start_r, start_c), path[-1], piece, captured)
                            return
                        else:
                            # Sacrificio (no difesa)
                            captured = {"king": target_piece}
                            prev_snapshot = copy.deepcopy(board)
                            board[start_r][start_c] = None
                            board[row][col] = None
                            new_snapshot = copy.deepcopy(board)
                            record_move_sacrifice((start_r, start_c), (row, col), piece, captured, prev_snapshot, new_snapshot)
                            game_over = True
                            flash_winner_king(piece["player"], 1)
                            end_turn()
                            return

                    else:
                        # Mossa/cattura normale
                        if target_piece and target_piece["player"] != piece["player"]:
                            # cattura
                            captured = target_piece.copy()
                            record_move((start_r, start_c), (row, col), piece, captured)
                            # Se catturo un ConquestPawn su special square, rimuovo controllo
                            if (target_piece["type"] == "ConquestPawn") and ((row, col) in controlled_squares[target_piece["player"]]):
                                controlled_squares[target_piece["player"]].remove((row, col))
                            # Aggiorno contatore pedine catturate
                            captured_pieces[role_now][target_piece["type"]] += 1
                            board[row][col] = None
                        else:
                            # mossa semplice
                            record_move((start_r, start_c), (row, col), piece, None)

                        # Eseguo lo spostamento
                        board[row][col] = piece
                        board[start_r][start_c] = None

                        # Se arrivo su una special square con un ConquestPawn, conquisto
                        if piece["type"] == "ConquestPawn" and (row, col) in special_squares:
                            controlled_squares[piece["player"]].add((row, col))
                            check_special_squares()
                            flash_effects[(row, col)] = time.time()

                        # Se è la prima mossa del turno, lo “completo” e ripulisco selected
                        if moves_this_turn == 0:
                            complete_turn()
                        selected_piece = None
                        return
                else:
                    # Mossa non valida o click a vuoto
                    selected_piece = None
            else:
                # Hai selezionato un pezzo che non ti appartiene?
                selected_piece = None
        else:
            # Nessun pezzo selezionato, proviamo a selezionare un pezzo appartenente al RUOLO corrente
            piece = board[row][col]
            if piece and piece["controller"] == role_now:
                selected_piece = (row, col)
            else:
                selected_piece = None

    # --------------------------------------------------------------------------------
    # Funzioni di disegno (GUI)
    # --------------------------------------------------------------------------------

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

    def draw_board():
        screen.fill(GRAY)
        # Scacchiera
        for r in range(ROWS):
            for c in range(COLS):
                base_color = LIGHT_BROWN if ((r + c) % 2 == 0) else DARK_BROWN
                pygame.draw.rect(screen, base_color, (c * SQ_SIZE, r * SQ_SIZE, SQ_SIZE, SQ_SIZE))

        # Caselle speciali
        for (rr, cc) in special_squares:
            pygame.draw.circle(screen, GREEN, (cc * SQ_SIZE + SQ_SIZE//2, rr * SQ_SIZE + SQ_SIZE//2), SQ_SIZE//3 + 5)

        # Disegno i pezzi
        for rr in range(ROWS):
            for cc in range(COLS):
                cell = board[rr][cc]
                if cell:
                    piece_image = PIECE_IMAGES[cell["player"]][cell["type"]]
                    rect_img = piece_image.get_rect()
                    rect_img.center = (cc * SQ_SIZE + SQ_SIZE//2, rr * SQ_SIZE + SQ_SIZE//2)
                    screen.blit(piece_image, rect_img)

        # Effetto flash
        now = time.time()
        for (r, c) in list(flash_effects.keys()):
            elapsed = now - flash_effects[(r, c)]
            if elapsed < FLASH_DURATION:
                blink_count = int(elapsed // BLINK_INTERVAL)
                overlay_color = (0, 255, 0, 120) if (blink_count % 2 == 0) else (0, 255, 0, 0)
                surf = pygame.Surface((SQ_SIZE, SQ_SIZE), pygame.SRCALPHA)
                surf.fill(overlay_color)
                screen.blit(surf, (c * SQ_SIZE, r * SQ_SIZE))
            else:
                del flash_effects[(r, c)]

        # Evidenzio le mosse possibili del pezzo selezionato
        if selected_piece:
            sr, sc = selected_piece
            piece = board[sr][sc]
            if piece:
                val_moves = get_valid_moves(piece, (sr, sc))
                for (rr, cc) in val_moves:
                    cx = cc * SQ_SIZE + SQ_SIZE//2
                    cy = rr * SQ_SIZE + SQ_SIZE//2
                    targ = board[rr][cc]
                    if targ and targ["player"] != piece["player"]:
                        pygame.draw.circle(screen, (255, 0, 0, 80), (cx, cy), SQ_SIZE//6)
                    else:
                        pygame.draw.circle(screen, (128, 128, 128, 80), (cx, cy), SQ_SIZE//6)

        # Coordinate esterne (numeri e lettere)
        for row in range(ROWS):
            label = font.render(str(ROWS - row), True, BLACK)
            xlbl = COLS * SQ_SIZE + 5
            ylbl = row * SQ_SIZE + SQ_SIZE//2 - label.get_height()//2
            screen.blit(label, (xlbl, ylbl))

        for col in range(COLS):
            letter = chr(ord('A') + col)
            label = font.render(letter, True, BLACK)
            xl = col * SQ_SIZE + SQ_SIZE//2 - label.get_width()//2
            yl = ROWS * SQ_SIZE + 5
            screen.blit(label, (xl, yl))

    def draw_turn():
        """
        Disegna un indicatore del ruolo corrente.
        """
        current_role = get_current_role()
        txt = font.render(f"Turno: {current_role}", True, WHITE)
        screen.blit(txt, (SCOREBOARD_X - 50, SCOREBOARD_Y - 20))

    def draw_button():
        # Bottone "PASS"
        pygame.draw.rect(screen, BUTTON_COLOR, (BUTTON_X, BUTTON_Y, BUTTON_W, BUTTON_H))
        pygame.draw.rect(screen, BLACK, (BUTTON_X, BUTTON_Y, BUTTON_W, BUTTON_H), 2)
        text = font.render("PASS", True, WHITE)
        screen.blit(text, (BUTTON_X + 25, BUTTON_Y + 13))

    def draw_scoreboard():
        # Semplice scoreboard: quante special squares controllate da Black e White
        pygame.draw.rect(screen, BLACK, (SCOREBOARD_X, SCOREBOARD_Y, BUTTON_W, 75), 2)
        pygame.draw.rect(screen, WHITE, (SCOREBOARD_X, SCOREBOARD_Y, BUTTON_W, 38))
        pygame.draw.rect(screen, BLACK, (SCOREBOARD_X, SCOREBOARD_Y, BUTTON_W, 38))

        black_count = len(controlled_squares["Black"])
        white_count = len(controlled_squares["White"])
        text_black = font.render(f"Black: {black_count}", True, WHITE)
        text_white = font.render(f"White: {white_count}", True, BLACK)
        screen.blit(text_black, (SCOREBOARD_X + 13, SCOREBOARD_Y + 7))
        screen.blit(text_white, (SCOREBOARD_X + 13, SCOREBOARD_Y + 38))

    def draw_capture_counter():
        """
        Se vuoi mostrare le pedine catturate da Black_general, Black_guardian, ecc., 
        puoi creare 4 mini-righe. Qui mostriamo solo un esempio.
        """
        any_captured = any(
            captured_pieces[r][pt] > 0
            for r in turn_roles
            for pt in captured_pieces[r]
        )
        if not any_captured:
            return

        counter_width = 200
        counter_height = 180
        pygame.draw.rect(screen, GRAY, (CAPTURE_COUNTER_X, CAPTURE_COUNTER_Y, counter_width, counter_height))
        pygame.draw.rect(screen, BLACK, (CAPTURE_COUNTER_X, CAPTURE_COUNTER_Y, counter_width, counter_height), 2)

        # Esempio: stampo solo le catture di "Black_general" e "White_general"
        # Adatta come preferisci.
        row_y = CAPTURE_COUNTER_Y + 10
        for role_label in ["Black_general", "White_general"]:
            text_role = font.render(role_label + ":", True, WHITE)
            screen.blit(text_role, (CAPTURE_COUNTER_X + 5, row_y))
            row_y += 20
            # per ogni tipo di pezzo
            for ptype in ["King", "AttackPawn", "DefensePawn", "ConquestPawn"]:
                count = captured_pieces[role_label][ptype]
                if count > 0:
                    # Piccola icona + numero
                    piece_icon = PIECE_IMAGES["Black"][ptype] if "Black" in role_label else PIECE_IMAGES["White"][ptype]
                    small_icon = pygame.transform.scale(piece_icon, (20, 20))
                    screen.blit(small_icon, (CAPTURE_COUNTER_X + 10, row_y))
                    txt = font.render(f"x{count}", True, WHITE)
                    screen.blit(txt, (CAPTURE_COUNTER_X + 35, row_y))
                    row_y += 22
            row_y += 10

    def draw_placement_icon():
        """
        Mostra sullo schermo quale pezzo verrà piazzato per primo dal ruolo corrente (opzionale).
        """
        if placing_pieces:
            role_now = get_current_role()
            for p_type in ["King", "AttackPawn", "DefensePawn", "ConquestPawn"]:
                if pieces_left[role_now][p_type] > 0:
                    piece_icon = PIECE_IMAGES["Black"][p_type] if "Black" in role_now else PIECE_IMAGES["White"][p_type]
                    icon_w = PLACEMENT_ICON_W - 60
                    icon_h = PLACEMENT_ICON_H - 10
                    scaled = pygame.transform.scale(piece_icon, (icon_w, icon_h))
                    screen.blit(scaled, (PLACEMENT_ICON_X, PLACEMENT_ICON_Y))
                    break

    def draw_undo_window():
        pygame.draw.rect(screen, GRAY, (UNDO_WINDOW_X, UNDO_WINDOW_Y, UNDO_WINDOW_W//2 - 7, UNDO_WINDOW_H))
        pygame.draw.rect(screen, BLACK, (UNDO_WINDOW_X, UNDO_WINDOW_Y, UNDO_WINDOW_W//2 - 7, UNDO_WINDOW_H), 2)
        # freccia sinistra
        left_arrow = [
            (UNDO_WINDOW_X + 13, UNDO_WINDOW_Y + UNDO_WINDOW_H // 2),
            (UNDO_WINDOW_X + 38, UNDO_WINDOW_Y + 13),
            (UNDO_WINDOW_X + 38, UNDO_WINDOW_Y + UNDO_WINDOW_H - 13)
        ]
        pygame.draw.polygon(screen, BLACK, left_arrow)

    def draw_reset_button():
        pygame.draw.rect(screen, BUTTON_COLOR, (RESET_BUTTON_X, RESET_BUTTON_Y, RESET_BUTTON_W, RESET_BUTTON_H))
        pygame.draw.rect(screen, BLACK, (RESET_BUTTON_X, RESET_BUTTON_Y, RESET_BUTTON_W, RESET_BUTTON_H), 2)
        text = font.render("RESET", True, WHITE)
        screen.blit(text, (RESET_BUTTON_X + 18, RESET_BUTTON_Y + 13))

    def draw_quit_button():
        pygame.draw.rect(screen, BUTTON_COLOR, (QUIT_BUTTON_X, QUIT_BUTTON_Y, QUIT_BUTTON_W, QUIT_BUTTON_H))
        pygame.draw.rect(screen, BLACK, (QUIT_BUTTON_X, QUIT_BUTTON_Y, QUIT_BUTTON_W, QUIT_BUTTON_H), 2)
        text = font.render("QUIT", True, WHITE)
        screen.blit(text, (QUIT_BUTTON_X + 25, QUIT_BUTTON_Y + 13))

    # --------------------------------------------------------------------------------
    # Funzioni di movimenti e catture (riciclate da 2P / 4P con adattamenti)
    # --------------------------------------------------------------------------------

    def is_valid_move(piece, start, end):
        """
        Qui adatti la logica di movimento e cattura ai tuoi Pawn di Attacco, Difesa, Conquista e Re.
        Se la destinazione contiene un pezzo avversario, verifichi se la cattura è consentita
        (ATTENZIONE alla regola: solo un AttackPawn può catturare il Re).
        """
        row_s, col_s = start
        row_e, col_e = end
        if not (0 <= row_e < ROWS and 0 <= col_e < COLS):
            return False
        if (row_s, col_s) == (row_e, col_e):
            return False

        delta_r = abs(row_e - row_s)
        delta_c = abs(col_e - col_s)
        target = board[row_e][col_e]

        # Se c'è un pezzo avversario, è cattura
        if target and target["player"] != piece["player"]:
            # Stabilisci pattern di cattura per AttackPawn, DefensePawn, ConquestPawn, King
            # (simile a come hai fatto nelle altre modalità)
            if piece["type"] == "AttackPawn":
                # Esempio: 1 casella orth (delta=1) o jump di 2 caselle se moves_this_turn == 0, ecc.
                pass
            elif piece["type"] == "DefensePawn":
                pass
            elif piece["type"] == "ConquestPawn":
                pass
            elif piece["type"] == "King":
                # Ricorda che il Re NON può catturare il Re avversario (in base alle tue regole),
                # oppure se lo consenti, attenzione al conflitto "solo AttackPawn cattura Re".
                pass

            # A fine di esempio, ritorna True/False come nelle altre partite
            return True

        else:
            # Mossa senza cattura (celle libere)
            # Definisci i pattern di movimento lecito per ogni tipo
            # ...
            return True

    # Puoi riusare le funzioni:
    #   get_valid_moves, is_allowed_capture_type,
    #   get_defense_pawn_adjacent_to_king,
    #   repulse_attack_pawn_path,
    #   animate_repulsion,
    #   check_special_squares,
    #   check_candidate_win,
    #   check_stalemate,
    #   flash_winner_king,
    #   etc.
    # come nelle versioni "2P" o "4P", adattandole al fatto che il 'controller' è 'general' o 'guardian'.

    def record_move(start_pos, end_pos, moved_piece, captured_piece):
        """
        Registra una mossa nel move_history, aggiornando moves_this_turn e current_role_index se necessario.
        """
        global moves_this_turn, current_role_index
        prev_state = {
            'role_index': current_role_index,
            'moves_this_turn': moves_this_turn,
            'controlled': {
                'Black': controlled_squares["Black"].copy(),
                'White': controlled_squares["White"].copy()
            },
            'captured': copy.deepcopy(captured_pieces),
            'candidate_winner': candidate_winner,
            'both_at_four': both_at_four
        }
        move_sound.play()

        # Logica di costo mossa (1 o 2 se "jump" ecc.)
        # Qui semplifichiamo: ogni spostamento conta 1
        new_moves = moves_this_turn + 1
        if new_moves >= 2:
            # Finito il turno di questo ruolo
            new_state = {
                'role_index': (current_role_index + 1) % 4,
                'moves_this_turn': 0
            }
        else:
            new_state = {
                'role_index': current_role_index,
                'moves_this_turn': new_moves
            }

        move_history.append({
            'from': start_pos,
            'to': end_pos,
            'piece': moved_piece.copy(),
            'captured': captured_piece.copy() if captured_piece else None,
            'prev_state': prev_state,
            'new_state': new_state,
        })
        redo_history.clear()

        current_role_index = new_state['role_index']
        moves_this_turn    = new_state['moves_this_turn']

    def record_move_sacrifice(start_pos, end_pos, moved_piece, captured_info, prev_snapshot, new_snapshot):
        """
        Come nelle altre modalità, ma adattato alla logica a 4 ruoli.
        """
        global current_role_index, moves_this_turn
        prev_state = {
            'role_index': current_role_index,
            'moves_this_turn': moves_this_turn,
            'board_snapshot': prev_snapshot,
            'controlled': {
                'Black': controlled_squares["Black"].copy(),
                'White': controlled_squares["White"].copy()
            },
            'captured': copy.deepcopy(captured_pieces)
        }
        new_state = {
            'role_index': (current_role_index + 1) % 4,
            'moves_this_turn': 0,
            'board_snapshot': new_snapshot,
            'controlled': {
                'Black': controlled_squares["Black"].copy(),
                'White': controlled_squares["White"].copy()
            },
            'captured': copy.deepcopy(captured_pieces)
        }

        move_history.append({
            'from': start_pos,
            'to': end_pos,
            'piece': moved_piece.copy(),
            'captured': captured_info,
            'sacrifice': True,
            'prev_state': prev_state,
            'new_state': new_state
        })
        redo_history.clear()
        current_role_index = new_state['role_index']
        moves_this_turn = 0

    def undo_move():
        """
        Simile a 2P/4P, ma ripristina i dati di current_role_index e moves_this_turn dal move_history.
        """
        global moves_this_turn, current_role_index, board, controlled_squares, captured_pieces, candidate_winner, both_at_four, game_over

        if not move_history:
            return
        last_move = move_history.pop()
        redo_history.append(last_move)

        if last_move.get('sacrifice'):
            board = copy.deepcopy(last_move['prev_state']['board_snapshot'])
            controlled_squares["Black"] = last_move['prev_state']['controlled']["Black"].copy()
            controlled_squares["White"] = last_move['prev_state']['controlled']["White"].copy()
            captured_pieces = copy.deepcopy(last_move['prev_state']['captured'])
        else:
            start_pos = last_move['from']
            end_pos   = last_move['to']
            moved_piece = last_move['piece']
            captured_piece = last_move['captured']

            board[end_pos[0]][end_pos[1]] = None
            board[start_pos[0]][start_pos[1]] = moved_piece
            if captured_piece:
                # Se era cattura "defense" con chiave "defense": ...
                # Altrimenti ripristina semplicemente
                board[end_pos[0]][end_pos[1]] = captured_piece

            # Ripristino control squares
            controlled_squares["Black"] = last_move['prev_state']['controlled']["Black"].copy()
            controlled_squares["White"] = last_move['prev_state']['controlled']["White"].copy()
            captured_pieces = copy.deepcopy(last_move['prev_state']['captured'])

        # Ripristina special winner state
        candidate_winner = last_move['prev_state'].get('candidate_winner', None)
        both_at_four     = last_move['prev_state'].get('both_at_four', False)
        current_role_index = last_move['prev_state']['role_index']
        moves_this_turn     = last_move['prev_state']['moves_this_turn']
        game_over = False



# Set this flag to True to use auto placement or False for manual placement.
AUTO_PLACEMENT = False

if (AUTO_PLACEMENT) & (mode == "2P"):
    auto_place_pieces_2P()
elif (AUTO_PLACEMENT) & (mode == "4P"):
    auto_place_pieces_4P()
else:
    pass

def auto_place_pieces_2P():
    global board, pieces_left, pieces_placed, placing_pieces
    # Loop over the two players: "Black" and "White"
    for player in players:  # players = ["Black", "White"]
        for piece_type in PIECE_ORDER:
            # While there are still pieces of this type for the player:
            while pieces_left[player][piece_type] > 0:
                valid_positions = []
                for r in range(ROWS):
                    for c in range(COLS):
                        # Only consider empty cells that are not special squares.
                        if board[r][c] is None and (r, c) not in special_squares:
                            # Use your existing placement validation.
                            if not is_square_disallowed_for_placement(r, c, player, piece_type):
                                valid_positions.append((r, c))
                if valid_positions:
                    pos = random.choice(valid_positions)
                    board[pos[0]][pos[1]] = {"type": piece_type, "player": player}
                    pieces_left[player][piece_type] -= 1
                    pieces_placed[player] += 1
                else:
                    # Should not happen if board design is correct.
                    break
    # End the placement phase.
    placing_pieces = False


def auto_place_pieces_4P():
    global board, pieces_left, pieces_placed, placing_pieces
    # Loop over the four players: "Black", "White", "Red", "Blue"
    for player in players:  # players = ["Black", "White", "Red", "Blue"]
        for piece_type in PIECE_ORDER:
            while pieces_left[player][piece_type] > 0:
                valid_positions = []
                for r in range(ROWS):
                    for c in range(COLS):
                        if board[r][c] is None and (r, c) not in special_squares:
                            if not is_square_disallowed_for_placement(r, c, player, piece_type):
                                valid_positions.append((r, c))
                if valid_positions:
                    pos = random.choice(valid_positions)
                    board[pos[0]][pos[1]] = {"type": piece_type, "player": player}
                    pieces_left[player][piece_type] -= 1
                    pieces_placed[player] += 1
                else:
                    break
    placing_pieces = False

generate_special_squares()


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

    elif mover_type == "King":
        # Movimento normale del Re (1 casella in qualsiasi direzione)
        return max(delta_row, delta_col) == 1

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
    elif mover_type == "King":
        # Il Re può catturare qualsiasi pezzo, ma solo se non è un attacco speciale
        return target_type == ["AttackPawn", "DefensePawn", "ConquestPawn"]
    
    return False

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
        elif piece["type"] == "King":
            # King captures in any direction (1 square) or L-shape (2+1 or 1+2).
            if max(delta_row, delta_col) == 1:
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

def sanitize_board():
    """Iterate over the board and set any invalid cell to None."""
    for i in range(ROWS):
        for j in range(COLS):
            cell = board[i][j]
            if cell is not None:
                # Check if cell is a dict with both required keys.
                if not (isinstance(cell, dict) and "player" in cell and "type" in cell):
                    board[i][j] = None

def get_valid_moves(piece, position):
    row, col = position
    valid_moves = []
    for r in range(ROWS):
        for c in range(COLS):
            if is_valid_move(piece, (row, col), (r, c)):
                valid_moves.append((r, c))
    return valid_moves

def get_next_piece_type_for_player(player):
    for p_type in PIECE_ORDER:
        if pieces_left[player][p_type] > 0:
            return p_type
    return None

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
            game_over = True
        else:
            candidate_winner = None

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