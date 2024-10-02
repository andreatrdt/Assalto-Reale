function createChessBoard(size_table)
    % Crea una finestra UIFigure
    fig = uifigure('Name', 'Scacchiera', 'Position', [100 100 500 500]);

    % Calcolo la dimensione di ciascuna casella in base alla dimensione della finestra e della tabella
    squareSize = fig.Position(3) / size_table;

    % Creazione delle caselle della scacchiera
    for row = 1:size_table
        for col = 1:size_table
            % Determina il colore della casella: bianco o nero
            if mod(row + col, 2) == 0
                color = [1, 1, 1];  % Bianco
            else
                color = [0, 0, 0];  % Nero
            end

            % Posiziona un pannello per ogni casella della scacchiera
            uipanel(fig, 'BackgroundColor', color, ...
                'Position', [(col - 1) * squareSize, (row - 1) * squareSize, squareSize, squareSize]);
        end
    end
end

% Funzione callback per le caselle (pulsanti) - opzionale se vuoi l'interattività
function buttonCallback(btn)
    % Cambia il colore della casella cliccata come esempio di interazione
    if isequal(btn.BackgroundColor, [1, 1, 1]) % Se è bianco
       
    end
end