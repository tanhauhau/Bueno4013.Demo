var app = require('express')();
var http = require('http').Server(app);
var pty = require('pty.js');
var io = require('socket.io')(http);
var shortid = require('shortid');
var bodyParser = require('body-parser');
var shell = require('shelljs');
var ip = require('ip');
var getPort = require('get-port');
var sprintf = require('sprintf');
var path = require('path');

app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));

var sessions = {};

function startClientSocket(id){
    if(!sessions[id])   return;
    io.of('/client/' + id)
    .on('connection', function(socket){
        //join in a separate random room
        var roomid = shortid.generate();
        socket.join(roomid);
        //set up
        var rootFolder = 'session/' + id + '/';
        var folder = rootFolder + 'client/' + roomid + '/';
        shell.mkdir('-p', folder);
        //start terminal
        var clientTerm = pty.spawn('/bin/bash', [], {
            name: 'xterm',
            cols: 80,
            rows: 30,
            cwd: "java",
            env: process.env,
        });
        //start server
        var absolutePath = path.resolve(__dirname, folder);
        var command = sprintf('java -jar Client.jar -ip %s -p %d -t 30 -cf 3 -f %s -i false\n', ip.address(), sessions[id].port, absolutePath);
        clientTerm.write(command);
        //terminal -> socket
        var exitTest = /bash-.*\$/;
        var nineTest = /99/;
        var ninetynine = false;
        clientTerm.on('data', function(data){
            if(exitTest.test(data)){
                if (ninetynine) {
                    socket.emit('leave', 'leave');
                }
            }else{
                socket.emit('client', data);
                if (nineTest.test(data)) {
                    ninetynine = true;
                }else{
                    ninetynine = false;
                }
            }
        });
        //socket -> terminal
        socket.on('input', function(data){
            clientTerm.write(data + "\n");
        });
        //destroy
        socket.on("disconnect", function(){
            clientTerm.destroy();
            shell.rm('-rf', folder);
            if(sessions[id]) delete sessions[id]['client'][roomid];
        });
        sessions[id]['client'][roomid] = 'true';
    });
}
function startServerSocket(id, params, cb){
    try{
        getPort().then(function(port){
            io.of('/server/' + id)
            .on('connection', function(socket){
                //set up
                var rootFolder = 'session/' + id + '/';
                var folder = rootFolder + 'server/';
                shell.mkdir('-p', folder);
                shell.cp('data/*', folder);
                //create terminal
                var serverTerm = pty.spawn('/bin/bash', [], {
                    name: 'xterm',
                    cols: 80,
                    rows: 30,
                    cwd: "java",
                    env: process.env,
                });
                //start server
                var absolutePath = path.resolve(__dirname, folder);
                var command = sprintf('java -jar Server.jar -p %d -iv %s -f %s\n', port, params.iv, absolutePath);
                serverTerm.write(command);
                serverTerm.on('data', function(data){
                    socket.emit('server', data);
                });
                //socket end
                socket.on("disconnect", function(){
                    serverTerm.destroy();
                    shell.rm('-rf', rootFolder);
                    io.of('/client/' + id).emit('leave', 'leave');
                    delete sessions[id];
                });
                //record
                sessions[id] = {
                    port: port,
                    client: {}
                };
                //start client socket
                startClientSocket(id);
            });
            cb();
        }, function(){
            cb("no port");
        });
    }catch(e){
        cb("error");
    }
}

app.get('/', function(req, res){
    res.sendFile(__dirname + '/index.html');
});
app.get('/client/:id', function(req, res){
    if (sessions[req.params.id]) {
        res.sendFile(__dirname + '/client.html');
    }else{
        res.status(500);
        res.send('error');
    }
});
app.post('/server/create', function(req, res){
    var id = shortid.generate();
    startServerSocket(id, req.body, function(error){
        if (error) {
            res.status(500);
            res.send('');
        }else{
            res.send(id);
        }
    });
});

http.listen(8000, function(){
    console.log('listening on *:8000');
});
