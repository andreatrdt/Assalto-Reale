function createChessBoard(size_table, N, M)
    % Inizializza variabili globali
    global selectedRow selectedCol selectedColor flag;
    selectedRow = [];
    selectedCol = [];
    selectedColor = [];
    flag = 2;  % Valore di default, nessuna casella selezionata

    % Crea una finestra UIFigure
    fig = uifigure('Name', 'Scacchiera', 'Position', [100 100 500 500]);

    % Calcolo la dimensione di ciascuna casella in base alla dimensione della finestra e della tabella
    squareSize = fig.Position(3) / size_table;

    % Creazione delle caselle della scacchiera con pulsanti
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
end
