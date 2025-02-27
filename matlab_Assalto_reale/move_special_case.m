function [N,M] = move_special_case(M,N,last_moved_x,last_moved_y,size_table,flag_white)

    if flag_white == 0
        N(last_moved_x,last_moved_y)=0;
        M(last_moved_x,last_moved_y)=1;

    elseif flag_white == 1

        N(last_moved_x,last_moved_y)=0;
        M(last_moved_x,last_moved_y)=-1;
    end
    
    [x,y] = auxiliary_cerca_casella(M,size_table);

    N(x,y)=1;
    M(x,y)=10;

end

