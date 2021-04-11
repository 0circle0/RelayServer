class PlayerData {
    constructor() {
        this.lookingForGame = false;
        this.inGame = false;
        this.currentGame = '';
        this.currentEnemy = '';
        this.gameserver = '';
        this.playAgain = false;
        this.responded = false;
        this.ready = false;
        this.username = '';
        this.selected = [false, false, false, false, false, false];
        this.observing = false;
    }
}
module.exports = { PlayerData };