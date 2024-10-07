function disp_punteggio(punti)


    fig = uifigure('Name', 'Scacchiera', 'Position', [100 100 500 500]);

    % crea un pannello per visualizzare il punteggio
    pnl = uipanel(fig, 'Title', 'Punteggio', 'Position', [10 10 100 100]);

    % aggiungi etichette per il punteggio

    % punteggio del bianco
    lbl_white = uilabel(pnl, 'Text', 'Bianco:', 'Position', [10 70 50 20]);
    lbl_white_score = uilabel(pnl, 'Text', num2str(punti(1)), 'Position', [60 70 50 20]);

    % punteggio del nero
    lbl_black = uilabel(pnl, 'Text', 'Nero:', 'Position', [10 40 50 20]);
    lbl_black_score = uilabel(pnl, 'Text', num2str(punti(2)), 'Position', [60 40 50 20]);

    % aggiungi un pulsante per chiudere il pannello
    btn_close = uibutton(pnl, 'push', 'Text', 'Chiudi', 'Position', [10 10 80 20], 'ButtonPushedFcn', @(btn, event) delete(pnl));


end