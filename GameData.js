class GameData {
    constructor(roomName, players, owner) {
        this.RoomName = roomName;
        this.Players = players;
        this.GameServerOwner = owner;
    }
}

module.exports = { GameData };