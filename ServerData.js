let {GameState} = require('./GameState')
class ServerData {
    constructor(position = 0, id = '', status = STATUS.OPEN) {
        this.position = position;
        this.id = id;
        this.status = status;
        this.gamesOpen = 0;
        this.firstRun = true;
        //this.GameStates = [];
        //for(let i = 0; i < 30; i++) {
        //    let gs = new GameState();
        //    this.GameStates[i] = gs;
        //}
    }
}
const STATUS = { FULL: 1, OPEN: 2, LATER: 3 };
module.exports = { ServerData, STATUS };