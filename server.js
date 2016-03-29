var app = require('express')();
var http = require('http').Server(app);
var pty = require('pty.js');
var io = require('socket.io')(http);

io.on('connection', function(socket){
    console.log('a user connected');
    // Create terminal
    var term = pty.spawn('bash', [], {
        name: 'xterm',
        cols: 80,
        rows: 30,
        cwd: process.cwd(),
        env: process.env,
        // cwd: __dirname, //process.env.HOME,
    });
    // Listen on the terminal for output and send it to the client
    term.on('data', function(data){
        console.log('output: ' + data);
        socket.emit('output', data);
    });
    // Listen on the client and send any input to the terminal
    socket.on('input', function(data){
        console.log('input: ' + data);
        term.write(data);
    });
    // When socket disconnects, destroy the terminal
    socket.on("disconnect", function(){
        term.destroy();
        console.log("bye");
    });
    console.log(term);
    term.write("echo 'A'");
});

app.get('/', function(req, res){
    res.sendFile(__dirname + '/index.html');
});

http.listen(8000, function(){
    console.log('listening on *:8000');
});
