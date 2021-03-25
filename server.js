require('dotenv').config();
const PORT = process.env.PORT;
const io = require('socket.io')(PORT);
const GAMESERVERPASSWORD = process.env.PSWORD;
var hasGameServer = false;
var GameServerCount = 0;

StartServer();

async function StartServer() {
    io.on('connection', Connect);
    console.log("Started Server");
}

function Connect(socket) {
    let isGameServer = false;
    socket.on('RegisterGameServer', ({APIKEY})=> {
        if (APIKEY == GAMESERVERPASSWORD) {
            isGameServer = true;
            hasGameServer = true;
            GameServerCount++;
            console.log(`Game Server Registered. Game Server Count ${GameServerCount}`);
        } else {
            console.log(`Game Server Attempt Incorrect password`);
            socket.disconnect(true);
        }
    });

    socket.on('RegisterPlayer', ({UserName}) => {
        console.log(`RegisterPlayer ${UserName}`);
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