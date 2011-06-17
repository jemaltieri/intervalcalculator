/**
 * @depends BiquadFilter.js
 */

// Maths from http://www.musicdsp.org/files/Audio-EQ-Cookbook.txt
var LowPassFilter = function(audiolet, frequency) {
    BiquadFilter.call(this, audiolet, frequency);
};
extend(LowPassFilter, BiquadFilter);

LowPassFilter.prototype.calculateCoefficients = function(frequency) {
    var w0 = 2 * Math.PI * frequency /
             this.audiolet.device.sampleRate;
    var cosw0 = Math.cos(w0);
    var sinw0 = Math.sin(w0);
    var alpha = sinw0 / (2 / Math.sqrt(2));

    this.b0 = (1 - cosw0) / 2;
    this.b1 = 1 - cosw0;
    this.b2 = this.b0;
    this.a0 = 1 + alpha;
    this.a1 = -2 * cosw0;
    this.a2 = 1 - alpha;
};

LowPassFilter.prototype.toString = function() {
    return 'Low Pass Filter';
};
