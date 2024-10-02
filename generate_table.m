function [M] = generate_table(size_table)
%% generate_table(size_table)
% This function generates a table of size size_table x size_table with 0s
% and 1s. The 1s represent the pedestrians and the 5s represent the Re.

% INPUT
% size_table: the size of the table

% OUTPUT
% M: the table


    M = zeros(size_table,size_table);

    number_of_pieces = 12;

    % pedoni

    for i = 1:number_of_pieces
        x = randi(size_table);
        y = randi(size_table);
        while M(x,y) ~= 0
            x = randi(size_table);
            y = randi(size_table);
        end
        M(x,y) = 1;
    end

    % estraiamo due caselle in cui ci sono gli zeri e definiamo le posizioni dei Re
    x = 1;
    y = 1;

    while M(x,y) ~= 0
        x = randi(size_table);
        y = randi(size_table);
    end

    M(x,y) = 5;

    x = 1;
    y = 1;

    while M(x,y) ~= 0
        x = randi(size_table);
        y = randi(size_table);
    end

    M(x,y) = 5;

    % figure
    % heatmap(M, 'Colormap', [1 1 1; 0 0 0; 1 0 0; 0 0 1], 'ColorLimits', [0 3]);
    
end