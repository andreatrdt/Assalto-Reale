function disp_punteggio()

    global punti;


     % Creazione della finestra (UI figure)
     fig = uifigure('Name', '', 'Position', [100 100 300 200]);

     % Creazione di un pannello per visualizzare il punteggio con uno sfondo colorato
     pnl = uipanel(fig, 'Title', 'Punteggio', 'Position', [50 50 200 130], 'BackgroundColor', [0.8 0.8 0.8]);

    % Aggiunta di etichette per il punteggio con un layout migliorato e colori

    % Punteggio del bianco (etichetta e valore)
    lbl_white = uilabel(pnl, 'Text', 'Nero:', 'Position', [10 80 60 30], ...
                        'FontSize', 14, 'FontWeight', 'bold', 'FontColor', [0 0 0]); % Colore nero per il nero
    lbl_white_score = uilabel(pnl, 'Text', num2str(punti(2)), 'Position', [120 80 50 30], ...
                              'FontSize', 14, 'FontWeight', 'bold', 'FontColor', [0 0 0]);

    % Punteggio del nero (etichetta e valore)
    lbl_black = uilabel(pnl, 'Text', 'Bianco:', 'Position', [10 40 60 30], ...
                        'FontSize', 14, 'FontWeight', 'bold', 'FontColor', [1 1 1]); % Colore bianco per il bianco
    lbl_black_score = uilabel(pnl, 'Text', num2str(punti(1)), 'Position', [120 40 50 30], ...
                              'FontSize', 14, 'FontWeight', 'bold', 'FontColor', [1 1 1]);

    % Aggiunta di un pulsante per chiudere il pannello, con posizione centrata
    btn_close = uibutton(pnl, 'push', 'Text', 'Chiudi', 'Position', [60 10 80 30], ...
                         'FontSize', 12, 'ButtonPushedFcn', @(btn, event) delete(pnl));

end
