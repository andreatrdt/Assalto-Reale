function valid_moves = calcola_mosse_valide(row, col, size_table, M,N)
    % Calcola le mosse valide per un pezzo nella posizione (row, col)
    valid_moves = [];

    % Definisci i possibili spostamenti (8 direzioni: su, giù, sinistra, destra, diagonali)
    directions = [-1, -1; -1, 0; -1, 1; 0, -1; 0, 1; 1, -1; 1, 0; 1, 1];
    
    % Loop su tutte le direzioni
    for i = 1:size(directions, 1)
        newRow = row + directions(i, 1);
        newCol = col + directions(i, 2);

        % Verifica che la mossa sia all'interno della scacchiera
        if newRow >= 1 && newRow <= size_table && newCol >= 1 && newCol <= size_table
            % Verifica che la casella sia vuota o contenga un pezzo avversario
            %if M(size_table - newRow + 1, newCol) == 0  % Casella vuota
            valid_moves = [valid_moves; newRow, newCol];
            % end
        end
    end
end
