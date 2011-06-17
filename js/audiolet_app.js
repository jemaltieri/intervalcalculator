window.onload = function() {
    var Synth = function(audiolet, frequency, amp) {
        AudioletGroup.apply(this, [audiolet, 0, 1]);
        this.sine = new Sine(this.audiolet, frequency);
        this.gain = new Gain(this.audiolet, amp);
        this.sine.connect(this.gain);
        this.gain.connect(this.outputs[0]);
    };
    extend(Synth, AudioletGroup);

    var AudioletApp = function() {
        this.audiolet = new Audiolet();
        var synth = new Synth(this.audiolet, 300, 0.3);
        synth.connect(this.audiolet.output);
    };

    this.audioletApp = new AudioletApp();
};
