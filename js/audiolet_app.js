window.onload = function() {
    var Synth = function(audiolet, frequency, amp, xpan) {
        AudioletGroup.apply(this, [audiolet, 0, 1]);
        this.sine = new Sine(this.audiolet, frequency);
        this.gain = new Gain(this.audiolet, amp);
        this.pan = new Pan(this.audiolet, xpan);
        this.sine.connect(this.gain);
        this.gain.connect(this.pan);
        this.pan.connect(this.outputs[0]);
    };
    extend(Synth, AudioletGroup);

    var AudioletApp = function() {
        this.audiolet = new Audiolet();
        synths[0] = new Synth(this.audiolet, 440, 0.0, 0.0);
        synths[0].connect(this.audiolet.output);
        synths[0].gain.gain.setValue(0);
        synths[1] = new Synth(this.audiolet, 440, 0.0, 1.0);
        synths[1].connect(this.audiolet.output);
        synths[1].gain.gain.setValue(0);
    };

    this.audioletApp = new AudioletApp();
    updateResult();
};
