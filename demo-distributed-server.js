var express = require('express');
var app = express();
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
app.use('/static', express.static('static'));

var sessions = {};

function clean(val, max){
    return Math.min(max || 100, Math.max(0, (parseInt(val || "") || 0)));
}

function recordNewClient(cid, params){
    var sid = params.id;
    var timeout = params.timeout;
    var cf = params.cf;
    var lag = params.lag;
    var send = params.send;
    var recv = params.recv;
    var gib = params.gib;
    var info = (params.info == 'true');

    if (!sessions[sid]) {
        return false;
    }
    sessions[sid]['client'][cid] = {
        timeout: clean(timeout, 240),
        cf: clean(cf, 60),
        lag: clean(lag, 240),
        send: clean(send) / 100.0,
        recv: clean(recv) / 100.0,
        gib: clean(gib) / 100.0,
        info: info,
    };
    return true;
}

function startClientSocket(id){
    if(!sessions[id])   return;
    io.of('/client/' + id)
    .on('connection', function(socket){
        var started = false;
        var roomid = '';
        var folder, clientTerm;
        socket.on("joinid", function(data){
            if(!sessions[id]){
                socket.emit('leave', 'leave');
                return;
            }
            roomid = data;
            socket.join(roomid);
            //set up
            var rootFolder = 'session/' + id + '/';
            folder = rootFolder + 'client/' + roomid + '/';
            shell.mkdir('-p', folder);
            //start terminal
            clientTerm = pty.spawn('/bin/bash', [], {
                name: 'xterm',
                cols: 80,
                rows: 30,
                cwd: "java",
                env: process.env,
            });

            var param = sessions[id]['client'][roomid];
            //start client
            var absolutePath = path.resolve(__dirname, folder);
            var command = sprintf('java -jar Client.jar -ip %s -p %d -t 30 -cf 3 -f %s -t %d -cf %d -l %d -s %f -r %f -g %f -i %s\n', ip.address(), sessions[id].port, absolutePath, param.timeout, param.cf, param.lag, param.send, param.recv, param.gib, (!!param.info)?"true":"false");
            clientTerm.write(command);
            //terminal -> socket
            var exitTest = /[\$\#]/;
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
            started = true;
        });
        //socket -> terminal
        socket.on('input', function(data){
            if (!started) return;
            var inchar = data.split("");
            var outchar = [];
            var blacklist = '!@#$%^&*()+=[]\\\';/{}|":<>?~`-_'
            for(var i=0; i<inchar.length; i++){
                var c = inchar[i];
                if(blacklist.indexOf(c) < 0){
                    outchar.push(c);
                }
            }
            data = outchar.join("");
            clientTerm.write(data + "\n");
        });
        //destroy
        socket.on("disconnect", function(){
            if (!started) return;
            clientTerm.destroy();
            shell.rm('-rf', folder);
            if(sessions[id]) delete sessions[id]['client'][roomid];
        });
        //initialize
        socket.emit("joinid", "joinid");
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
                var lag = clean(params.lag, 240);
                var gib = clean(params.gib) / 100.0;
                var send = clean(params.send) / 100.0;
                var command = sprintf('java -jar Server.jar -p %d -iv %s -f %s -l %d -g %f -s %f\n', port, params.iv, absolutePath, lag, gib, send);
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
    res.sendFile(__dirname + '/server.html');
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
app.post('/client/create', function(req, res){
    var cid = shortid.generate();
    if(recordNewClient(cid, req.body)){
        res.send(cid);
    }else{
        res.status(500);
        res.send('');
    }
});

http.listen(8000, function(){
    console.log('listening on *:8000');
});
