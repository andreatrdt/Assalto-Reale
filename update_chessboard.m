function update_chessboard(M, N, size_table, fig)

    % Ricrea la scacchiera aggiornata
    squareSize = fig.Position(3) / size_table;

    for row = 1:size_table
        for col = 1:size_table
            % Determina il colore della casella (bianco o nero)
            if mod(row + col, 2) == 0
                color = [255, 253, 208]/255;  % Bianco
            else
                color = [213, 188, 162]/255;  % Nero
            end
            
            % Matrice M: controlla se c'è un pezzo bianco o nero
            if M(size_table - row + 1, col) == 1
                color = [0, 0, 0];  % Nero
                
            elseif M(size_table - row + 1, col) == -1
                color = [1, 1, 1];  % Bianco
            end

            
            if M(size_table - row + 1, col) == 5
                color = [1, 0, 0]; 
            elseif  M(size_table - row + 1, col) == 10
                color = [0, 1, 0];  
            end

            % Crea un pulsante per ogni casella della scacchiera
            btn = uibutton(fig, 'push', 'BackgroundColor', color, ...
                'Position', [(col - 1) * squareSize, (row - 1) * squareSize, squareSize, squareSize], ...
                'Text', '', ...
                'ButtonPushedFcn', @(btn, event) buttonCallback(btn, row, col, size_table, fig, N, M));
        end
    end


    % delete(fig);
    % createChessBoard(size_table, N, M);