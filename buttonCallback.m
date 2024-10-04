function buttonCallback(btn, row, col, size_table, fig, N, M)
    % Usa variabili globali
    global selectedRow selectedCol selectedColor flag punti turn;

    % Ottieni il colore della casella cliccata
    casellaColor = btn.BackgroundColor;

    % Verifica se è il turno del giocatore corretto
    if turn == 0  % Turno del bianco
        % Verifica se la casella è bianca
        if isequal(casellaColor, [1, 1, 1])
            selectedRow = row;
            selectedCol = col;
            selectedColor = [1, 1, 1];  % Memorizza il colore bianco
            flag = 0;  % Casella bianca selezionata

            % Calcola e evidenzia le mosse valide
            valid_moves = calcola_mosse_valide(row, col, size_table, M);
            % evidenzia_mosse(fig, valid_moves, size_table);

        elseif (isequal(casellaColor, [255, 253, 208]/255) || isequal(casellaColor, [213, 188, 162]/255)) && flag == 0
            % Verifica se la mossa è valida
            if ~isempty(selectedRow)
                valid_moves = calcola_mosse_valide(selectedRow, selectedCol, size_table, M);
                if any(ismember([row, col], valid_moves, 'rows'))
                    disp(['Sposto il pezzo bianco dalla posizione (', num2str(selectedRow), ',', num2str(selectedCol), ') alla posizione (', num2str(row), ',', num2str(col), ')']);
                    
                    % Aggiorna la matrice M: Rimuovi il pezzo dalla posizione precedente e spostalo nella nuova
                    M(size_table - row + 1, col) = -1;  % Posiziona il pezzo bianco nella nuova posizione
                    M(size_table - selectedRow + 1, selectedCol) = 0;  % Libera la vecchia posizione
                    
                    flag = 2;  % Reset flag dopo lo spostamento

                    % Cambia turno
                    turn = 1;  % Passa il turno al nero

                    if N(size_table - row + 1, col) == 1 && M(size_table - row + 1, col) == -1
                        disp('Il bianco ha catturato una casella speciale');
                        punti(1) = punti(1) + 1;
                        disp(['Punteggio bianco: ', num2str(punti(1))]);
                        [N,M] = move_special_case(M,N,size_table - row + 1, col,size_table,1);
                    end

                    % Rimuovi la vecchia finestra e ricrea la scacchiera aggiornata
                    delete(fig);  % Elimina la vecchia finestra
                    createChessBoard(size_table, N, M);  % Ricrea la scacchiera aggiornata
                else
                    disp('Mossa non valida');
                end
            end
        end

    elseif turn == 1  % Turno del nero
        % Verifica se la casella è nera
        if isequal(casellaColor, [0, 0, 0])
            selectedRow = row;
            selectedCol = col;
            selectedColor = [0, 0, 0];  % Memorizza il colore nero
            flag = 1;  % Casella nera selezionata

            % Calcola e evidenzia le mosse valide
            valid_moves = calcola_mosse_valide(row, col, size_table, M);
            % evidenzia_mosse(fig, valid_moves, size_table);

        elseif (isequal(casellaColor, [255, 253, 208]/255) || isequal(casellaColor, [213, 188, 162]/255)) && flag == 1
            % Verifica se la mossa è valida
            if ~isempty(selectedRow)
                valid_moves = calcola_mosse_valide(selectedRow, selectedCol, size_table, M);
                if any(ismember([row, col], valid_moves, 'rows'))
                    disp(['Sposto il pezzo nero dalla posizione (', num2str(selectedRow), ',', num2str(selectedCol), ') alla posizione (', num2str(row), ',', num2str(col), ')']);
                    
                    % Aggiorna la matrice M: Rimuovi il pezzo dalla posizione precedente e spostalo nella nuova
                    M(size_table - row + 1, col) = 1;  % Posiziona il pezzo nero nella nuova posizione
                    M(size_table - selectedRow + 1, selectedCol) = 0;  % Libera la vecchia posizione
                    
                    flag = 2;  % Reset flag dopo lo spostamento

                    % Cambia turno
                    turn = 0;  % Passa il turno al bianco

                    if N(size_table - row + 1, col) == 1 && M(size_table - row + 1, col) == 1
                        disp('Il nero ha catturato una casella speciale');
                        punti(2) = punti(2) + 1;
                        disp(['Punteggio nero: ', num2str(punti(2))]);

                        [N,M] = move_special_case(M,N,size_table - row + 1, col,size_table,0);
                    end

                    % Rimuovi la vecchia finestra e ricrea la scacchiera aggiornata
                    delete(fig);  % Elimina la vecchia finestra
                    createChessBoard(size_table, N, M);  % Ricrea la scacchiera aggiornata
                else
                    disp('Mossa non valida');
                end
            end
        end
    end
end
