// noinspection JSCheckFunctionSignatures

const DEBUGGING = true;
require('dotenv').config();
const bcrypt = require('bcrypt');
const saltRounds = 10;
const MongoClient = require('mongodb').MongoClient;
const url = 'mongodb://localhost:27017/Football';
const dbName = 'Football';
const collectionName = 'Games';
let _client;
let mongoDB;


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
const ADMIN_SERVER_PASSWORD = process.env.ADMIN;
const PLAYER_PASSWORD = process.env.PLAYER;
const MASTER_PASSWORD = process.env.MASTERAPIKEY;
const MASTER_IP = process.env.MASTERIP;
const MASTER_PORT = process.env.MASTERPORT;
const THIS_IP = process.env.THISIPADDRESS;
const InstanceID = process.env.INSTANCEID;
const tickDelay = process.env.TickDelay;
const timeoutDelay = tickDelay * 4;
const MASTER_HASH_SALT = process.env.MASTERHASHSALT;

let hasGameServer = false;
let adminSocket;
let GameServerCount = 0;
const TEAM_COUNT = 8;
let requiresRegistration = true;
let previousStatus;

let GameServers = [];
let MatchMaking = [];

if (!DEBUGGING)
    console.log = function () {
    };


//UDP Server - Connection To Master Server
const body = {apikey: MASTER_PASSWORD, InstanceID, gamesOpen: 0, totalGames: 0};
const bodyRegister = {apikey: MASTER_PASSWORD, IP: THIS_IP, PORT, PASS: PLAYER_PASSWORD, InstanceID, date: 0};
let createClient = require('dgramx').createClient;
let addr = `udp://${MASTER_IP}:${MASTER_PORT}`;
let client = createClient(addr);
let connectedToMaster = false;

client.bind(0);
client.on('status', (msg) =>{
    ProcessStatus(msg);
});

setInterval(()=>{
    if (!connectedToMaster)
        requiresRegistration = true;

    let gamesOpen = 0;
    let totalGames = 0;
    for (let i = 0; i < GameServers.length; i++) {
        let gs = GameServers[i];
        gamesOpen += gs.gamesOpen;
        totalGames += gs.totalGames;
    }
    body.gamesOpen = gamesOpen;
    body.totalGames = totalGames;
    if (requiresRegistration)
        bodyRegister.date = Date.now();
    let path = requiresRegistration ? `relayRegister` : `relayUpdate`;
    client.emit(path, JSON.stringify(requiresRegistration ? bodyRegister : body));

}, tickDelay);

function GetMasterInterval () {
    return setInterval(() =>{
        connectedToMaster = false;
        console.log('Master server disconnected');
        clearInterval(masterConnectionInterval);
    }, timeoutDelay);
}

let masterConnectionInterval = GetMasterInterval();

function ProcessStatus(res) {
    connectedToMaster = true;
    if (masterConnectionInterval) {
        clearInterval(masterConnectionInterval);
        masterConnectionInterval = null;
    }
    masterConnectionInterval = GetMasterInterval();
    switch (res) {
        case 200:
            if (previousStatus !== res)
                console.log('Updated Successfully, Status: \'OK\'');
            previousStatus = res;
            break;
        case 201:
            console.log(`Registered with Master Server. { InstanceID: ${InstanceID}, IP: ${THIS_IP}, PORT: ${PORT} }`);
            requiresRegistration = false;
            break;
        case 202:
            console.log('Registration Successfully Updated.');
            break;
        case 204:
            if (previousStatus !== res)
                console.log('Updated Successfully, Status: \'No Content\'.');
            previousStatus = res;
            break;
        case 410:
            console.log('Update failed \'Require Registration\'.');
            requiresRegistration = true;
            break;
        case 425:
            console.log('Register failed. Too Early');
            requiresRegistration = true;
            break;
    }
}

//Relay Server Connections to Game Clients and Game Servers
StartServer();

function StartServer() {
    let options = {useNewUrlParser: true, useUnifiedTopology: true};

    MongoClient.connect(url, options, (err, client) => {
        if (err) {
            console.log(err)
            return;
        }

        console.log("Connected to Mongo");

        _client = client;
        let db = client.db(dbName);

        db.listCollections().toArray(function (err, collections) {
            let bb = collections.some(function (col) {
                return col.name === 'Games'
            });

            if (!bb) {
                db.createCollection("Games", function (err, res) {
                    console.log("Games Collection created!");
                });
            }

            mongoDB = db.collection(collectionName);
            io.on('connection', Connect);
            console.log("Started Server");

        });
    });

    //new Prompter(io);
}

function CheckForSoloGamesInMatchMaking() {
    let checked = [];

    while (MatchMaking.length > 0) {
        let MM = MatchMaking.pop();
        if (!MM.Solo)
            checked.push(MM);
        else
            SoloRequest(MM.socket);
    }
    MatchMaking = checked;
}

function GetNextTeamMatchInMatchMaking(iterations) {
    let team = MatchMaking.pop();
    //Try 3 times to find a multiplayer game then process a solo game.
    if (team.Solo) {
        if (iterations <= 2) {
            MatchMaking.push(team);
            return GetNextTeamMatchInMatchMaking(iterations++);
        } else {
            SoloRequest(team.socket);
            console.log('Process Solo Request');
            return GetNextTeamMatchInMatchMaking(iterations++);
        }

    }
    return team;
}

function CheckMatchMaking() {

    if (MatchMaking.length < 2)
        return;

    let server = FindOpenGameServer();
    if (server === -1) {
        console.log("No GameServer");
        return;
    }

    let blue = GetNextTeamMatchInMatchMaking(0);
    //Make sure players are online still
    if (!PlayerConnected(blue.socket).result) {
        console.log(`${blue.socket}: Matchmaking => Removed | Reason: Offline`);
        CheckMatchMaking();
        return;
    }

    let red = GetNextTeamMatchInMatchMaking(0);
    if (!PlayerConnected(red.socket).result) {
        console.log(`${red.socket}: Matchmaking => Removed | Reason: Offline`);
        PutIntoMatchMaking(blue.socket, undefined);
        CheckMatchMaking();
        return;
    }

    let gameServerID = GameServers[server].id;

    let request = {
        BlueTeam: blue.socket,
        RedTeam: red.socket,
        RoomName: nanoID.nanoid().toString()
    }

    io.to(gameServerID).emit('GameRequest', request);
    console.log(`Matchmaking => GameRequest to ${gameServerID} for \n\t Players: ${blue.socket}, ${red.socket}`);
}

function SoloRequest(socketID) {
    let server = FindOpenGameServer();
    if (server === -1) {
        console.log("No GameServer");
        PutPlayerIntoMatchMaking(socketID, true);
        return;
    }
    let gameServerID = GameServers[server].id;

    let request = {
        BlueTeam: socketID,
        RedTeam: '-1',
        RoomName: nanoID.nanoid().toString()
    }
    io.to(gameServerID).emit('GameRequestSolo', request);
    console.log(`Matchmaking => GameRequest to ${gameServerID} for \n\t Solo Game: ${socketID}`);
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
    return io.sockets.sockets.get(id);
}

function RemovePlayerFromMatchMaking(id) {
    let player = -1;
    for (let mm in MatchMaking) {
        let MM = MatchMaking[mm];
        if (MM.socket === id) {
            player = mm;
        }
    }

    if (player !== -1) {
        MatchMaking.splice(player, 1);
        console.log(`${id}: Matchmaking => Removed`);
    }
}

function GetRegisteredGame(RoomName) {
    let gameID = RegisteredGames.findIndex((data) => data.RoomName === RoomName);
    if (gameID !== -1) {
        return {RegisteredGame: RegisteredGames[gameID], ID: gameID};
    }
    return -1;
}

function isString(value) {
    return typeof value === 'string' || value instanceof String;
}

function LeaveGame(id, playerData) {
    if (!playerData.inGame)
        return;
    //Check if game is running or has ended
    RemoveRegisteredGame(playerData.currentGame);
    let now = Date.now();
    let RoomIndex = playerData.gameIndex;


    let enemySocket = GetPlayerSocket(playerData.currentEnemy);
    if (typeof enemySocket !== 'undefined') {
        let enemyData = enemySocket.data.playerData;
        let gameTime = now - enemyData.gameStarted;
        let enemyId = enemySocket.id;


        let RoomName = playerData.currentGame;
        let Actions = [{id, Actions: playerData.actions, APM: playerData.actions / (gameTime / 1000 / 60)}, {
            enemyId,
            Actions: enemyData.actions,
            APM: enemyData.actions / (gameTime / 1000 / 60)
        }];
        let result = {$set: {winner: enemyData.username, winnersID: enemyId, GameTimeElapsed: gameTime, Actions}};

        let filter = {roomName: RoomName};
        let options = {upsert: false};
        mongoDB.updateOne(filter, result, options);


        if (enemyData.inGame && enemyData.currentEnemy === id) {
            enemySocket.emit('PlayerLeft');
            enemyData.inGame = false;
            enemyData.currentEnemy = '';

            let game_server = GetPlayerSocket(playerData.gameserver);
            if (typeof game_server !== 'undefined')
                game_server.emit('ResetGame', {RoomIndex});
            RemoveAllPlayersFromRoom(playerData.currentGame);
        }
    } else {
        let game_server = GetPlayerSocket(playerData.gameserver);
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
        removedCount++;
        for (let k = 0; k < data.Players.length; k++) {
            let player = data.Players[k];

            if (player !== '-1') {
                let playerData = GetPlayerData(player);
                playerData.inGame = false;

                io.to(player).emit('GameServerOffline');
            }
        }
    }

    console.log('Notified Players of Game Server Disconnect');
    RegisteredGames = NewRegisteredGames;
}

function PlayerConnected(id) {
    let socket = GetPlayerSocket(id)
    return {result: typeof id !== 'undefined' && typeof socket !== 'undefined', socket};
}

function PutPlayerIntoMatchMaking(Player, Solo = false) {
    let {result, socket} = PlayerConnected(Player);
    if (result) {
        let MM = {
            socket: socket.id, Solo
        }
        //MatchMaking.push(Player);
        MatchMaking.push(MM);
        console.log(`${socket.id}: Matchmaking => Insert as Solo Request`);
    }
}

function PutPlayerInFrontOfMatchMaking(Player, Solo) {
    let {result, socket} = PlayerConnected(Player);
    if (result) {
        let MM = {
            socket: socket.id, Solo
        }
        //MatchMaking.push(Player);
        MatchMaking.unshift(MM);
        console.log(`${socket.id}: Matchmaking => Insert`);
    }
}

function PutIntoMatchMaking(blueTeam, redTeam) {
    PutPlayerInFrontOfMatchMaking(blueTeam);
    PutPlayerInFrontOfMatchMaking(redTeam);
}

function RemoveAllPlayersFromRoom(roomName) {
    io.socketsLeave(roomName);
    console.log(`Room: ${roomName} => clients.leave`);
}

function RemoveRegisteredGame(currentGame) {

    let game = GetRegisteredGame(currentGame);

    if (game !== -1) {
        let {ID} = game;

        clearTimeout(game.RegisteredGame.timeout);
        RegisteredGames.splice(ID, 1);
    }
}

function SendMessageToPlayers(blueTeam, redTeam, message) {
    io.to(blueTeam).to(redTeam).emit(message);
}

function RegisterGameBetween(blueTeam, redTeam, roomName, gameServer, index) {
    let redUsername = 'Tim';
    let blueUsername = 'Tim';
    let redSocket = typeof 'undefined';
    let blueSocket = typeof 'undefined';
    if (typeof blueTeam.socket !== 'undefined') {
        SetGameForPlayer(blueTeam, redTeam, roomName, gameServer, index, 0);
        blueUsername = blueTeam.data.username;
        blueSocket = blueTeam.socket.id;
    }

    if (typeof redTeam.socket !== 'undefined') {
        SetGameForPlayer(redTeam, blueTeam, roomName, gameServer, index, 1);
        redUsername = redTeam.data.username;
        redSocket = redTeam.socket.id;
    }

    console.log(`GameServer: ${gameServer} => Created Room: ${roomName} \n\tPlayers ${blueUsername}: ${blueSocket}, ${redUsername}: ${redSocket}`);

}

function SetGameForPlayer(team, enemy, room, server, index, currentTeam) {
    let enemyID;
    if (typeof enemy.socket == 'undefined')
        enemyID = '-1';
    else
        enemyID = enemy.socket.id;

    let playerSocket = team.socket;
    let {playerData} = playerSocket.data;
    playerData.lookingForGame = false;
    playerData.inGame = true;
    playerData.currentGame = room;
    playerData.currentEnemy = enemyID;
    playerData.gameserver = server;
    playerData.gameIndex = index;
    playerData.playAgain = false;
    playerData.responded = false;
    playerData.ready = false;
    playerData.currentTeam = currentTeam;

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

    if (game !== -1) {
        let g = game.RegisteredGame;
        //Automatic Ready Timeout
        clearTimeout(g.timeout);
    }
    setTimeout(() => {
        let readyCount = {Game: index};
        io.in(currentGame).emit('ReadyCount', readyCount);
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

function NewCheckValidSelection(Selection) {
    if (typeof Selection !== 'number')
        return false;
    if (Selection < 0 || Selection > 255)
        return false;
    return true;
}

function CheckValidPosition(Position) {
    if (typeof Position.x !== 'number' || typeof Position.z !== 'number')
        return false;

    return true;
}

function Connect(socket) {
    let isGameServer = false;
    let token = socket.handshake.auth.token;

    /**
     * Game Server Joins with Auth token
     */
    if (token === GAME_SERVER_PASSWORD) {
        isGameServer = true;
        hasGameServer = true;
        GameServerCount++;

        let serverData = new ServerData(GameServers.length, socket.id, OPEN);
        socket.data.serverData = serverData;
        GameServers.push(serverData);

        console.log(`${socket.id} => RegisterGameServer. Game Server Count ${GameServerCount}`);

        socket.on('GameOver', ({BlueTeam, RedTeam, RoomName, winner}) => {
            //We want the option to replay
            RemoveAllPlayersFromRoom(RoomName);
            SendMessageToPlayers(BlueTeam, RedTeam, 'GameOver');

            RemoveRegisteredGame(RoomName);
            let players = [BlueTeam, RedTeam];
            let winnerSocket = GetPlayerSocket(players[winner]);
            let {playerData} = winnerSocket.data.playerData;
            let winnerID = winnerSocket.id;
            let result = {$set: {winner: playerData.username, winnersID: winnerID}};
            let filter = {roomName: RoomName};
            let options = {upsert: false};
            mongoDB.updateOne(filter, result, options, function (err, res) {
                if (err) {
                    console.log('error updating db')
                } else
                    console.log(res)
            });
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

        socket.on('GamesOpen', ({gamesOpen, totalGames}) => {
            serverData.gamesOpen = gamesOpen;
            serverData.totalGames = totalGames;
            gamesOpen === 0 ? SetGameServerStatusFull(socket.id) : SetGameServerStatusOpen(socket.id);
            //Also check if completely full also firstRun should always be set to false in this call
            if (GameServers.length === 1 && serverData.firstRun) {
                CheckForSoloGamesInMatchMaking();
                serverData.firstRun = false;
            }
            CheckMatchMaking();
            console.log(`GameServer: ${socket.id} => GamesOpen: ${GamesOpen()}/${totalGames}`);
        });

        socket.on('GameRegisteredSolo', ({BlueTeam, RedTeam, RoomName, GameIndex}) => {
            let {result: blueResult, socket: blueSocket} = PlayerConnected(BlueTeam);
            if (blueResult) {
                //let blueSocket = blue.socket;
                let blueData = blueSocket.data.playerData;
                blueData.actions = 0;
                let TeamBlue = {socket: blueSocket, data: blueData}
                RegisterGameBetween(TeamBlue, typeof 'undefined', RoomName, socket.id, GameIndex);
                socket.join(RoomName);
                io.to(BlueTeam).emit('InGame', {Enemy: {Enemy: "Tim", EnemyID: RedTeam}, BlueTeam, RedTeam});
                let players = [BlueTeam, RedTeam];
                let gameData = new GameData(RoomName, players, socket.id);
                gameData.timeout = setTimeout(() => {
                    if (typeof GetPlayerSocket(blueData.gameserver) === 'undefined')
                        return;

                    if (typeof blueSocket === 'undefined')
                        return;

                    let now = Date.now();
                    blueData.ready = true;
                    blueData.gameStarted = now;
                    //Make sure Game server and players are still online

                    StartReadyCountForGame(gameData.RoomName);
                }, 4000);
                RegisteredGames.push(gameData);
            } else {
                socket.emit('ResetGame', RoomName);
            }
        });

        socket.on('GameRegistered', ({BlueTeam, RedTeam, RoomName, GameIndex}) => {

            let {result: blueResult, socket: blueSocket} = PlayerConnected(BlueTeam);

            let {result: redResult, socket: redSocket} = PlayerConnected(RedTeam);

            if (blueResult && redResult) {
                let {playerData: blueData} = blueSocket.data;
                let {playerData: redData} = redSocket.data;
                blueData.actions = 0;
                redData.actions = 0;

                let TeamBlue = {socket: blueSocket, data: blueData}
                let TeamRed = {socket: redSocket, data: redData}

                RegisterGameBetween(TeamBlue, TeamRed, RoomName, socket.id, GameIndex);
                socket.join(RoomName);

                let blueEnemy = {Enemy: redData.username, EnemyID: RedTeam};
                let redEnemy = {Enemy: blueData.username, EnemyID: BlueTeam};

                io.to(BlueTeam).emit('InGame', {Enemy: blueEnemy, BlueTeam, RedTeam});
                io.to(RedTeam).emit('InGame', {Enemy: redEnemy, BlueTeam, RedTeam});

                let players = [{BlueTeam, Username: blueData.username, IP: blueSocket.handshake.address}, {
                    RedTeam, Username: redData.username, IP: redSocket.handshake.address
                }];
                let game = {
                    players,
                    roomName: RoomName,
                    gameServer: socket.id,
                    index: GameIndex,
                    serverIP: socket.handshake.address,
                    TimeRegistered: Date()
                }
                mongoDB.insertOne(game);

                players = [BlueTeam, RedTeam];
                let gameData = new GameData(RoomName, players, socket.id)
                gameData.timeout = setTimeout(() => {
                    if (blueData.ready && redData.ready)
                        return;

                    if (typeof GetPlayerSocket(blueData.gameserver) === 'undefined')
                        return;

                    if (typeof blueSocket === 'undefined')
                        return;

                    if (typeof redSocket === 'undefined')
                        return;

                    let now = Date.now();
                    blueData.ready = true;
                    blueData.gameStarted = now;
                    redData.ready = true;
                    redData.gameStarted = now;

                    StartReadyCountForGame(gameData.RoomName);
                }, 30000);
                RegisteredGames.push(gameData);
            } else {
                PutIntoMatchMaking(BlueTeam, RedTeam);
                socket.emit('ResetGame', RoomName);
            }

            CheckMatchMaking();
        });

        socket.on('UpdateSelection', ({SocketID, Selection}) => {
            let playerData = GetPlayerData(SocketID);
            playerData.selected = Selection;
        });

        socket.on('GameStates', ({netGames}) => {
            for (let i = 0; i < netGames.length; i++) {
                let {state, roomName} = netGames[i];
                socket.in(roomName).emit('GameState', state);
            }
        });

        socket.on('GameScores', (GameScore) => {
            let {roomName, scores} = GameScore;
            let BlueScore = scores[0];
            let RedScore = scores[1];
            let result = {$set: {Scores: {BlueScore, RedScore}}};
            let filter = {roomName};
            let options = {upsert: false};
            mongoDB.updateOne(filter, result, options);
        });

        socket.on('ReportScore', ({GameIndex, RoomName, Scores}) => {
            //When setting up a game GameIndex is assigned.
            //Need to generate an object to maintain the score in games.
            socket.in(RoomName).emit('Score', Scores);
        });

        socket.emit('RegisteredAsGameServer');

    }

    /**
     * Player Joins
     */
    //Clients will have the token changed during patches. This will maintain the update status of the game.
    if (token === PLAYER_PASSWORD) {
        socket.on('RegisterPlayer', ({Username, TimeNow, hash}) => {

            let time = Date.now();
            if (time - TimeNow > 2000)
                return;
            let Complete = Username + MASTER_HASH_SALT + TimeNow;
            bcrypt.compare(Complete, hash, function(err, result) {
                if (!result)
                    return;

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

                socket.on('Solo', () => {
                    if (playerData.inGame && !playerData.lookingForGame)
                        return;
                    SoloRequest(socket.id);
                });

                socket.on('Play', () => {
                    if (playerData.inGame && !playerData.lookingForGame)
                        return;

                    playerData.lookingForGame = true;
                    let MM = {
                        socket: socket.id, Solo: false
                    }
                    //MatchMaking.push(socket.id);
                    MatchMaking.push(MM);
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
                    playerData.actions = 0;
                    //let playerData = GetPlayerData(team);
                    if (playerData.currentEnemy !== '-1') {
                        let enemyData = GetPlayerData(playerData.currentEnemy);
                        if (enemyData.ready) {
                            let now = Date.now();
                            enemyData.gameStarted = now;
                            playerData.gameStarted = now;
                            StartReadyCountForGame(playerData.currentGame, playerData.gameIndex);
                        }

                        let enemy = GetPlayerSocket(playerData.currentEnemy);
                        enemy.emit('EnemyReady');
                    } else {
                        playerData.gameStarted = Date.now();
                        StartReadyCountForGame(playerData.currentGame, playerData.gameIndex);
                    }
                });

                socket.on('LeaveGame', () => LeaveGame(socket.id, socket.data.playerData));

                socket.on('LeaveQueue', () => {
                    if (!playerData.lookingForGame)
                        return;

                    RemovePlayerFromMatchMaking(socket.id);
                    playerData.lookingForGame = false;
                });

                socket.on('Stop', () => {
                    if (!playerData.inGame)
                        return;

                    let stopOrder = {
                        GameID: playerData.gameIndex,
                        Team: playerData.currentTeam
                    };

                    let gameServer = playerData.gameserver;
                    playerData.actions++;

                    io.to(gameServer).emit("Stop", stopOrder);
                });

                socket.on('Selection', (Selection) => {
                    if (!playerData.inGame)
                        return;

                    let passed = NewCheckValidSelection(Selection);
                    if (!passed)
                        return;

                    playerData.selected = Selection;
                    playerData.actions++;
                    let gameServer = playerData.gameserver;
                    let selection = {
                        GameID: playerData.gameIndex,
                        Selected: Selection,
                        Team: playerData.currentTeam
                    };
                    io.to(gameServer).emit('Selection', selection);
                });

                socket.on('Sprint', ({Position}) => {
                    if (!playerData.inGame)
                        return;

                    let passedCheck = CheckValidPosition(Position);
                    if (!passedCheck)
                        return;

                    let point = {x: Position.x, z: Position.z};

                    let newPoint = {
                        GameID: playerData.gameIndex,
                        Point: point,
                        Team: playerData.currentTeam
                    };
                    let gameServer = playerData.gameserver;
                    playerData.actions++;
                    io.to(gameServer).emit("Sprint", newPoint);
                });

                socket.on('Click', ({Position}) => {
                    if (!playerData.inGame)
                        return;

                    let passedCheck = CheckValidPosition(Position);
                    if (!passedCheck)
                        return;

                    let point = {x: Position.x, z: Position.z};

                    let newPoint = {
                        GameID: playerData.gameIndex,
                        Point: point,
                        Team: playerData.currentTeam
                    };
                    let gameServer = playerData.gameserver;
                    playerData.actions++;
                    io.to(gameServer).emit("Click", newPoint);
                });
            });

        });
    }
    socket.on('disconnect', () => {
        if (isGameServer) {

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
