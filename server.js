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
    let MatchMakingInterval = setInterval(() => {
        if (MatchMaking.length < 2)
            return;
        console.log("Game needed");
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
            io.to(GameServers[sid].id).emit('RequestGame', {RequestGame: RequestGame});
            console.log("Requesting Game");
        } else {
            //No game available
            socket.emit('ServerHostError');
        }
    }, 1000);
    io.on('connection', Connect);
    console.log("Started Server");
}

function Connect(socket) {
    let isGameServer = false;
    let username;
    let selected = [false, false, false, false, false, false];
    let inGame = false;
    let lookingForGame = false;
    socket.on('RegisterGameServer', ({ APIKEY }) => {
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
            socket.on('GameRegistered', ({ BlueTeam, RedTeam, RoomName }) => {
                //BlueTeam & RedTeam are socket.id of the players requesting the game
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
                socket.join(RoomName);
                io.to(BlueTeam).to(RedTeam).emit('InGame');
            });
            socket.join(socket.id);
        } else {
            console.log(`Game Server Attempt Incorrect password`);
            socket.disconnect(true);
        }
        socket.emit('RegisteredAsGameServer')
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
            console.log("added player to match making")
            //Gameserver finds an open game and sends us back the ID and SocketID
            //From here no longer in this section of code. 
            //io.in(socketID).Emit('InGame');
            //Triggers load scene on Unity Client
            //Once the load is done / skipped Client sends a ready message
        });

        socket.on('PlayAgain', ({ result }) => {
            if (!inGame)
                return;
            //socket.currentGame
            //socket.currentEnemy
            socket.playAgain = result;
            socket.responded = true;
            let socket = io.sockets.connected[socket.currentEnemy];
            if (socket.responded == true && socket.playAgain != true) {
                let gameServerSocket = GameServers[socket.currentGame];
                io.sockets.connected[gameServerSocket].emit('EndGame', { Game: socket.currentGame });
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
