class Prompter {
    rl;
    io;

    constructor(io) {
        let readline = require('readline');
        this.io = io;
        this.rl = readline.createInterface( { input: process.stdin, output: process.stdout, terminal: false });
        this.Prompt();
    }


    Prompt() {
        this.rl.question('> ', (answer) => {
            //console.log('Thank you for your valuable feedback:', answer);
            this.ProcessLine(answer);
            this.Prompt();
        });
    }

    ProcessLine(d) {

        let haveMultiMessage = d.indexOf(' ');
        let index = haveMultiMessage !== -1 ? haveMultiMessage : d.length;
        let message = d.substring(0, index);
        let rest = d.substring(index+1, d.length);
        rest = JSON.parse(rest);
        console.log('message', message, 'rest', rest)
        switch (message) {
            case 'Shutdown':
            case 'shutdown':
                let { time } = rest;
                if (typeof time !== 'number')
                    break;
                console.log("Initiating Shut Down");
                this.io.sockets.emit('ShutDown');

                //Tell all players of intended shut down
                //Start a timer
                //Don't allow new games
                //Tell new people joining server about the shut down
                //Have the Game Servers reload their current scene
                //Once all the Game Servers have been reset. Restart Relay server
                break;
            case 'Restart':
            case 'restart':
                console.log("Initiating Restart");

                break;
            case 'message':
                let {t, m} = rest;
                if (typeof t === 'undefined' || typeof m === 'undefined')
                    break;
                this.io.sockets.emit(t, m);
                console.log(`Sent \"${t}\" -> \"${m}\" to all players`)
                break;
            default:
                console.log(d);
                break;

        }
    };
}
module.exports = { Prompter };