require('dotenv').config();
var nanoID = require('nanoid');
const PORT = process.env.PORT;
const io = require('socket.io')(PORT);
const GAMESERVERPASSWORD = process.env.PSWORD;
var hasGameServer = false;
var GameServerCount = 0;
const TeamCount = 6;
var GameServers = [];
var MatchMaking = [];
function Server(position, id, status) {
    this.position = position;
    this.id = id;
    this.status = status;
}

const Status = { FULL: 1, OPEN: 2, LATER: 3 };
function CheckMatchMaking() {
    if (MatchMaking.length < 2)
        return;

    let RequestGame = {
        BlueTeam: MatchMaking.pop(),
        RedTeam: MatchMaking.pop(),
        RoomName: nanoID.nanoid()
    }
    let sid = -1;
    for (var n in GameServers) {
        if (GameServers[n].status == Status.OPEN) {
            sid = n;
            break;
        }
    }
    //Have game
    if (sid != -1) {
        console.log(GameServers[sid].id);
        io.to(GameServers[sid].id).emit('RequestGame', { RequestGame: RequestGame });
        console.log("Requesting Game");
    } else {
        //No game available
        io.to(RequestGame.BlueTeam).to(RequestGame.RedTeam).emit('ServerHostError');
    }
}
StartServer();
async function StartServer() {
    //let MatchMakingInterval = setInterval(() => {
    //    CheckMatchMaking();
    //}, 1000);
    io.on('connection', Connect);
    console.log("Started Server");
}

function SetGameServerFull(id) {
    for(let n in GameServers) {
        if (GameServers[n].id == id) {
            GameServers[n].status = FULL;
            break;
        }
    }
}

function SetGameServerOpen(id) {
    for(let n in GameServers) {
        if (GameServers[n].id == socket.id) {
            GameServers[n].status = OPEN;
            break;
        }
    }
}

function PutIntoMatchMaking(BlueTeam, RedTeam) {
    if (io.sockets.connected[BlueTeam])
        MatchMaking.unshift(BlueTeam);
    if (io.sockets.connected[RedTeam])
        MatchMaking.unshift(RedTeam);
}

function RegisterGameBetween(BlueTeam, RedTeam, RoomName) {
    io.sockets.connected[BlueTeam].currentGame = RoomName;
    io.sockets.connected[BlueTeam].currentEnemy = RedTeam;
    io.sockets.connected[BlueTeam].playAgain = false;
    io.sockets.connected[BlueTeam].responded = false;
    io.sockets.connected[BlueTeam].join(RoomName);

    io.sockets.connected[RedTeam].currentGame = RoomName;
    io.sockets.connected[RedTeam].currentEnemy = BlueTeam;
    io.sockets.connected[RedTeam].playAgain = false;
    io.sockets.connected[RedTeam].responded = false;
    io.sockets.connected[RedTeam].join(RoomName);
}

function Connect(socket) {
    let isGameServer = false;
    let username;
    let selected = [false, false, false, false, false, false];
    let inGame = false;
    let lookingForGame = false;
    socket.on('RegisterGameServer', ({ APIKEY }) => {
        console.log(APIKEY)
        if (APIKEY == GAMESERVERPASSWORD) {
            isGameServer = true;
            hasGameServer = true;
            GameServerCount++;
            //This assumes never disconnecting
            gs = new Server(GameServers.length, socket.id, Status.OPEN);
            GameServers.push(gs);

            console.log(`Game Server Registered. Game Server Count ${GameServerCount}`);

            socket.on('AskPlayAgain', ({ BlueTeam, RedTeam, RoomName }) => {
                socket.broadcast.to(RoomName).emit('PlayAgain');
                //At this point we will no longer know anything about this
            });

            socket.on('GameOver', ({ BlueTeam, RedTeam, RoomName }) => {
                //We want the option to replay
                io.sockets.clients(RoomName).forEach(() => s.leave(RoomName));
                io.to(BlueTeam).to(RedTeam).emit('GameOver');
                selection = [false, false, false, false, false, false];
            });
            
            socket.on('OpenServer', () => {
                SetGameServerOpen(socket.id);
                console.log("GameServer requesting opening");
            });

            //Called when GameServer is Full Also called during closing of everyone passed to us
            socket.on('GameClosed', ({ BlueTeam, RedTeam, RoomName }) => {
                if (RedTeam && BlueTeam)
                    PutIntoMatchMaking(BlueTeam, RedTeam);
                SetGameServerFull(socket.id);
                console.log("GameServer requesting closure.");
            });

            socket.on('GameRegistered', ({ BlueTeam, RedTeam, RoomName }) => {
                if (io.sockets.connected[BlueTeam] && io.sockets.connected[RedTeam]) {
                    RegisterGameBetween(BlueTeam, RedTeam, RoomName);
                    socket.join(RoomName);
                    io.to(BlueTeam).to(RedTeam).emit('InGame');
                } else {
                    PutIntoMatchMaking(BlueTeam, RedTeam);
                    socket.emit('CancelGame', ({RoomName}));
                    CheckMatchMaking();
                }
            });

            socket.emit('RegisteredAsGameServer');
        } else {
            console.log(`Game Server Attempt Incorrect password`);
            socket.disconnect(true);
            return;
        }
    });

    function isString(value) {
        return typeof value === 'string' || value instanceof String;
    }

    socket.on('RegisterPlayer', ({ Username }) => {
        if (typeof Username === 'object' || Username === null)
            return;

        if (isString(Username) && Username.length != 0) {
            username = Username;
        } else {
            //Generate a username
            username = nanoID.nanoid().substring(0, 6);
        }
        console.log(`RegisterePlayer called ${username} logged into the server.`);

        socket.on('Play', () => {
            if (inGame && !lookingForGame)
                return;

            lookingForGame = true;

            MatchMaking.push(socket.id);
            console.log(`${username} added to Matchmaking`);
            CheckMatchMaking();
            
            //Gameserver finds an open game and sends us back the ID and SocketID
            //From here no longer in this section of code. 
            //io.in(socketID).Emit('InGame');
            //Triggers load scene on Unity Client
            //Once the load is done / skipped Client sends a ready message
        });

        socket.on('PlayAgain', ({ result }) => {
            //Still needs a lot of work
            if (!inGame)
                return;
            //socket.currentGame
            //socket.currentEnemy
            socket.playAgain = result;
            socket.responded = true;
            let socket = io.sockets.connected[socket.currentEnemy];
            if (socket.responded == true && socket.playAgain != true) {
               
                for(let gs in GameServers) {
                    if (GameServers[gs].id == socket.currentGame) {
                        let gameServerSocket = GameServers[gs];
                        io.sockets.connected[gameServerSocket.id].emit('EndGame', { Game: socket.currentGame });
                        break;
                    }
                }
                
                //Both players want to play again
                //Nope code
            }

        });
        socket.on('LeaveGame', () => {
            lookingForGame = false;
        });

        socket.on('Click', ({ Point }) => {
            //Vector2(x, y);
            //We do nothing
            //Send directly to the GameServer appending the ID of the game we are in
            let newPoint = { GameID: 3, Selection: selected, Point: Point };
            //
        });

        socket.on('Select', ({ Units }) => {
            if (!Array.isArray(Units))
                return;
            if (Units.length != TeamCount)
                return;
            for (var n in Units) {
                if (typeof Units[n] !== 'boolean')
                    return;
            }
            selected = Units;
        });
    });

    socket.on('disconnect', () => {

        if (isGameServer) {
            GameServerCount--;
            console.log(`Game Server disconnected`);
        }

        if (GameServerCount == 0) {
            console.log(`No Game Servers connected.`);
            hasGameServer = false;
        }

    });

    socket.emit("connection");
}
