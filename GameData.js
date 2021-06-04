class GameData {
    constructor(roomName, players, owner) {
        this.RoomName = roomName;
        this.Players = players;
        this.GameServerOwner = owner;
        this.timeout = setTimeout(()=>{});
    }
}

module.exports = { GameData };