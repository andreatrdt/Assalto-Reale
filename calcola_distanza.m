function d = calcola_distanza(size_table,x_bar,y_bar)

%% calcola_distanza(M,size_table,x_bar,y_bar)
% This function calculates the euclidean distance between the barycenter and
% each cell of the matrix M. It returns a matrix d of the same size of M
% where the cells at distance less than 2 from the barycenter are set to 1
% and the others to 0.

% INPUT
% M: the matrix
% size_table: the size of the matrix
% x_bar: the x coordinate of the barycenter
% y_bar: the y coordinate of the barycenter

% OUTPUT
% d: the matrix of distances

     % Calcola la distanza euclidea tra il baricentro e ogni cella della matrice
     d = zeros(size_table,size_table);
     for i = 1:size_table
         for j = 1:size_table
             
            d(i,j) = sqrt((i - x_bar)^2 + (j - y_bar)^2);
             
         end
     end
 
     % Trova le celle a distamza minore di 2 dal baricentro
 
     for i = 1:size_table
         for j = 1:size_table
             if d(i,j) < 2 && d(i,j) > 0
                 d(i,j) = 1;
             end
             d(i,j) = round(d(i,j));
         end
     end

    %  figure
    %  heatmap(d, 'Colormap', [1 1 1; 0 0 0; 1 0 0; 0 0 1], 'ColorLimits', [0 3]);

end