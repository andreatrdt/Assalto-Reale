% clear workspace and command window
clc
clear all
close all   
close all force


% Variabili globali per tenere traccia della selezione
global punti turn kills start Q;


punti = [0 ,0];
turn = 1;
kills = [0, 0];

% Set the seed for the random number generator
rng(42)
tic

% Definisci la dimensione della matrice
size_table = 14; 



% Definisci il numero di caselle speciali
N_special = 3; 

N = zeros(size_table,size_table);

%% MAIN
start = 1;
% Genera la matrice
[M,N,Q] = generate_table(size_table);



% genera scacchiera
disp_punteggio();
disp_kills();
createChessBoard(size_table,N,M);

toc