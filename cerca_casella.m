function [N,M] = cerca_casella(size_table,N,M,N_special)

for i = 1 : N_special

    [x_bar, y_bar] = auxiliary_cerca_casella(M,size_table);

    N(x_bar,y_bar) = 1;

    M(x_bar,y_bar) = 10;

end


%% Algoritmo per spostare la casella speciale se ci finisce sopra un pedone
% tieni conto delle mosse del pedone ( COSA A PARTE)

% last_moved_x = x_bar;
% last_moved_y = y_bar;



% if N(last_moved_x,last_moved_y) == 1

%     N(last_moved_x,last_moved_y)=0;
%     M(last_moved_x,last_moved_y)=1;
    
%     [x,y] = auxiliary_cerca_casella(M,size_table);

%     N(x,y)=1;
%     M(x,y)=10;

% end


%% NOTA IDEA:

% pedoni mangiati se catturi casella vengono liberati