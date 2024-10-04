function evidenzia_mosse(fig, valid_moves, size_table)
    % Evidenzia le caselle valide
    for i = 1:size(valid_moves, 1)
        row = valid_moves(i, 1);
        col = valid_moves(i, 2);

        % Cambia il colore della casella evidenziata
        uibutton(fig, 'push', 'BackgroundColor', [0, 1, 0], ...  % Verde per indicare mossa valida
            'Position', [(col - 1) * (fig.Position(3) / size_table), (row - 1) * (fig.Position(3) / size_table), ...
            (fig.Position(3) / size_table), (fig.Position(3) / size_table)], 'Text', '');
    end

end
