class ServerData {
    constructor(position = 0, id = '', status = STATUS.OPEN) {
        this.position = position;
        this.id = id;
        this.status = status;
        this.gamesOpen = 0;
    }
}
const STATUS = { FULL: 1, OPEN: 2, LATER: 3 };
module.exports = { ServerData, STATUS };