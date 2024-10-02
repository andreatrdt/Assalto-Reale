% clear workspace and command window
clc
clear all
close all

% Set the seed for the random number generator
rng(42)
tic

% Definisci la dimensione della matrice
size_table = 12; 

% Genera la matrice
M = generate_table(size_table);

% Definisci il numero di caselle speciali
N_special = 3; 

N = zeros(size_table,size_table);

for i = 1 : N_special

    [x_bar, y_bar] = auxiliary_cerca_casella(M,size_table);

    N(x_bar,y_bar) = 1;

    M(x_bar,y_bar) = 10;

end


% Visualizza la matrice
figure
heatmap(M, 'Colormap', [1 1 1; 0 0 0; 1 0 0; 0 0 1], 'ColorLimits', [0 3]);
figure
heatmap(N, 'Colormap', [1 1 1; 0 0 0; 1 0 0; 0 0 1], 'ColorLimits', [0 3]);


%% Algoritmo per spostare la casella speciale se ci finisce sopra un pedone
% tieni conto delle mosse del pedone ( COSA A PARTE)

last_moved_x = 6;
last_moved_y = 6;



if N(last_moved_x,last_moved_y) == 1

    N(last_moved_x,last_moved_y)=0;
    M(last_moved_x,last_moved_y)=1;

    figure
    heatmap(M, 'Colormap', [1 1 1; 0 0 0; 1 0 0; 0 0 1], 'ColorLimits', [0 3]);
    
    [x,y] = auxiliary_cerca_casella(M,size_table);

    N(x,y)=1;
    M(x,y)=10;

end


% Visualizza la matrice


figure
heatmap(M, 'Colormap', [1 1 1; 0 0 0; 1 0 0; 0 0 1], 'ColorLimits', [0 3]);
figure
heatmap(N, 'Colormap', [1 1 1; 0 0 0; 1 0 0; 0 0 1], 'ColorLimits', [0 3]);

toc

%% NOTA IDEA:

% pedoni mangiati se catturi casella vengono liberati