% clear workspace and command window
clc
clear all
close all

% Variabili globali per tenere traccia della selezione
global selectedRow selectedCol selectedColor flag;

% Set the seed for the random number generator
rng(42)
tic

% Definisci la dimensione della matrice
size_table = 14; 

% Genera la matrice
M = generate_table(size_table);

% Definisci il numero di caselle speciali
N_special = 3; 

N = zeros(size_table,size_table);

[N,M] = cerca_casella(size_table,N,M,N_special);

createChessBoard(size_table,N,M)


toc