function [N,M] = cerca_casella(size_table,N,M,N_special)

for i = 1 : N_special

    [x_bar, y_bar] = auxiliary_cerca_casella(M,size_table);

    N(x_bar,y_bar) = 1;

    M(x_bar,y_bar) = 10;

end


%% NOTA IDEA:

% tieni conto delle mosse dei pedoni
% pedoni mangiati se catturi casella vengono liberati