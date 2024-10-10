function [M,N,Q] = generate_table(size_table)
%% generate_table(size_table)
% This function generates a table of size size_table x size_table with 0s
% and 1s. The 1s represent the pedestrians and the 5s represent the Re.

% INPUT
% size_table: the size of the table

% OUTPUT
% M: the table


    M = zeros(size_table,size_table);
    N = zeros(size_table,size_table);

    number_of_pieces = 12;

    % pedoni

    for i = 1:3
        x = randi(size_table);
        y = randi(size_table);

        M(x,y) = 10;
        N(x,y) = 1;
    end

      % for i = 1:number_of_pieces/2
    %     x = randi(size_table);
    %     y = randi(size_table);
    %     while M(x,y) ~= 0
    %         x = randi(size_table);
    %         y = randi(size_table);
    %     end
    %     M(x,y) = 1;
    % 

    % for i = 1:number_of_pieces/2
    %     x = randi(size_table);
    %     y = randi(size_table);
    %     while M(x,y) ~= 0
    %         x = randi(size_table);
    %         y = randi(size_table);
    %     end
    %     M(x,y) = -1;
    % end

    % estraiamo due caselle in cui ci sono gli zeri e definiamo le posizioni dei Re
    x = 1;
    y = 1;

    while M(x,y) ~= 0
        x = randi(size_table);
        y = randi(size_table);
    end

    % M(x,y) = 5;

    % x = 1;
    % y = 1;

    % while M(x,y) ~= 0
    %     x = randi(size_table);
    %     y = randi(size_table);
    % end

    % M(x,y) = 5;

    % figure
    % heatmap(M, 'Colormap', [1 1 1; 0 0 0; 1 0 0; 0 0 1], 'ColorLimits', [0 3]);

    % Supponiamo di avere una matrice M di dimensione m x n
[m, n] = size(M);

% Inizializziamo Q a una matrice di zeri di dimensione m x n
Q = zeros(size_table, size_table);

% Scorriamo tutti gli elementi di M
for i = 1:size_table
    for j = 1:size_table
        % Se M(i, j) è diverso da zero
        if N(i, j) ~= 0
            % Impostiamo a 1 le celle intorno a (i, j) nella matrice Q
            for a = -1:1
                for b = -1:1
                    % Controlliamo che (i+a, j+b) sia dentro i limiti della matrice
                    if i+a >= 1 && i+a <= m && j+b >= 1 && j+b <= n
                        Q(i+a, j+b) = 1;
                    end
                end
            end
        end
    end
end

    
end