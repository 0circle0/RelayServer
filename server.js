const DEBUGGING = true;
require('dotenv').config();
const {PlayerData} = require('./PlayerData.js');
const {ServerData, STATUS} = require('./ServerData');
const {FULL, OPEN, LATER} = STATUS;

const nanoID = require('nanoid');
const PORT = process.env.PORT;
const io = require('socket.io')(PORT);

const GAME_SERVER_PASSWORD = process.env.PASSWORD;
let hasGameServer = false;
let GameServerCount = 0;
const TEAM_COUNT = 6;

let GameServers = [];
let MatchMaking = [];

if (!DEBUGGING)
    console.log = function () {
    };

StartServer();

function StartServer() {
    io.on('connection', Connect);
    console.log("Started Server");
}

function FindOpenGameServer() {

    for (let n in GameServers) {
        if (GameServers[n].serverData.status === OPEN) {
            return n;
        }
    }
    return -1;
}

function CheckMatchMaking() {

    if (MatchMaking.length < 2)
        return;

    let blue = MatchMaking.pop();

    //Make sure players are online still
    if (!PlayerConnected(blue)) {
        console.log(`${blue}: Matchmaking => Removed | Reason: Offline`);
        CheckMatchMaking();
        return;
    }

    let red = MatchMaking.pop();
    if (!PlayerConnected(red)) {
        console.log(`${red}: Matchmaking => Removed | Reason: Offline`);
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
    if (server !== -1) {
        let gameServerID = GameServers[server].id;
        io.to(gameServerID).emit('RequestGame', {RequestGame: RequestGame});
        console.log(`Matchmaking => RequestGame to ${gameServerID} for ${blue}, ${red}`);
        return;
    }
    //No game available Server Full
    SendMessageToPlayers(RequestGame.BlueTeam, RequestGame.RedTeam, 'ServerFull');
}

function RemovePlayerFromMatchMaking(id) {
    let player = MatchMaking.indexOf(id);

    if (player !== -1) {
        MatchMaking.splice(player, 1);
        console.log(`${id}: Matchmaking => Removed`);
    }
}

function GetGameServer(id) {
    for (let n = 0; n < GameServers.length; n++) {
        if (GameServers[n].id === id)
            return GameServers[n];
    }
}

function SetGameServerStatusOpen(id) {
    SetGameServerStatus(id, OPEN);
    console.log(`${id}: Status => OPEN`);
}

function SetGameServerStatusFull(id) {
    SetGameServerStatus(id, FULL);
    console.log(`${id}: Status => FULL`);
}

function SetGameServerStatus(id, status) {
    let gameServer = GetGameServer(id);
    gameServer.status = status;
}

function PlayerConnected(id) {
    return typeof id !== 'undefined' && typeof io.sockets.connected[id] !== 'undefined';
}

function RemoveAllPlayersFromRoom(RoomName) {
    io.sockets.clients(RoomName).forEach((s) => s.leave(RoomName));
    console.log(`Room: ${RoomName} => clients.leave`);
}

function SendMessageToPlayers(BlueTeam, RedTeam, message) {
    io.to(BlueTeam).to(RedTeam).emit(message);
}

function PutIntoMatchMaking(BlueTeam, RedTeam) {
    if (PlayerConnected(BlueTeam)) {
        MatchMaking.unshift(BlueTeam);
        console.log(`${BlueTeam}: Matchmaking => Insert`);
    }
    if (PlayerConnected(RedTeam)) {
        MatchMaking.unshift(RedTeam);
        console.log(`${RedTeam}: Matchmaking => Insert`);
    }
}

function GetPlayerData(id) {
    return GetPlayerSocket(id).playerData;
}

function GetPlayerSocket(id) {
    return io.sockets.connected[id];
}

function IsEnemyReady(Team) {
    let playerData = GetPlayerData(Team);
    let enemyData = GetPlayerData(playerData.currentEnemy);

    return enemyData.ready;
}

function SetGameForPlayer(Team, Enemy, Room, Server) {
    let playerData = GetPlayerData(Team);
    playerData.lookingForGame = false;
    playerData.inGame = true;
    playerData.currentGame = Room;
    playerData.currentEnemy = Enemy;
    playerData.gameserver = Server;
    playerData.playAgain = false;
    playerData.responded = false;
    playerData.ready = false;
    playerData.join(Room);
}

function RegisterGameBetween(BlueTeam, RedTeam, RoomName, GameServer) {
    SetGameForPlayer(BlueTeam, RedTeam, RoomName, GameServer);
    SetGameForPlayer(RedTeam, BlueTeam, RoomName, GameServer);
    console.log(`GameServer: ${GameServer} => Created ${RoomName} for ${BlueTeam}, ${RedTeam}`);
}

function isString(value) {
    return typeof value === 'string' || value instanceof String;
}

function Connect(socket) {
    let isGameServer = false;

    /**
     * Game Server Joins
     */
    socket.on('RegisterGameServer', ({APIKEY}) => {

        if (APIKEY === GAME_SERVER_PASSWORD) {
            isGameServer = true;
            hasGameServer = true;
            GameServerCount++;
            //This assumes never disconnecting
            //let gs = new Server(GameServers.length, socket.id, Status.OPEN);

            let serverData = new ServerData(GameServers.length, socket.id, OPEN);
            socket.serverData = serverData;
            GameServers.push(serverData);

            console.log(`${socket.id} => RegisterGameServer. Game Server Count ${GameServerCount}`);

            socket.on('AskPlayAgain', ({BlueTeam, RedTeam, RoomName}) => {
                SendMessageToPlayers(BlueTeam, RedTeam, 'PlayAgain');
                //At this point we will no longer know anything about this
            });

            socket.on('GameOver', ({BlueTeam, RedTeam, RoomName}) => {
                //We want the option to replay
                RemoveAllPlayersFromRoom(RoomName);
                SendMessageToPlayers(BlueTeam, RedTeam, 'GameOver');
                //inGame = false
            });

            socket.on('OpenServer', () => {
                SetGameServerStatusOpen(socket.id);
            });

            //Called when GameServer is Full and a game was passed to GameServer
            socket.on('GameClosed', ({BlueTeam, RedTeam, RoomName}) => {
                PutIntoMatchMaking(BlueTeam, RedTeam);
                SetGameServerStatusFull(socket.id);
            });

            socket.on('GameRegistered', ({BlueTeam, RedTeam, RoomName}) => {
                if (PlayerConnected(BlueTeam) && PlayerConnected(RedTeam)) {
                    RegisterGameBetween(BlueTeam, RedTeam, RoomName, socket.id);
                    socket.join(RoomName);
                    SendMessageToPlayers(BlueTeam, RedTeam, 'InGame');
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
        }
    });

    /**
     * Player Joins
     */
    socket.on('RegisterPlayer', ({Username}) => {
        let playerData = new PlayerData();
        socket.playerData = playerData;

        if (typeof Username === 'object' || Username === null)
            return;

        if (isString(Username) && Username.length !== 0) {
            playerData.username = Username;
        } else {
            //Generate a username
            playerData.username = nanoID.nanoid().substring(0, 6);
        }
        console.log(`RegisteredPlayer => ${socket.id} as ${playerData.username}`);
        socket.emit('LoggedIn', {Username: playerData.username});

        socket.on('Play', () => {
            if (playerData.inGame && !playerData.lookingForGame)
                return;

            playerData.lookingForGame = true;

            MatchMaking.push(socket.id);
            console.log(`Matchmaking => Insert ${playerData.username} as ${socket.id}`);
            CheckMatchMaking();
            socket.emit('LookingForGame');
        });

        socket.on('Ready', () => {
            if (!playerData.inGame)
                return;
            if (playerData.ready)
                return;
            playerData.ready = true;
            console.log(`Game: ${playerData.currentGame} | Player => ${playerData.username} Ready`);
            if (IsEnemyReady(socket.id)) {
                io.in(playerData.currentGame).emit('ReadyCount', {Game: playerData.currentGame});
                console.log(`Game: ${playerData.currentGame} => ReadyCount`);
            }
        });

        socket.on('PlayAgain', ({result}) => {
            //Still needs a lot of work
            //if (!playerData.inGame)
            //    return;
            //socket.currentGame
            //socket.currentEnemy


        });
        socket.on('LeaveGame', () => {
            if (!playerData.inGame)
                return;
            //Check if game is running or has ended
            let room = playerData.currentGame;
            socket.leave(room);
            playerData.inGame = false;

            if (!playerData.observing) {
                let game_server = GetPlayerSocket(playerData.gameserver);
                game_server.emit('PlayerLeft', {Room: room, ID: socket.id});

                let enemy = GetPlayerSocket(playerData.currentEnemy).playerData;
                if (enemy.inGame && enemy.currentEnemy === socket.id) {
                    enemy.emit('PlayerLeft');
                }
                playerData.currentEnemy = '';
                RemoveAllPlayersFromRoom(room);
            }

        });

        socket.on('Click', ({Point}) => {
            //Vector2(x, y);
            //We do nothing
            //Send directly to the GameServer appending the ID of the game we are in
            let newPoint = {GameID: 3, Selected: socket.selected, Point: Point};
            //
        });

        socket.on('Select', ({Units}) => {
            if (!Array.isArray(Units))
                return;

            if (Units.length !== TEAM_COUNT)
                return;

            if (!Units.every(Boolean))
                return;

            playerData.selected = Units;
            console.log(`Username: ${playerData.username} => Select ${Units}`);
        });
    });

    socket.on('disconnect', () => {
        //GameServerCount -= isGameServer;
        if (isGameServer) {
            GameServerCount--;
            hasGameServer = GameServerCount !== 0;
            console.log(`GameServer: ${socket.serverData.id} => Disconnected | Game Server Count: ${GameServerCount}`);
            if (!hasGameServer) {
                console.log(`No Game Servers available.`);
            }
        } else {
            if (socket.playerData.lookingForGame === true) {
                RemovePlayerFromMatchMaking(socket.id);

            }
            console.log(`${socket.id} => Disconnect`);
        }
    });

    socket.emit("connection");
}
