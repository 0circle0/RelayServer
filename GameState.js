class GameState {
    LastFrame;
    Score;
    PlayerNames;

    constructor() {
        this.SetupForGame();
    }

    SetupForGame(playerNames = ['', ''], scores = [0, 0], Frame = {}) {
        this.SetScore(scores);
        this.SetPlayerNames(playerNames);
        this.SetCurrentFrame(Frame);
    }

    SetCurrentFrame(Frame = {}) {
        this.LastFrame = Frame;
    }

    SetScore(scores = [0, 0]) {
        this.Score = scores;
    }

    SetPlayerNames(playerNames = ['', '']) {
        this.PlayerNames = playerNames;
    }
}

module.exports = {GameState};