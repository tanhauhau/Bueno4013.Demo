function setupNumeric(input, max){
    $(input).numeric({
        allowMinus   : false,
        allowThouSep : false,
        allowDecSep  : false,
        max: max,
    });
}
function setupRange(range, display){
    $(range).range({
        min: 0,
        max: 100,
        start: 0,
        onChange: function(value) {
            $(display).html(value);
        }
    });
}
