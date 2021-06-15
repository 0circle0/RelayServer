class PlayerData {
    constructor() {
        this.lookingForGame = false;
        this.inGame = false;
        this.currentGame = '';
        this.currentEnemy = '';
        this.currentTeam = -1;
        this.gameserver = '';
        this.gameIndex = -1;
        this.playAgain = false;
        this.responded = false;
        this.ready = false;
        this.username = '';
        this.selected = [false, false, false, false, false, false];
        this.observing = false;
        this.actions = 0;
        this.gameStarted = 0;
    }
}
module.exports = { PlayerData };