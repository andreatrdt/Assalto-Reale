function buttonCallback(btn, row, col, size_table, fig, N, M)
    % Usa variabili globali
    global selectedRow selectedCol selectedColor flag punti;

    % Ottieni il colore della casella cliccata
    casellaColor = btn.BackgroundColor;

    % Verifica se la casella è bianca
    if isequal(casellaColor, [1, 1, 1])
        disp('Hai selezionato una casella bianca');
        selectedRow = row;
        selectedCol = col;
        selectedColor = [1, 1, 1];  % Memorizza il colore bianco
        flag = 0;  % Casella bianca selezionata

    elseif isequal(casellaColor, [255, 253, 208]/255) || isequal(casellaColor, [213, 188, 162]/255) || isequal(casellaColor, [0 , 1, 0]) && flag == 0
        % Verifica se è stato selezionato un pezzo bianco
        if ~isempty(selectedRow)
            disp(['Sposto il pezzo bianco dalla posizione (', num2str(selectedRow), ',', num2str(selectedCol), ') alla posizione (', num2str(row), ',', num2str(col), ')']);
            % Aggiorna la matrice M
            M(size_table - row + 1, col) = -1;  % Metti il pezzo bianco nella nuova posizione
            M(size_table - selectedRow + 1, selectedCol) = 0;  % Rimuovi il pezzo dalla posizione originale
            flag = 2;  % Reset flag dopo lo spostamento

            if N(size_table - row + 1, col) == 1 && M(size_table - row + 1, col) == -1
                disp('Il bianco ha catturato una casella speciale');
                punti(1) = punti(1) + 1;
                disp(punti);
                [N,M] = move_special_case(M,N,size_table - row + 1, col,size_table,1);
            end

            % Rimuovi la vecchia finestra e ricrea la scacchiera aggiornata
            delete(fig);  % Elimina la vecchia finestra
            createChessBoard(size_table, N, M);  % Ricrea la scacchiera aggiornata
        end
    end



    % Verifica se la casella è nera
    if isequal(casellaColor, [0, 0, 0])
        disp('Hai selezionato una casella nera');
        selectedRow = row;
        selectedCol = col;
        selectedColor = [0, 0, 0];  % Memorizza il colore nero
        flag = 1;  % Casella bianca selezionata

    elseif isequal(casellaColor, [255, 253, 208]/255) || isequal(casellaColor, [213, 188, 162]/255) || isequal(casellaColor, [0 , 1, 0]) && flag == 1
        % Verifica se è stato selezionato un pezzo nero
        if ~isempty(selectedRow)
            disp(['Sposto il pezzo nero dalla posizione (', num2str(selectedRow), ',', num2str(selectedCol), ') alla posizione (', num2str(row), ',', num2str(col), ')']);
            % Aggiorna la matrice M
            M(size_table - row + 1, col) = 1;  % Metti il pezzo nero nella nuova posizione
            M(size_table - selectedRow + 1, selectedCol) = 0;  % Rimuovi il pezzo dalla posizione originale
            flag = 2;  % Reset flag dopo lo spostamento

            if N(size_table - row + 1, col) == 1 && M(size_table - row + 1, col) == 1
                disp('Il nero ha catturato una casella speciale');
                punti(2) = punti(2) + 1;
                disp(punti);

                [N,M] = move_special_case(M,N,size_table - row + 1, col,size_table,0);
            end

            % Rimuovi la vecchia finestra e ricrea la scacchiera aggiornata
            delete(fig);  % Elimina la vecchia finestra
            createChessBoard(size_table, N, M);  % Ricrea la scacchiera aggiornata
        end
end