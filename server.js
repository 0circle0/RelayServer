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

StartServer();
async function StartServer() {
    //let MatchMakingInterval = setInterval(() => {
    //    CheckMatchMaking();
    //}, 1000);
    io.on('connection', Connect);
    console.log("Started Server");
}

function FindOpenGameServer() {
    let server = -1;
    for (var n in GameServers) {
        if (GameServers[n].status == Status.OPEN) {
            server = n;
            break;
        }
    }
    return server;
}

function CheckMatchMaking() {

    if (MatchMaking.length < 2)
        return;
    //Need to check existing players

    let blue = MatchMaking.pop();

    //Make sure players are online still
    if (!PlayerConnected(blue)) {
        CheckMatchMaking();
        return;
    }

    let red = MatchMaking.pop();
    if (!PlayerConnected(red)) {
        PutIntoMatchMaking(blue, undefined);
        CheckMatchMaking();
        return;
    }

    let RequestGame = {
        BlueTeam: blue,
        RedTeam: red,
        RoomName: nanoID.nanoid()
    }
    let server = FindOpenGameServer();
    //Have game
    if (server != -1) {
        console.log(GameServers[server].id);
        io.to(GameServers[server].id).emit('RequestGame', { RequestGame: RequestGame });
        console.log("Requesting Game");
        return;
    }
    //No game available Server Full
    SendMessageToPlayers(RequestGame.BlueTeam, RequestGame.RedTeam, 'ServerFull');
}

function RemovePlayerFromMatchMaking(id) {
    let player = MatchMaking.indexOf(socket.id);

    if (player != -1) {
        MatchMaking.splice(player, 1);
        console.log(`${username} found and removed from matchmaking`);
    }
}

function SetGameServerFull(id) {
    for (let n in GameServers) {
        if (GameServers[n].id == id) {
            GameServers[n].status = Status.FULL;
            break;
        }
    }
}

function PlayerConnected(id) {
    return typeof id !== 'undefined' && typeof io.sockets.connected[id] !== 'undefined';
}

function RemoveAllPlayersFromRoom(RoomName) {
    io.sockets.clients(RoomName).forEach(() => s.leave(RoomName));
}

function SetGameServerStatus(id, status) {
    for (let n in GameServers) {
        if (GameServers[n].id == id) {
            GameServers[n].status = status;
            break;
        }
    }
}

function SendMessageToPlayers(BlueTeam, RedTeam, message) {
    io.to(BlueTeam).to(RedTeam).emit(message);
}

function PutIntoMatchMaking(BlueTeam, RedTeam) {
    if (PlayerConnected(BlueTeam))
        MatchMaking.unshift(BlueTeam);
    if (PlayerConnected(RedTeam))
        MatchMaking.unshift(RedTeam);
}

function GetPlayerSocket(id) {
    return io.sockets.connected[id];
}

function RegisterGameBetween(BlueTeam, RedTeam, RoomName) {
    let blue = GetPlayerSocket(BlueTeam);
    blue.currentGame = RoomName;
    blue.currentEnemy = RedTeam;
    blue.playAgain = false;
    blue.responded = false;
    blue.join(RoomName);

    let red = GetPlayerSocket(RedTeam);
    red.currentGame = RoomName;
    red.currentEnemy = BlueTeam;
    red.playAgain = false;
    red.responded = false;
    red.join(RoomName);
}

function isString(value) {
    return typeof value === 'string' || value instanceof String;
}

function Connect(socket) {
    let isGameServer = false;
    socket.username = '';
    socket.selected = [false, false, false, false, false, false];
    socket.inGame = false;

    socket.lookingForGame = false;
    /** 
     * Game Server Joins
    */
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
                SendMessageToPlayers(BlueTeam, RedTeam, 'PlayAgain');
                //At this point we will no longer know anything about this
            });

            socket.on('GameOver', ({ BlueTeam, RedTeam, RoomName }) => {
                //We want the option to replay
                RemoveAllPlayersFromRoom(RoomName);
                SendMessageToPlayers(BlueTeam, RedTeam, 'GameOver');
                //inGame = false
            });

            socket.on('OpenServer', () => {
                SetGameServerStatus(socket.id, Status.OPEN);
                console.log("GameServer requesting opening");
            });

            //Called when GameServer is Full and a game was passed to GameServer
            socket.on('GameClosed', ({ BlueTeam, RedTeam, RoomName }) => {
                PutIntoMatchMaking(BlueTeam, RedTeam);
                SetGameServerFull(socket.id);
                console.log("GameServer requesting closure.");
            });

            socket.on('GameRegistered', ({ BlueTeam, RedTeam, RoomName }) => {
                if (PlayerConnected(BlueTeam) && PlayerConnected(RedTeam)) {
                    RegisterGameBetween(BlueTeam, RedTeam, RoomName);
                    socket.join(RoomName);
                    SendMessageToPlayers(BlueTeam, RedTeam, 'InGame');
                } else {
                    console.log(`putting back into matchmaking`);
                    PutIntoMatchMaking(BlueTeam, RedTeam);
                    socket.emit('CancelGame', ({ RoomName }));
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

    /** 
     * Player Joins
    */
    socket.on('RegisterPlayer', ({ Username }) => {
        if (typeof Username === 'object' || Username === null)
            return;

        if (isString(Username) && Username.length != 0) {
            socket.username = Username;
        } else {
            //Generate a username
            socket.username = nanoID.nanoid().substring(0, 6);
        }
        console.log(`RegisteredPlayer called ${socket.username} logged into the server.`);
        socket.emit('LoggedIn', { Username: socket.username });
        
        socket.on('Play', () => {
            if (socket.inGame && !socket.lookingForGame)
                return;

            socket.lookingForGame = true;

            MatchMaking.push(socket.id);
            console.log(`${socket.username} added to Matchmaking`);
            CheckMatchMaking();
            socket.emit('LookingForGame');
        });

        socket.on('PlayAgain', ({ result }) => {
            //Still needs a lot of work
            if (!socket.inGame)
                return;
            //socket.currentGame
            //socket.currentEnemy
            socket.playAgain = result;
            socket.responded = true;
            let socket = GetPlayerSocket(socket.currentEnemy);
            if (socket.responded == true && socket.playAgain != true) {

                for (let gs in GameServers) {
                    if (GameServers[gs].id == socket.currentGame) {
                        let gameServerSocket = GetPlayerSocket(GameServers[gs].id);
                        gameServerSocket.emit('EndGame', { Game: socket.currentGame });
                        break;
                    }
                }

                //Both players want to play again
                //Nope code
            }

        });
        socket.on('LeaveGame', () => {
            socket.lookingForGame = false;
        });

        socket.on('Click', ({ Point }) => {
            //Vector2(x, y);
            //We do nothing
            //Send directly to the GameServer appending the ID of the game we are in
            let newPoint = { GameID: 3, Selected: socket.selected, Point: Point };
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
            socket.selected = Units;
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
        console.log("Disconnection Detected");
        if (socket.lookingForGame == true) {
            console.log(`${socket.username} logged out while looking for a game`);
            RemovePlayerFromMatchMaking(socket.id);
        }

    });

    socket.emit("connection");
}
