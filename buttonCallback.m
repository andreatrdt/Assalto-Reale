function buttonCallback(btn, row, col, size_table, fig, N, M)
    % Usa variabili globali
    global selectedRow selectedCol selectedColor flag punti turn kills valid_moves start Q;

    % Ottieni il colore della casella cliccata
    casellaColor = btn.BackgroundColor;

    v = [1 , -1 , -1 , 1 , 1 ,-1 ,-1 ,1 , 1, -1 ,-1 , 1, 5 , 5];

    if start > 0       
        if ~isempty(row) && M(size_table - row + 1, col) == 0
            if Q(size_table - row + 1, col) ~= 1
                if v(start) == 1 
                    M(size_table - row + 1, col) = 1;
                    start = start + 1;
                elseif v(start) == -1
                    M(size_table - row + 1, col) = -1;
                    start = start + 1;
                elseif v(start) == 5
                    M(size_table - row + 1, col) = 5;
                    start = start + 1;
                end 
            else 
                disp('Mossa non valida');
            end
        else
            disp('Mossa non valida');
        end

        if start > size(v)

            start = 0;
        end
        
        update_chessboard(M, N, size_table, fig);  % Aggiorna la scacchiera
    end
    if start == 0
        % Se è stato selezionato un pezzo e sono state calcolate le mosse valide
        if ~isempty(selectedRow) && ~isempty(valid_moves)
            % Verifica se la casella cliccata è una delle mosse valide

            if any(ismember([row, col], valid_moves, 'rows'))
                % Movimento in diagonale per la "mangiata"
                if abs(row - selectedRow) == 1 && abs(col - selectedCol) == 1
                    % Verifica se c'è un pezzo avversario da mangiare
                    if turn == 0 && M(size_table - row + 1, col) == 1  % Pezzo nero da mangiare
                        kills(1) = kills(1) + 1;  % Incrementa il numero di pezzi neri mangiati
                        disp_kills();
                        M(size_table - row + 1, col) = -1;  % Il pezzo bianco si sposta qui
                        M(size_table - selectedRow + 1, selectedCol) = 0;  % Libera la casella di partenza
                        turn = 1;  % Passa il turno al nero
                    elseif turn == 1 && M(size_table - row + 1, col) == -1  % Pezzo bianco da mangiare
                        kills(2) = kills(2) + 1;  % Incrementa il numero di pezzi bianchi mangiati
                        disp_kills();
                        M(size_table - row + 1, col) = 1;  % Il pezzo nero si sposta qui
                        M(size_table - selectedRow + 1, selectedCol) = 0;  % Libera la casella di partenza
                        turn = 0;  % Passa il turno al bianco
                    else
                        % Movimento diagonale senza mangiata, permesso solo se la casella è vuota o speciale
                        if M(size_table - row + 1, col) == 0 || N(size_table - row + 1, col) == 1
                            if turn == 0  % Turno del bianco
                                M(size_table - row + 1, col) = -1;  % Sposta il pezzo bianco
                                M(size_table - selectedRow + 1, selectedCol) = 0;  % Libera la vecchia casella
                                turn = 1;  % Passa il turno al nero
                            elseif turn == 1  % Turno del nero
                                M(size_table - row + 1, col) = 1;  % Sposta il pezzo nero
                                M(size_table - selectedRow + 1, selectedCol) = 0;  % Libera la vecchia casella
                                turn = 0;  % Passa il turno al bianco
                            end
                        end
                    end
                else
                    % Movimento orizzontale o verticale (non diagonale)
                    if (turn == 0 && M(size_table - row + 1, col) == 0) || (N(size_table - row + 1, col) == 1)  % Turno del bianco e casella vuota o speciale
                        M(size_table - row + 1, col) = -1;  % Sposta il pezzo bianco
                        M(size_table - selectedRow + 1, selectedCol) = 0;  % Libera la vecchia casella
                        turn = 1;  % Passa il turno al nero
                    elseif (turn == 1 && M(size_table - row + 1, col) == 0) || (N(size_table - row + 1, col) == 1)  % Turno del nero e casella vuota o speciale
                        M(size_table - row + 1, col) = 1;  % Sposta il pezzo nero
                        M(size_table - selectedRow + 1, selectedCol) = 0;  % Libera la vecchia casella
                        turn = 0;  % Passa il turno al bianco
                    else
                        disp('Mossa non valida');
                    end
                end

                % Verifica se la casella di destinazione è una casella speciale (verde)
                if N(size_table - row + 1, col) == 1

                    if turn == 0
                        % Se il turno è del bianco, il pezzo deve rimanere bianco
                        punti(1) = punti(1) + 1;  % Aumenta il punteggio del bianco
                        disp_punteggio();
                        M(size_table - row + 1, col) = -1;  % Assicurati che rimanga bianco
                        [N, M] = move_special_case(M, N, size_table - row + 1, col, size_table, 0);  % Modifica per mantenere il colore corretto
                    elseif turn == 1
                        % Se il turno è del nero, il pezzo deve rimanere nero
                        punti(2) = punti(2) + 1;  % Aumenta il punteggio del nero
                        disp_punteggio();
                        M(size_table - row + 1, col) = 1;  % Assicurati che rimanga nero
                        [N, M] = move_special_case(M, N, size_table - row + 1, col, size_table, 1);  % Modifica per mantenere il colore corretto
                    end

                end

                % Reimposta le variabili
                selectedRow = [];
                selectedCol = [];
                valid_moves = [];

                % delete(fig);
                % createChessBoard(size_table, N, M);

                update_chessboard(M, N, size_table, fig);  % Aggiorna la scacchiera

                return;
            end
        end

        % Verifica se è il turno del giocatore corretto e seleziona il pezzo
        if turn == 0  % Turno del bianco
            if isequal(casellaColor, [1, 1, 1])
                selectedRow = row;
                selectedCol = col;
                selectedColor = [1, 1, 1];  % Memorizza il colore bianco
                flag = 0;

                % Calcola e evidenzia le mosse valide
                valid_moves = calcola_mosse_valide(row, col, size_table, M, N);
            end

        elseif turn == 1  % Turno del nero
            if isequal(casellaColor, [0, 0, 0])
                selectedRow = row;
                selectedCol = col;
                selectedColor = [0, 0, 0];  % Memorizza il colore nero
                flag = 1;

                % Calcola e evidenzia le mosse valide
                valid_moves = calcola_mosse_valide(row, col, size_table, M, N);
            end
        end
    end
end
