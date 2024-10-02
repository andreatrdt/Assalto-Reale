function [x , y] = auxiliary_cerca_casella(M,size_table)

%% auxiliary_cerca_casella(M,size_table)
% This function finds a cell in the matrix M that is at distance less than 2
% from the barycenter of the matrix. It returns the coordinates of the cell.

% INPUT
% M: the matrix
% size_table: the size of the matrix

% OUTPUT
% x: the x coordinate of the cell
% y: the y coordinate of the cell

    % Inizializza il flag
    flag = 0;


    % Calcola la massa totale
    M_totale = sum(M(:));

    % Inizializza le somme pesate per le coordinate del baricentro
    x_bar_sum = 0;
    y_bar_sum = 0;

    % Cicla attraverso tutti gli elementi della matrice per calcolare il numeratore delle coordinate
    for i = 1:size_table
        for j = 1:size_table
            x_bar_sum = x_bar_sum + i * M(i,j);  % Somma pesata delle righe
            y_bar_sum = y_bar_sum + j * M(i,j);  % Somma pesata delle colonne
        end
    end

    % Calcola le coordinate del baricentro
    x = round( x_bar_sum / M_totale );
    y = round( y_bar_sum / M_totale );

    x = size_table - x + 1;
    y = size_table - y + 1;

    count = 0;

    while flag == 0

        % Calcola la distanza euclidea tra la casella speciale e ogni cella della matrice
        d = calcola_distanza(M,size_table,x,y);
        
        for i = 1:size_table
            for j = 1:size_table
                
                if d(i,j) == 1 && M(i,j) == 0
                    count = count + 1;
                end

                if d(i,j) == 0 && M(i,j) == 0
                    count = count + 1;
                end

            end
        end

        if count ~= 9
            count = 0;
            
            % extract a number between 1 and 2
            n = randi(2);

            if n==1 && x > 1 && y > 1 && x < size_table && y < size_table
                x = x + 1;
                y = y + 1;

            else
                x = x - 1;
                y = y - 1;

            end

        else 
            flag = 1;
        end

    end

end