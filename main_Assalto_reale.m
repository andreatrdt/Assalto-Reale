% clear workspace and command window
clc
clear all
close all   
close all hidden 


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
start = 1;


% Definisci il numero di caselle speciali
N_special = 3; 

N = zeros(size_table,size_table);

%% MAIN

% Genera la matrice
[M,N,Q] = generate_table(size_table);

%% genera caselle speciali
% [N,M] = cerca_casella(size_table,N,M,N_special);

% genera scacchiera
disp_punteggio();
disp_kills();
createChessBoard(size_table,N,M);

toc