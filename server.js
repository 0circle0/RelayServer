// noinspection JSCheckFunctionSignatures

const DEBUGGING = true;
require('dotenv').config();
const {PlayerData} = require('./PlayerData');
const {ServerData, STATUS} = require('./ServerData');
const {GameData} = require('./GameData')
const {Prompter} = require('./Prompter');

const {FULL, OPEN} = STATUS;

let RegisteredGames = [];

const nanoID = require('nanoid');
const PORT = process.env.PORT;
let io;

// noinspection JSValidateTypes
io = require('socket.io')(PORT);

const GAME_SERVER_PASSWORD = process.env.PASSWORD;
let hasGameServer = false;
let GameServerCount = 0;
const TEAM_COUNT = 6;

let GameServers = [];
let MatchMaking = [];

if (!DEBUGGING)
    console.log = function () {
    };
//API
//const express = require('express');
//const app = express();
//const expressPORT = 8080;
//app.use(express.json());
//app.listen(expressPORT);
//app.get('/user/:id', (req, res) => {
//    let {id} = req.params;
//    res.status(200).send({"/user": id})
//});

StartServer();

function StartServer() {
    io.on('connection', Connect);
    console.log("Started Server");
    //new Prompter(io);
}

function ArrayValuesAllBooleanAndNotAllFalse(Selection, count) {

    const keys = Object.keys(Selection);

    let falseCount = 0;
    for (const key in keys) {
        if (typeof Selection[key] !== 'boolean')
            return false;

        falseCount += !Selection[key];
    }

    return falseCount !== count;
}

function CheckMatchMaking() {

    if (MatchMaking.length < 2)
        return;

    let server = FindOpenGameServer();
    if (server === -1) {
        console.log("No GameServer");
        return;
    }

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

    let gameServerID = GameServers[server].id;

    let request = {
        BlueTeam: blue,
        RedTeam: red,
        RoomName: nanoID.nanoid().toString()
    }

    io.to(gameServerID).emit('GameRequest', request);
    console.log(`Matchmaking => GameRequest to ${gameServerID} for ${blue}, ${red}`);
}

function FindOpenGameServer() {
    let highest = -1;
    let bestServer;
    for (let n in GameServers) {
        let {status, gamesOpen} = GameServers[n];
        if (status === OPEN && gamesOpen > 0) {
            if (gamesOpen > highest) {
                highest = gamesOpen;
                bestServer = n;
            }
        }
    }
    if (highest === -1)
        return -1;

    return bestServer;
}

function GetGameServer(id) {
    for (let n = 0; n < GameServers.length; n++) {
        if (GameServers[n].id === id)
            return GameServers[n];
    }
}

function GetPlayerData(id) {
    const {playerData} = GetPlayerSocket(id).data;
    return playerData;
}

function GetPlayerSocket(id) {
    //console.log(io.sockets.sockets.get(id))
    return io.sockets.sockets.get(id);
}

function RemovePlayerFromMatchMaking(id) {
    let player = MatchMaking.indexOf(id);

    if (player !== -1) {
        MatchMaking.splice(player, 1);
        console.log(`${id}: Matchmaking => Removed`);
    }
}

function GetRegisteredGame(RoomName) {
    let gameID = RegisteredGames.findIndex((data) => data.RoomName === RoomName);
    if (gameID !== -1) {
        return {Game: RegisteredGames[gameID], ID: gameID};
    }
    return -1;
}

function IsEnemyReady(team) {
    let playerData = GetPlayerData(team);
    let enemyData = GetPlayerData(playerData.currentEnemy);

    return enemyData.ready;
}

function isString(value) {
    return typeof value === 'string' || value instanceof String;
}

function LeaveGame(id, playerData) {
    if (!playerData.inGame)
        return;
    //Check if game is running or has ended
    RemoveRegisteredGame(playerData.currentGame);
    let RoomIndex = playerData.gameIndex;

    let enemy = GetPlayerData(playerData.currentEnemy);
    let enemySocket = GetPlayerSocket(playerData.currentEnemy);
    if (enemy.inGame && enemy.currentEnemy === id) {
        enemySocket.emit('PlayerLeft');
        enemy.inGame = false;
        enemy.currentEnemy = '';

        let game_server = GetPlayerSocket(playerData.gameserver);
        //game_server.emit('PlayerLeft', {Room: room, ID: id});
        if (typeof game_server !== 'undefined')
            game_server.emit('ResetGame', {RoomIndex});
        RemoveAllPlayersFromRoom(playerData.currentGame);
    }
    playerData.inGame = false;
    playerData.currentEnemy = '';
}

function NotifyPlayersOfGameServerDisconnect(gameServerOwnerID) {
    let games = RegisteredGames.find((data) => data.GameServerOwner === gameServerOwnerID);
    if (typeof games === 'undefined')
        return;

    if (games.length < 1)
        return;

    let NewRegisteredGames = [];
    let removedCount = 0;
    for (let i = 0; i < RegisteredGames.length; i++) {
        let data = RegisteredGames[i];
        if (data.GameServerOwner !== gameServerOwnerID) {
            NewRegisteredGames.push(data);
            continue;
        }
        clearTimeout(data.timeout);
        //RemoveRegisteredGame(data.RoomName);
        removedCount++;
        for (let k = 0; k < data.Players.length; k++) {
            let player = data.Players[k];
            let playerData = GetPlayerData(player);
            playerData.inGame = false;

            io.to(player).emit('GameServerOffline');
        }
    }

    console.log('Notified Players of Game Server Disconnect');
    let removal = RegisteredGames.length - removedCount;
    RegisteredGames = NewRegisteredGames;
    console.assert(RegisteredGames.length === removal, `Invalid RegisterGame.length ${RegisteredGames.length} mismatch ${removal}`);
}

function PlayerConnected(id) {
    let socket = GetPlayerSocket(id)
    return typeof id !== 'undefined' && typeof socket !== 'undefined';
}

function PutIntoMatchMaking(blueTeam, redTeam) {
    if (PlayerConnected(blueTeam)) {
        MatchMaking.unshift(blueTeam);
        console.log(`${blueTeam}: Matchmaking => Insert`);
    }
    if (PlayerConnected(redTeam)) {
        MatchMaking.unshift(redTeam);
        console.log(`${redTeam}: Matchmaking => Insert`);
    }
}

function RegisterGameBetween(blueTeam, redTeam, roomName, gameServer, index) {
    SetGameForPlayer(blueTeam, redTeam, roomName, gameServer, index, 0);
    SetGameForPlayer(redTeam, blueTeam, roomName, gameServer, index, 1);

    console.log(`GameServer: ${gameServer} => Created ${roomName} for ${blueTeam}, ${redTeam}`);
}

function RemoveAllPlayersFromRoom(roomName) {
    //There is a better way to do this
    io.socketsLeave(roomName);
    console.log(`Room: ${roomName} => clients.leave`);
}

function RemoveRegisteredGame(currentGame) {

    let game = GetRegisteredGame(currentGame);

    if (game !== -1) {
        let {Game, ID} = game;

        clearTimeout(game.Game.timeout);
        RegisteredGames.splice(ID, 1);
    }
}

function SendMessageToPlayers(blueTeam, redTeam, message) {
    io.to(blueTeam).to(redTeam).emit(message);
}

function SetGameForPlayer(team, enemy, room, server, index, currentTeam) {
    let playerData = GetPlayerData(team);
    playerData.lookingForGame = false;
    playerData.inGame = true;
    playerData.currentGame = room;
    playerData.currentEnemy = enemy;
    playerData.gameserver = server;
    playerData.gameIndex = index;
    playerData.playAgain = false;
    playerData.responded = false;
    playerData.ready = false;
    playerData.currentTeam = currentTeam;
    let playerSocket = GetPlayerSocket(team);
    playerSocket.join(room);
}

function SetGameServerStatus(id, status) {
    let gameServer = GetGameServer(id);
    gameServer.status = status;
}

function SetGameServerStatusFull(id) {
    SetGameServerStatus(id, FULL);
    console.log(`${id}: Status => FULL`);
}

function SetGameServerStatusOpen(id) {
    SetGameServerStatus(id, OPEN);
    console.log(`${id}: Status => OPEN`);
}

function StartReadyCountForGame(currentGame, index) {
    let game = GetRegisteredGame(currentGame);
    //let gameID = RegisteredGames.findIndex((data) => data.RoomName === currentGame)
    if (game!== -1) {

        clearTimeout(game.Game.timeout);
    }
    setTimeout(() => {

        io.in(currentGame).emit('ReadyCount', {Game: index});
        console.log(`Game: ${currentGame} => ReadyCount`);
    }, 2000);
}

function GamesOpen() {
    let count = 0;
    for (let i = 0; i < GameServers.length; i++) {
        count += GameServers[i].gamesOpen;
    }
    return count;
}

function Connect(socket) {
    let isGameServer = false;

    /**
     * Server Controller UI with Auth token
     */

    /**
     * Game Server Joins with Auth token
     */
    if (socket.handshake.auth.token === GAME_SERVER_PASSWORD) {
        isGameServer = true;
        hasGameServer = true;
        GameServerCount++;
        //This assumes never disconnecting
        //let gs = new Server(GameServers.length, socket.id, Status.OPEN);

        let serverData = new ServerData(GameServers.length, socket.id, OPEN);
        socket.data.serverData = serverData;
        GameServers.push(serverData);

        console.log(`${socket.id} => RegisterGameServer. Game Server Count ${GameServerCount}`);

        //socket.on('AskPlayAgain', ({BlueTeam, RedTeam, RoomName}) => {
        //    SendMessageToPlayers(BlueTeam, RedTeam, 'PlayAgain');
        //    //At this point we will no longer know anything about this
        //});

        socket.on('GameOver', ({BlueTeam, RedTeam, RoomName}) => {
            //We want the option to replay
            RemoveAllPlayersFromRoom(RoomName);
            SendMessageToPlayers(BlueTeam, RedTeam, 'GameOver');

            RemoveRegisteredGame(RoomName);
            //inGame = false
        });

        socket.on('OpenServer', () => {
            SetGameServerStatusOpen(socket.id);
        });

        socket.on('ServerFull', (game) => {

            let {BlueTeam, RedTeam} = game;
            console.log(`Server Full triggered. ${BlueTeam} & ${RedTeam} put back into matchmaking. This message should never display unless lag between NodeJS and GameServer? doubtful`)
            PutIntoMatchMaking(BlueTeam, RedTeam);
            let Red = GetPlayerSocket(RedTeam);
            let Blue = GetPlayerSocket(BlueTeam);
            if (typeof Red !== 'undefined') {
                Red.emit('LookingForGame');
            }
            if (typeof Blue !== 'undefined') {
                Blue.emit('LookingForGame');
            }
            SetGameServerStatusFull(socket.id);
        });

        socket.on('GamesOpen', (gamesOpen) => {
            serverData.gamesOpen = gamesOpen;
            //let statusFull = serverData.status === STATUS.FULL;
            gamesOpen === 0 ? SetGameServerStatusFull(socket.id) : SetGameServerStatusOpen(socket.id);
            CheckMatchMaking();
            console.log(`GameServer: ${socket.id} => GamesOpen: ${GamesOpen()}`);
        });

        socket.on('GameRegistered', ({BlueTeam, RedTeam, RoomName, GameIndex}) => {

            if (PlayerConnected(BlueTeam) && PlayerConnected(RedTeam)) {
                RegisterGameBetween(BlueTeam, RedTeam, RoomName, socket.id, GameIndex);
                socket.join(RoomName);
                //SendMessageToPlayers(BlueTeam, RedTeam, 'InGame');
                let blueData = GetPlayerData(BlueTeam);
                let redData = GetPlayerData(RedTeam);
                io.to(BlueTeam).emit('InGame', {Enemy: redData.username, BlueTeam, RedTeam});
                io.to(RedTeam).emit('InGame', {Enemy: blueData.username, BlueTeam, RedTeam});

                let players = [BlueTeam, RedTeam];
                let gameData = new GameData(RoomName, players, socket.id)
                gameData.timeout = setTimeout(()=> {
                    if (blueData.ready && redData.ready)
                        return;

                    blueData.ready = true;
                    redData.ready = true;
                    //io.to(gameData.RoomName).emit("EnemyReady");

                    StartReadyCountForGame(gameData.RoomName);
                },30000);
                RegisteredGames.push(gameData);
            } else {
                PutIntoMatchMaking(BlueTeam, RedTeam);
                socket.emit('ResetGame', RoomName);
            }

            CheckMatchMaking();
        });

        socket.on('GameStates', ({netGames}) => {
            for (let i = 0; i < netGames.length; i++) {
                let {state, roomName} = netGames[i];
                socket.in(roomName).emit('GameState', state);
            }
        });

        socket.emit('RegisteredAsGameServer');
    }

    /**
     * Player Joins
     */
    socket.on('RegisterPlayer', ({Username}) => {
        let playerData = new PlayerData();
        socket.data.playerData = playerData;

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

                StartReadyCountForGame(playerData.currentGame, playerData.gameIndex);
            }

            let enemy = GetPlayerSocket(playerData.currentEnemy);
            enemy.emit('EnemyReady');
        });

        socket.on('LeaveGame', () => LeaveGame(socket.id, socket.data.playerData));

        socket.on('LeaveQueue', () => {
            if (!playerData.lookingForGame)
                return;

            RemovePlayerFromMatchMaking(socket.id);
            playerData.lookingForGame = false;
        });

        socket.on('Click', ({Selection, Position}) => {
            if (!playerData.inGame)
                return;

            if (!Array.isArray(Selection))
                return;

            if (Selection.length !== TEAM_COUNT)
                return;

            let boolCheck = ArrayValuesAllBooleanAndNotAllFalse(Selection, 6);
            if (!boolCheck)
                return;

            if (typeof Position.x !== 'number' || typeof Position.z !== 'number')
                return;

            let point = {x: Position.x, z: Position.z};

            let newPoint = {
                GameID: playerData.gameIndex,
                Selected: Selection,
                Point: point,
                Team: playerData.currentTeam
            };
            let gameServer = playerData.gameserver;
            io.to(gameServer).emit("Click", newPoint);
        });
    });

    socket.on('disconnect', () => {
        if (isGameServer) {

            //Gather all games running on server and notify all players of disconnection
            NotifyPlayersOfGameServerDisconnect(socket.id);
            let id = GameServers.indexOf(socket.data.serverData);
            if (id !== -1) {
                GameServers.splice(id, 1);
                GameServerCount--;
                hasGameServer = GameServerCount !== 0;
                console.log(`GameServer: ${socket.data.serverData.id} => Disconnected | GameServer => Removed | Game Server Count: ${GameServerCount}`);
                if (!hasGameServer) {
                    console.log(`No Game Servers available.`);
                }
            }
        } else {
            let data = socket.data.playerData;
            if (typeof data !== 'undefined') {
                if (data.lookingForGame === true) {
                    RemovePlayerFromMatchMaking(socket.id);
                }
                if (data.inGame === true)
                    LeaveGame(socket.id, data);
            }
            console.log(`${socket.id} => Disconnect`);
        }
    });

    socket.emit("connection");
}
