/**
 * The basic building block of Audiolet applications.  Nodes are connected
 * together to create a processing graph which governs the flow of audio data.
 * AudioletNodes can contain any number of inputs and outputs which send and
 * receive one or more channels of audio data.  Audio data is created and
 * processed using the generate function, which is called whenever new data is
 * needed.
 *
 * @constructor
 * @param {Audiolet} audiolet The audiolet object.
 * @param {Number} numberOfInputs The number of inputs.
 * @param {Number} numberOfOutputs The number of outputs.
 * @param {Function} [generate] A replacement for the generate function.
 */
var AudioletNode = function(audiolet, numberOfInputs, numberOfOutputs,
                            generate) {
    this.audiolet = audiolet;
    this.numberOfInputs = numberOfInputs;
    this.numberOfOutputs = numberOfOutputs;

    this.inputs = [];
    var numberOfInputs = this.numberOfInputs;
    for (var i = 0; i < numberOfInputs; i++) {
        this.inputs.push(new AudioletInput(this, i));
    }

    this.outputs = [];
    var numberOfOutputs = this.numberOfOutputs;
    for (var i = 0; i < numberOfOutputs; i++) {
        this.outputs.push(new AudioletOutput(this, i));
    }

    if (generate) {
        this.generate = generate;
    }

    this.timestamp = null;
};

/**
 * Connect the node to another node or group.
 *
 * @param {AudioletNode|AudioletGroup} node The node to connect to.
 * @param {Number} [output=0] The index of the output to connect from.
 * @param {Number} [input=0] The index of the input to connect to.
 */
AudioletNode.prototype.connect = function(node, output, input) {
    if (node instanceof AudioletGroup) {
        // Connect to the pass-through node rather than the group
        node = node.inputs[input || 0];
        input = 0;
    }
    var outputPin = this.outputs[output || 0];
    var inputPin = node.inputs[input || 0];
    outputPin.connect(inputPin);
    inputPin.connect(outputPin);
};

/**
 * Disconnect the node from another node or group
 *
 * @param {AudioletNode|AudioletGroup} node The node to disconnect from.
 * @param {Number} [output=0] The index of the output to disconnect.
 * @param {Number} [input=0] The index of the input to disconnect.
 */
AudioletNode.prototype.disconnect = function(node, output, input) {
    if (node instanceof AudioletGroup) {
        node = node.inputs[input || 0];
        input = 0;
    }

    var outputPin = this.outputs[output || 0];
    var inputPin = node.inputs[input || 0];
    inputPin.disconnect(outputPin);
    outputPin.disconnect(inputPin);
};

/**
 * Force an output to contain a fixed number of channels.
 *
 * @param {Number} output The index of the output.
 * @param {Number} numberOfChannels The number of channels.
 */
AudioletNode.prototype.setNumberOfOutputChannels = function(output,
                                                            numberOfChannels) {
    this.outputs[output].numberOfChannels = numberOfChannels;
};

/**
 * Link an output to an input, forcing the output to always contain the
 * same number of channels as the input.
 *
 * @param {Number} output The index of the output.
 * @param {Number} input The index of the input.
 */
AudioletNode.prototype.linkNumberOfOutputChannels = function(output, input) {
    this.outputs[output].linkNumberOfChannels(this.inputs[input]);
};

/**
 * Process a buffer of samples, first pulling any necessary data from
 * higher up the processing graph.  This function should not be called
 * manually by users, who should instead rely on automatic ticking from
 * connections to the AudioletDevice.
 *
 * @param {Number} length The number of samples to process.
 * @param {Number} timestamp A timestamp for the block of samples.
 */
AudioletNode.prototype.tick = function(length, timestamp) {
    if (timestamp != this.timestamp) {
        // Need to set the timestamp before we tick the parents so we
        // can't get into infinite loops where there is feedback in the
        // graph
        this.timestamp = timestamp;
        this.tickParents(length, timestamp);

        var inputBuffers = this.createInputBuffers(length);
        var outputBuffers = this.createOutputBuffers(length);

        this.generate(inputBuffers, outputBuffers);
    }
};

/**
 * Call the tick function on nodes which are connected to the inputs.  This
 * function should not be called manually by users.
 *
 * @param {Number} length The number of samples to process.
 * @param {Number} timestamp A timestamp for the block of samples.
 */
AudioletNode.prototype.tickParents = function(length, timestamp) {
    var numberOfInputs = this.numberOfInputs;
    for (var i = 0; i < numberOfInputs; i++) {
        var input = this.inputs[i];
        var numberOfStreams = input.connectedFrom.length;
        // Tick backwards, as the input may disconnect itself during the
        // loop
        for (var j = 0; j < numberOfStreams; j++) {
            var index = numberOfStreams - j - 1;
            input.connectedFrom[index].node.tick(length, timestamp);
        }
    }
};

/**
 * Process a block of samples, reading from the input buffers and putting
 * new values into the output buffers.  Override me!
 *
 * @param {AudioletBuffer[]} inputBuffers Samples received from the inputs.
 * @param {AudioletBuffer[]} outputBuffers Samples to be sent to the outputs.
 */
AudioletNode.prototype.generate = function(inputBuffers, outputBuffers) {
    // Sane default - pass along any empty flags
    var numberOfInputs = inputBuffers.length;
    var numberOfOutputs = outputBuffers.length;
    for (var i = 0; i < numberOfInputs; i++) {
        if (i < numberOfOutputs && inputBuffers[i].isEmpty) {
            outputBuffers[i].isEmpty = true;
        }
    }
};

/**
 * Create the input buffers by grabbing data from the outputs of connected
 * nodes and summing it.  If no nodes are connected to an input, then
 * give a one channel empty buffer.
 *
 * @param {Number} length The number of samples for the resulting buffers.
 * @return {AudioletBuffer[]} The input buffers.
 */
AudioletNode.prototype.createInputBuffers = function(length) {
    var inputBuffers = [];
    var numberOfInputs = this.numberOfInputs;
    for (var i = 0; i < numberOfInputs; i++) {
        var input = this.inputs[i];

        // Find the non-empty output with the most channels
        var numberOfChannels = 0;
        var largestOutput = null;
        var connectedFrom = input.connectedFrom;
        var numberOfConnections = connectedFrom.length;
        for (var j = 0; j < numberOfConnections; j++) {
            var output = connectedFrom[j];
            var outputBuffer = output.buffer;
            if (outputBuffer.numberOfChannels > numberOfChannels &&
                !outputBuffer.isEmpty) {
                numberOfChannels = outputBuffer.numberOfChannels;
                largestOutput = output;
            }
        }

        if (largestOutput) {
            // TODO: Optimizations
            // We have non-empty connections

            // Resize the input buffer accordingly
            var inputBuffer = input.buffer;
            inputBuffer.resize(numberOfChannels, length, true);
            inputBuffer.isEmpty = false;

            // Set the buffer using the largest output
            inputBuffer.set(largestOutput.getBuffer(length));

            // Sum the rest of the outputs
            for (var j = 0; j < numberOfConnections; j++) {
                var output = connectedFrom[j];
                if (output != largestOutput && !output.buffer.isEmpty) {
                    inputBuffer.add(output.getBuffer(length));
                }
            }

            inputBuffers.push(inputBuffer);
        }
        else {
            // If we don't have any non-empty connections give a single
            // channel empty buffer of the correct length
            var inputBuffer = input.buffer;
            inputBuffer.resize(1, length, true);
            inputBuffer.isEmpty = true;
            inputBuffers.push(inputBuffer);
        }
    }
    return inputBuffers;
};

/**
 * Create output buffers of the correct length.
 *
 * @param {Number} length The number of samples for the resulting buffers.
 * @return {AudioletNode[]} The output buffers.
 */
AudioletNode.prototype.createOutputBuffers = function(length) {
    // Create the output buffers
    var outputBuffers = [];
    var numberOfOutputs = this.numberOfOutputs;
    for (var i = 0; i < numberOfOutputs; i++) {
        var output = this.outputs[i];
        output.buffer.resize(output.getNumberOfChannels(), length, true);
        output.buffer.isEmpty = false;
        outputBuffers.push(output.buffer);
    }
    return (outputBuffers);
};

/**
 * Remove the node completely from the processing graph, disconnecting all
 * of its inputs and outputs.
 */
AudioletNode.prototype.remove = function() {
    // Disconnect inputs
    var numberOfInputs = this.inputs.length;
    for (var i = 0; i < numberOfInputs; i++) {
        var input = this.inputs[i];
        var numberOfStreams = input.connectedFrom.length;
        for (var j = 0; j < numberOfStreams; j++) {
            var outputPin = input.connectedFrom[j];
            var output = outputPin.node;
            output.disconnect(this, outputPin.index, i);
        }
    }

    // Disconnect outputs
    var numberOfOutputs = this.outputs.length;
    for (var i = 0; i < numberOfOutputs; i++) {
        var output = this.outputs[i];
        var numberOfStreams = output.connectedTo.length;
        for (var j = 0; j < numberOfStreams; j++) {
            var inputPin = output.connectedTo[j];
            var input = inputPin.node;
            this.disconnect(input, i, inputPin.index);
        }
    }
};


/*!
 * @depends AudioletNode.js
 */

/**
 * An abstract base class for audio output devices
 *
 * @constructor
 * @extends AudioletNode
 * @param {Audiolet} audiolet The audiolet object.
 */
var AbstractAudioletDevice = function(audiolet) {
    AudioletNode.call(this, audiolet, 1 , 0);
    this.audiolet = audiolet;
    this.buffer = null;
};
extend(AbstractAudioletDevice, AudioletNode);

/**
 * Default generate function.  Makes the input buffer available as a
 * member.
 *
 * @param {AudioletBuffer[]} inputBuffers An array containing the input buffer.
 * @param {AudioletBuffer[]} outputBuffers An empty array.
 */
AbstractAudioletDevice.prototype.generate = function(inputBuffers,
                                                     outputBuffers) {
    this.buffer = inputBuffers[0];
};

/**
 * Default playback time function.
 *
 * @return {Number} Zero.
 */
AbstractAudioletDevice.prototype.getPlaybackTime = function() {
    return 0;
};

/**
 * Default write time function.
 *
 * @return {Number} Zero.
 */
AbstractAudioletDevice.prototype.getWriteTime = function() {
    return 0;
};

/**
 * toString
 *
 * @return {String} String representation.
 */
AbstractAudioletDevice.prototype.toString = function() {
    return 'Device';
};

/**
 * @depends AbstractAudioletDevice.js
 */

var AudioDataAPIDevice = function(audiolet, sampleRate, numberOfChannels,
                                  bufferSize) {
    AbstractAudioletDevice.call(this, audiolet);

    this.sampleRate = sampleRate || 44100.0;
    this.numberOfChannels = numberOfChannels || 2;
    if (bufferSize) {
        this.bufferSize = bufferSize;
        this.autoLatency = false;
    }
    else {
        this.bufferSize = this.sampleRate * 0.02;
        this.autoLatency = true;
    }

    this.output = new Audio();
    this.baseOverflow = null;
    this.overflow = null;
    this.overflowOffset = 0;
    this.writePosition = 0;

    this.output.mozSetup(this.numberOfChannels, this.sampleRate);

    this.started = new Date().valueOf();
    this.interval = setInterval(this.tick.bind(this), 10);
};
extend(AudioDataAPIDevice, AbstractAudioletDevice);

AudioDataAPIDevice.prototype.tick = function() {
    var outputPosition = this.output.mozCurrentSampleOffset();
    // Check if some data was not written in previous attempts
    var numSamplesWritten;
    if (this.overflow) {
        numSamplesWritten = this.output.mozWriteAudio(this.overflow);
        if (numSamplesWritten == 0) return;
        this.writePosition += numSamplesWritten;
        if (numSamplesWritten < this.overflow.length) {
            // Not all the data was written, saving the tail for writing
            // the next time fillBuffer is called
            // Begin broken subarray-of-subarray fix
            this.overflowOffset += numSamplesWritten;
            this.overflow = this.baseOverflow.subarray(this.overflowOffset);
            // End broken subarray-of-subarray fix
            // Uncomment the following line when subarray-of-subarray is
            // sorted
            //this.overflow = this.overflow.subarray(numSamplesWritten);
            return;
        }
        this.overflow = null;
    }

    var samplesNeeded = outputPosition +
        (this.bufferSize * this.numberOfChannels) -
        this.writePosition;

    if (this.autoLatency) {
        var delta = (new Date().valueOf() - this.started) / 1000;
        this.bufferSize = this.sampleRate * delta;
        if (outputPosition) {
            this.autoLatency = false;
        }
    }

    if (samplesNeeded >= this.numberOfChannels) {
        // Samples needed per channel
        samplesNeeded = Math.floor(samplesNeeded / this.numberOfChannels);
        // Request some sound data from the callback function.
        AudioletNode.prototype.tick.call(this, samplesNeeded,
                                         this.getWriteTime());
        var buffer = this.buffer.interleaved();

        // Writing the data.
        numSamplesWritten = this.output.mozWriteAudio(buffer);
        this.writePosition += numSamplesWritten;
        if (numSamplesWritten < buffer.length) {
            // Not all the data was written, saving the tail.
            // Begin broken subarray-of-subarray fix
            this.baseOverflow = buffer;
            this.overflowOffset = numSamplesWritten;
            // End broken subarray-of-subarray fix
            this.overflow = buffer.subarray(numSamplesWritten);
        }
    }
};

AudioDataAPIDevice.prototype.getPlaybackTime = function() {
    return this.output.mozCurrentSampleOffset() / this.numberOfChannels;
};

AudioDataAPIDevice.prototype.getWriteTime = function() {
    return this.writePosition / this.numberOfChannels;
};

AudioDataAPIDevice.prototype.toString = function() {
    return 'Audio Data API Device';
};

var AudioletBuffer = function(numberOfChannels, length) {
    this.numberOfChannels = numberOfChannels;
    this.length = length;

    this.channels = [];
    for (var i = 0; i < this.numberOfChannels; i++) {
        this.channels.push(new Float32Array(length));
    }

    this.unslicedChannels = [];
    for (var i = 0; i < this.numberOfChannels; i++) {
        this.unslicedChannels.push(this.channels[i]);
    }

    this.isEmpty = false;
    this.channelOffset = 0;
};

AudioletBuffer.prototype.getChannelData = function(channel) {
    return (this.channels[channel]);
};

AudioletBuffer.prototype.set = function(buffer) {
    var numberOfChannels = buffer.numberOfChannels;
    for (var i = 0; i < numberOfChannels; i++) {
        this.channels[i].set(buffer.getChannelData(i));
    }
};

AudioletBuffer.prototype.setSection = function(buffer, length, inputOffset,
                                               outputOffset) {
    inputOffset = inputOffset || 0;
    outputOffset = outputOffset || 0;
    var numberOfChannels = buffer.numberOfChannels;
    for (var i = 0; i < numberOfChannels; i++) {
        // Begin subarray-of-subarray fix
        inputOffset += buffer.channelOffset;
        outputOffset += this.channelOffset;
        var channel1 = this.unslicedChannels[i].subarray(outputOffset,
                outputOffset +
                length);
        var channel2 = buffer.unslicedChannels[i].subarray(inputOffset,
                inputOffset +
                length);
        // End subarray-of-subarray fix
        // Uncomment the following lines when subarray-of-subarray is fixed
        /*
           var channel1 = this.getChannelData(i).subarray(outputOffset,
           outputOffset +
           length);
           var channel2 = buffer.getChannelData(i).subarray(inputOffset,
           inputOffset +
           length);
         */
        channel1.set(channel2);
    }
};

AudioletBuffer.prototype.add = function(buffer) {
    var length = this.length;
    var numberOfChannels = buffer.numberOfChannels;
    for (var i = 0; i < numberOfChannels; i++) {
        var channel1 = this.getChannelData(i);
        var channel2 = buffer.getChannelData(i);
        for (var j = 0; j < length; j++) {
            channel1[j] += channel2[j];
        }
    }
};

AudioletBuffer.prototype.addSection = function(buffer, length, inputOffset,
                                               outputOffset) {
    inputOffset = inputOffset || 0;
    outputOffset = outputOffset || 0;
    var numberOfChannels = buffer.numberOfChannels;
    for (var i = 0; i < numberOfChannels; i++) {
        var channel1 = this.getChannelData(i);
        var channel2 = buffer.getChannelData(i);
        for (var j = 0; j < length; j++) {
            channel1[j + outputOffset] += channel2[j + inputOffset];
        }
    }
};

AudioletBuffer.prototype.resize = function(numberOfChannels, length, lazy,
                                           offset) {
    offset = offset || 0;
    // Local variables
    var channels = this.channels;
    var unslicedChannels = this.unslicedChannels;

    var oldLength = this.length;
    var channelOffset = this.channelOffset + offset;

    for (var i = 0; i < numberOfChannels; i++) {
        // Get the current channels
        var channel = channels[i];
        var unslicedChannel = unslicedChannels[i];

        if (length > oldLength) {
            // We are increasing the size of the buffer
            var oldChannel = channel;

            if (!lazy ||
                    !unslicedChannel ||
                    unslicedChannel.length < length) {
                // Unsliced channel is not empty when it needs to be,
                // does not exist, or is not large enough, so needs to be
                // (re)created
                unslicedChannel = new Float32Array(length);
            }

            channel = unslicedChannel.subarray(0, length);

            if (!lazy && oldChannel) {
                channel.set(oldChannel, offset);
            }

            channelOffset = 0;
        }
        else {
            // We are decreasing the size of the buffer
            if (!unslicedChannel) {
                // Unsliced channel does not exist
                // We can assume that we always have at least one unsliced
                // channel, so we can copy its length
                var unslicedLength = unslicedChannels[0].length;
                unslicedChannel = new Float32Array(unslicedLength);
            }
            // Begin subarray-of-subarray fix
            offset = channelOffset;
            channel = unslicedChannel.subarray(offset, offset + length);
            // End subarray-of-subarray fix
            // Uncomment the following lines when subarray-of-subarray is
            // fixed.
            // TODO: Write version where subarray-of-subarray is used
        }
        channels[i] = channel;
        unslicedChannels[i] = unslicedChannel;
    }

    this.channels = channels.slice(0, numberOfChannels);
    this.unslicedChannels = unslicedChannels.slice(0, numberOfChannels);
    this.length = length;
    this.numberOfChannels = numberOfChannels;
    this.channelOffset = channelOffset;
};

AudioletBuffer.prototype.push = function(buffer) {
    var bufferLength = buffer.length;
    this.resize(this.numberOfChannels, this.length + bufferLength);
    this.setSection(buffer, bufferLength, 0, this.length - bufferLength);
};

AudioletBuffer.prototype.pop = function(buffer) {
    var bufferLength = buffer.length;
    var offset = this.length - bufferLength;
    buffer.setSection(this, bufferLength, offset, 0);
    this.resize(this.numberOfChannels, offset);
};

AudioletBuffer.prototype.unshift = function(buffer) {
    var bufferLength = buffer.length;
    this.resize(this.numberOfChannels, this.length + bufferLength, false,
            bufferLength);
    this.setSection(buffer, bufferLength, 0, 0);
};

AudioletBuffer.prototype.shift = function(buffer) {
    var bufferLength = buffer.length;
    buffer.setSection(this, bufferLength, 0, 0);
    this.resize(this.numberOfChannels, this.length - bufferLength,
            false, bufferLength);
};

AudioletBuffer.prototype.zero = function() {
    var numberOfChannels = this.numberOfChannels;
    for (var i = 0; i < numberOfChannels; i++) {
        var channel = this.getChannelData(i);
        var length = this.length;
        for (var j = 0; j < length; j++) {
            channel[j] = 0;
        }
    }
};

AudioletBuffer.prototype.combined = function() {
    var channels = this.channels;
    var numberOfChannels = this.numberOfChannels;
    var length = this.length;
    var combined = new Float32Array(numberOfChannels * length);
    for (var i = 0; i < numberOfChannels; i++) {
        combined.set(channels[i], i * length);
    }
    return combined;
};

AudioletBuffer.prototype.interleaved = function() {
    var channels = this.channels;
    var numberOfChannels = this.numberOfChannels;
    var length = this.length;
    var interleaved = new Float32Array(numberOfChannels * length);
    for (var i = 0; i < length; i++) {
        for (var j = 0; j < numberOfChannels; j++) {
            interleaved[numberOfChannels * i + j] = channels[j][i];
        }
    }
    return interleaved;
};

AudioletBuffer.prototype.copy = function() {
    var buffer = new AudioletBuffer(this.numberOfChannels, this.length);
    buffer.set(this);
    return buffer;
};

AudioletBuffer.prototype.load = function(path, async, callback) {
    var request = new AudioFileRequest(path, async);
    request.onSuccess = function(decoded) {
        this.length = decoded.length;
        this.numberOfChannels = decoded.channels.length;
        this.unslicedChannels = decoded.channels;
        this.channels = decoded.channels;
        this.channelOffset = 0;
        if (callback) {
            callback();
        }
    }.bind(this);

    request.onFailure = function() {
        console.error('Could not load', path);
    }.bind(this);

    request.send();
};

/**
 * A container for collections of connected AudioletNodes.  Groups make it
 * possible to create multiple copies of predefined networks of nodes,
 * without having to manually create and connect up each individual node.
 *
 * From the outside groups look and behave exactly the same as nodes.
 * Internally you can connect nodes directly to the group's inputs and
 * outputs, allowing connection to nodes outside of the group.
 *
 * @constructor
 * @param {Audiolet} audiolet The audiolet object.
 * @param {Number} numberOfInputs The number of inputs.
 * @param {Number} numberOfOutputs The number of outputs.
 */
var AudioletGroup = function(audiolet, numberOfInputs, numberOfOutputs) {
    this.audiolet = audiolet;
    this.numberOfInputs = numberOfInputs;
    this.numberOfOutputs = numberOfOutputs;

    this.inputs = [];
    for (var i = 0; i < numberOfInputs; i++) {
        this.inputs.push(new PassThroughNode(this.audiolet, 1, 1));
    }

    this.outputs = [];
    for (var i = 0; i < numberOfOutputs; i++) {
        this.outputs.push(new PassThroughNode(this.audiolet, 1, 1));
    }
};

/**
 * Connect the group to another node or group
 *
 * @param {AudioletNode|AudioletGroup} node The node to connect to.
 * @param {Number} [output=0] The index of the output to connect from.
 * @param {Number} [input=0] The index of the input to connect to.
 */
AudioletGroup.prototype.connect = function(node, output, input) {
    this.outputs[output || 0].connect(node, 0, input);
};

/**
 * Disconnect the group from another node or group
 *
 * @param {AudioletNode|AudioletGroup} node The node to disconnect from.
 * @param {Number} [output=0] The index of the output to disconnect.
 * @param {Number} [input=0] The index of the input to disconnect.
 */
AudioletGroup.prototype.disconnect = function(node, output, input) {
    this.outputs[output || 0].disconnect(node, 0, input);
};

/**
 * Remove the group completely from the processing graph, disconnecting all
 * of its inputs and outputs
 */
AudioletGroup.prototype.remove = function() {
    var numberOfInputs = this.inputs.length;
    for (var i = 0; i < numberOfInputs; i++) {
        this.inputs[i].remove();
    }

    var numberOfOutputs = this.outputs.length;
    for (var i = 0; i < numberOfOutputs; i++) {
        this.outputs[i].remove();
    }
};

/**
 * @depends AudioletGroup.js
 */

var AudioletDestination = function(audiolet, sampleRate, numberOfChannels,
                                   bufferSize) {
    AudioletGroup.call(this, audiolet, 1, 0);

    this.device = new AudioletDevice(audiolet, sampleRate,
            numberOfChannels, bufferSize);
    audiolet.device = this.device; // Shortcut
    this.scheduler = new Scheduler(audiolet);
    audiolet.scheduler = this.scheduler; // Shortcut

    this.blockSizeLimiter = new BlockSizeLimiter(audiolet,
            Math.pow(2, 15));
    audiolet.blockSizeLimiter = this.blockSizeLimiter; // Shortcut

    this.upMixer = new UpMixer(audiolet, this.device.numberOfChannels);

    this.inputs[0].connect(this.blockSizeLimiter);
    this.blockSizeLimiter.connect(this.scheduler);
    this.scheduler.connect(this.upMixer);
    this.upMixer.connect(this.device);
};
extend(AudioletDestination, AudioletGroup);

AudioletDestination.prototype.toString = function() {
    return 'Destination';
};

function AudioletDevice(audiolet, sampleRate, numberOfChannels, bufferSize) {
    // Mozilla?
    var tmpAudio = new Audio();
    var haveAudioDataAPI = (typeof tmpAudio.mozSetup == 'function');
    tmpAudio = null;
    if (haveAudioDataAPI) {
        return (new AudioDataAPIDevice(audiolet, sampleRate, numberOfChannels,
                                       bufferSize));
    }
    // Webkit?
    else if (typeof AudioContext != 'undefined' ||
             typeof webkitAudioContext != 'undefined') {
        return (new WebAudioAPIDevice(audiolet, sampleRate, numberOfChannels,
                                      bufferSize));
    }
    else {
        return (new DummyDevice(audiolet, sampleRate, numberOfChannels,
                                bufferSize));
    }
}


var AudioletInput = function(node, index) {
    this.node = node;
    this.index = index;
    this.connectedFrom = [];
    // Minimum sized buffer, which we can resize from accordingly
    this.buffer = new AudioletBuffer(1, 0);
    // Overflow buffer, for feedback loops
    this.overflow = new AudioletBuffer(1, 0);
};

AudioletInput.prototype.connect = function(output) {
    this.connectedFrom.push(output);
};

AudioletInput.prototype.disconnect = function(output) {
    var numberOfStreams = this.connectedFrom.length;
    for (var i = 0; i < numberOfStreams; i++) {
        if (output == this.connectedFrom[i]) {
            this.connectedFrom.splice(i, 1);
            break;
        }
    }
};

AudioletInput.prototype.isConnected = function() {
    return (this.connectedFrom.length > 0);
};

AudioletInput.prototype.toString = function() {
    return this.node.toString() + 'Input #' + this.index;
};


/**
 * The base audiolet object.  Contains an output node which pulls data from
 * connected nodes.
 */
var Audiolet = function(sampleRate, numberOfChannels, bufferSize) {
    this.output = new AudioletDestination(this, sampleRate,
                                          numberOfChannels, bufferSize);
};


var AudioletOutput = function(node, index) {
    this.node = node;
    this.index = index;
    this.connectedTo = [];
    // External buffer where data pulled from the graph is stored
    this.buffer = new AudioletBuffer(1, 0);
    // Internal buffer for if we are in a feedback loop
    this.feedbackBuffer = new AudioletBuffer(1, 0);
    // Buffer to shift data into if we are in a feedback loop
    this.outputBuffer = new AudioletBuffer(1, 0);

    this.linkedInput = null;
    this.numberOfChannels = 1;

    this.suppliesFeedbackLoop = false;
    this.timestamp = null;
};

AudioletOutput.prototype.connect = function(input) {
    this.connectedTo.push(input);
};

AudioletOutput.prototype.disconnect = function(input) {
    var numberOfStreams = this.connectedTo.length;
    for (var i = 0; i < numberOfStreams; i++) {
        if (input == this.connectedTo[i]) {
            this.connectedTo.splice(i, 1);
            break;
        }
    }
};

AudioletOutput.prototype.isConnected = function() {
    return (this.connectedTo.length > 0);
};

AudioletOutput.prototype.linkNumberOfChannels = function(input) {
    this.linkedInput = input;
};

AudioletOutput.prototype.unlinkNumberOfChannels = function() {
    this.linkedInput = null;
};

AudioletOutput.prototype.getNumberOfChannels = function() {
    if (this.linkedInput && this.linkedInput.isConnected()) {
        return (this.linkedInput.buffer.numberOfChannels);
    }
    return (this.numberOfChannels);
};

AudioletOutput.prototype.getBuffer = function(length) {
    var buffer = this.buffer;
    if (buffer.length == length && !this.suppliesFeedbackLoop) {
        // Buffer not part of a feedback loop, so just return it
        return buffer;
    }
    else {
        // Buffer is part of a feedback loop, so we need to take care
        // of overflows.
        // Because feedback loops have to be connected to more than one
        // node, getBuffer will be called more than once.  To make sure
        // we only generate the output buffer once, store a timestamp.
        if (this.node.timestamp == this.timestamp) {
            // Buffer already generated by a previous getBuffer call
            return this.outputBuffer;
        }
        else {
            this.timestamp = this.node.timestamp;

            var feedbackBuffer = this.feedbackBuffer;
            var outputBuffer = this.outputBuffer;

            if (!this.suppliesFeedbackLoop) {
                this.suppliesFeedbackLoop = true;
                var limiter = this.node.audiolet.blockSizeLimiter;
                feedbackBuffer.resize(this.getNumberOfChannels(),
                                      limiter.maximumBlockSize, true);
            }

            // Resize feedback buffer to the correct number of channels
            feedbackBuffer.resize(this.getNumberOfChannels(),
                                  feedbackBuffer.length);

            // Resize output buffer to the correct size
            outputBuffer.resize(this.getNumberOfChannels(), length, true);

            // Buffer the output, so nodes on a later timestamp (i.e. nodes
            // in a feedback loop connected to this output) can pull
            // any amount up to maximumBlockSize without fear of overflow
            feedbackBuffer.push(buffer);
            feedbackBuffer.shift(outputBuffer);

            return outputBuffer;
        }
    }
};

AudioletOutput.prototype.toString = function() {
    return this.node.toString() + 'Output #' + this.index + ' - ';
};


var AudioletParameter = function(node, inputIndex, value) {
    this.node = node;
    if (typeof inputIndex != 'undefined' && inputIndex != null) {
        this.input = node.inputs[inputIndex];
    }
    else {
        this.input = null;
    }
    this.value = value || 0;
};

AudioletParameter.prototype.isStatic = function() {
    var input = this.input;
    return (input == null ||
            input.connectedFrom.length == 0 ||
            input.buffer.isEmpty);
};

AudioletParameter.prototype.isDynamic = function() {
    var input = this.input;
    return (input != null &&
            input.connectedFrom.length > 0 &&
            !input.buffer.isEmpty);
};

AudioletParameter.prototype.setValue = function(value) {
    this.value = value;
};

AudioletParameter.prototype.getValue = function() {
    return this.value;
};

AudioletParameter.prototype.getChannel = function() {
    return this.input.buffer.channels[0];
};

/**
 * @depends AudioletNode.js
 */

var BlockSizeLimiter = function(audiolet, maximumBlockSize) {
    AudioletNode.call(this, audiolet, 1, 1);
    this.maximumBlockSize = maximumBlockSize;
    this.linkNumberOfOutputChannels(0, 0);
};
extend(BlockSizeLimiter, AudioletNode);

BlockSizeLimiter.prototype.tick = function(length, timestamp) {
    var maximumBlockSize = this.maximumBlockSize;
    if (length < maximumBlockSize) {
        // Enough samples from the last tick and buffered, so just tick
        // and recalculate any overflow
        AudioletNode.prototype.tick.call(this, length, timestamp);
    }
    else {
        // Not enough samples available, so we will have to do it in blocks
        // of size maximumBlockSize
        var samplesGenerated = 0;
        var outputBuffers = null;
        while (samplesGenerated < length) {
            var samplesNeeded;
            // If length does not split exactly into the block size,
            // then do the small block size first, so at the end we still
            // have a lastTickSize equal to maximumBlockSize
            var smallBlockSize = length % maximumBlockSize;
            if (samplesGenerated == 0 && smallBlockSize) {
                samplesNeeded = smallBlockSize;
            }
            else {
                samplesNeeded = maximumBlockSize;
            }

            this.tickParents(samplesNeeded, timestamp + samplesGenerated);

            var inputBuffers = this.createInputBuffers(samplesNeeded);
            if (!outputBuffers) {
                outputBuffers = this.createOutputBuffers(length);
            }
            this.generate(inputBuffers, outputBuffers, samplesGenerated);

            samplesGenerated += samplesNeeded;
        }
    }
};

BlockSizeLimiter.prototype.generate = function(inputBuffers, outputBuffers,
                                               offset) {
    offset = offset || 0;
    var inputBuffer = inputBuffers[0];
    var outputBuffer = outputBuffers[0];
    if (inputBuffer.isEmpty) {
        outputBuffer.isEmpty = true;
        return;
    }
    outputBuffer.setSection(inputBuffer, inputBuffer.length,
                            0, offset);
};

BlockSizeLimiter.prototype.toString = function() {
    return 'Block Size Limiter';
};

/**
 * @depends AbstractAudioletDevice.js
 */

var DummyDevice = function(audiolet, sampleRate, numberOfChannels,
                           bufferSize) {
    AbstractAudioletDevice.call(this, audiolet);

    this.sampleRate = sampleRate || 44100.0;
    this.numberOfChannels = numberOfChannels || 2;
    this.bufferSize = bufferSize || 8192;

    this.writePosition = 0;

    setInterval(this.tick.bind(this),
                1000 * this.bufferSize / this.sampleRate);
};
extend(DummyDevice, AbstractAudioletDevice);

DummyDevice.prototype.tick = function() {
    AudioletNode.prototype.tick.call(this, this.bufferSize,
                                     this.writePosition);
    this.writePosition += this.bufferSize;
};

DummyDevice.prototype.getPlaybackTime = function() {
    return this.writePosition - this.bufferSize;
};

DummyDevice.prototype.getWriteTime = function() {
    return this.writePosition;
};

DummyDevice.prototype.toString = function() {
    return 'Dummy Device';
};

/*
 * A method for extending a javascript pseudo-class
 * Taken from
 * http://peter.michaux.ca/articles/class-based-inheritance-in-javascript
 *
 * @param {Object} subclass The class to extend.
 * @param {Object} superclass The class to be extended.
 */
function extend(subclass, superclass) {
    function Dummy() {}
    Dummy.prototype = superclass.prototype;
    subclass.prototype = new Dummy();
    subclass.prototype.constructor = subclass;
}

/**
 * @depends ../core/AudioletNode.js
 */

var ParameterNode = function(audiolet, value) {
    AudioletNode.call(this, audiolet, 1, 1);
    this.parameter = new AudioletParameter(this, 0, value);
};
extend(ParameterNode, AudioletNode);

ParameterNode.prototype.generate = function(inputBuffers, outputBuffers) {
    var outputBuffer = outputBuffers[0];
    var outputChannel = outputBuffer.channels[0];

    // Local processing variables
    var parameterParameter = this.parameter;
    var parameter, parameterChannel;
    if (parameterParameter.isStatic()) {
        parameter = parameterParameter.getValue();
    }
    else {
        parameterChannel = parameterParameter.getChannel();
    }


    var bufferLength = outputBuffer.length;
    for (var i = 0; i < bufferLength; i++) {
        if (parameterChannel) {
            parameter = parameterChannel[i];
        }
        outputChannel[i] = parameter;
    }
};

ParameterNode.prototype.toString = function() {
    return 'Parameter Node';
};

/**
 * @depends AudioletNode.js
 */

var PassThroughNode = function(audiolet, numberOfInputs, numberOfOutputs) {
    AudioletNode.call(this, audiolet, numberOfInputs, numberOfOutputs);
};
extend(PassThroughNode, AudioletNode);

PassThroughNode.prototype.createOutputBuffers = function(length) {
    var outputBuffers = [];
    var numberOfOutputs = this.numberOfOutputs;
    var numberOfInputs = this.numberOfInputs;
    // Copy the inputs buffers straight to the output buffers
    for (var i = 0; i < numberOfOutputs; i++) {
        var output = this.outputs[i];
        if (i < numberOfInputs) {
            // Copy the input buffer straight to the output buffers
            var input = this.inputs[i];
            output.buffer = input.buffer;
        }
        else {
            output.buffer.resize(output.getNumberOfChannels(), length);
        }
        outputBuffers.push(output.buffer);
    }
    return (outputBuffers);
};

PassThroughNode.prototype.toString = function() {
    return 'Pass Through Node';
};

// Priority Queue based on python heapq module
// http://svn.python.org/view/python/branches/release27-maint/Lib/heapq.py
var PriorityQueue = function(array, compare) {
    if (compare) {
        this.compare = compare;
    }

    if (array) {
        this.heap = array;
        for (var i = 0; i < Math.floor(this.heap.length / 2); i++) {
            this.siftUp(i);
        }
    }
    else {
        this.heap = [];
    }
};

PriorityQueue.prototype.push = function(item) {
    this.heap.push(item);
    this.siftDown(0, this.heap.length - 1);
};


PriorityQueue.prototype.pop = function() {
    var lastElement, returnItem;
    lastElement = this.heap.pop();
    if (this.heap.length) {
        var returnItem = this.heap[0];
        this.heap[0] = lastElement;
        this.siftUp(0);
    }
    else {
        returnItem = lastElement;
    }
    return (returnItem);
};

PriorityQueue.prototype.peek = function() {
    return (this.heap[0]);
};

PriorityQueue.prototype.isEmpty = function() {
    return (this.heap.length == 0);
};

PriorityQueue.prototype.siftDown = function(startPosition, position) {
    var newItem = this.heap[position];
    while (position > startPosition) {
        var parentPosition = (position - 1) >> 1;
        var parent = this.heap[parentPosition];
        if (this.compare(newItem, parent)) {
            this.heap[position] = parent;
            position = parentPosition;
            continue;
        }
        break;
    }
    this.heap[position] = newItem;
};

PriorityQueue.prototype.siftUp = function(position) {
    var endPosition = this.heap.length;
    var startPosition = position;
    var newItem = this.heap[position];
    var childPosition = 2 * position + 1;
    while (childPosition < endPosition) {
        var rightPosition = childPosition + 1;
        if (rightPosition < endPosition &&
            !this.compare(this.heap[childPosition],
                          this.heap[rightPosition])) {
            childPosition = rightPosition;
        }
        this.heap[position] = this.heap[childPosition];
        position = childPosition;
        childPosition = 2 * position + 1;
    }
    this.heap[position] = newItem;
    this.siftDown(startPosition, position);
};

PriorityQueue.prototype.compare = function(a, b) {
    return (a < b);
};

/**
 * @depends AudioletNode.js
 */

var Scheduler = function(audiolet, bpm) {
    AudioletNode.call(this, audiolet, 1, 1);
    this.linkNumberOfOutputChannels(0, 0);
    this.bpm = bpm || 120;
    this.queue = new PriorityQueue(null, function(a, b) {
        return (a.time < b.time);
    });

    this.time = 0;
    this.beat = 0;
    this.beatInBar = 0;
    this.bar = 0;
    this.seconds = 0;
    this.beatsPerBar = 0;

    this.lastBeatTime = 0;
    this.beatLength = 60 / this.bpm * this.audiolet.device.sampleRate;

    this.emptyBuffer = new AudioletBuffer(1, 1);
};
extend(Scheduler, AudioletNode);

Scheduler.prototype.setTempo = function(bpm) {
    this.bpm = bpm;
    this.beatLength = 60 / this.bpm * this.audiolet.device.sampleRate;
};

Scheduler.prototype.addRelative = function(beats, callback) {
    var event = {};
    event.callback = callback;
    event.time = this.time + beats * this.beatLength;
    this.queue.push(event);
    return event;
};

Scheduler.prototype.addAbsolute = function(beat, callback) {
    if (beat < this.beat ||
        beat == this.beat && this.time > this.lastBeatTime) {
        // Nah
        return null;
    }
    var event = {};
    event.callback = callback;
    event.time = this.lastBeatTime + (beat - this.beat) * this.beatLength;
    this.queue.push(event);
    return event;
};

Scheduler.prototype.play = function(patterns, durationPattern, callback) {
    var event = {};
    event.patterns = patterns;
    event.durationPattern = durationPattern;
    event.callback = callback;
    // TODO: Quantizing start time
    event.time = this.audiolet.device.getWriteTime();
    this.queue.push(event);
    return event;
};

Scheduler.prototype.remove = function(event) {
    var idx = this.queue.heap.indexOf(event);
    if (idx != -1) {
        this.queue.heap.splice(idx, 1);
        // Recreate queue with event removed
        this.queue = new PriorityQueue(this.queue.heap, function(a, b) {
            return (a.time < b.time);
        });
    }
};

Scheduler.prototype.stop = function(event) {
    this.remove(event);
};

Scheduler.prototype.tick = function(length, timestamp) {
    // The time at the beginning of the block
    var startTime = this.audiolet.device.getWriteTime();

    // Update the clock so it is correct for the first samples
    this.updateClock(startTime);

    // Don't create the output buffer yet - it needs to be created after
    // the first input buffer so we can work out how many channels it needs
    var outputBuffers = null;

    // Generate the block of samples and carry out events, generating a
    // new sub-block each time an event is carried out
    var lastEventTime = startTime;
    while (!this.queue.isEmpty() &&
           this.queue.peek().time <= startTime + length) {
        var event = this.queue.pop();
        // Event can't take place before the previous event
        var eventTime = Math.floor(Math.max(event.time, lastEventTime));

        // Generate samples to take us to the event
        var timeToEvent = eventTime - lastEventTime;
        if (timeToEvent > 0) {
            var offset = lastEventTime - startTime;
            this.tickParents(timeToEvent,
                             timestamp + offset);

            // Get the summed input
            var inputBuffers = this.createInputBuffers(timeToEvent);

            // Create the output buffer
            if (!outputBuffers) {
                var outputBuffers = this.createOutputBuffers(length);
            }

            // Copy it to the right part of the output
            // Use the generate function so it looks and quacks like an
            // AudioletNode
            this.generate(inputBuffers, outputBuffers, offset);
        }

        // Update the clock so it is correct for the current event
        this.updateClock(eventTime);


        // Set this before processEvent, as that can change the event time
        lastEventTime = eventTime;
        // Carry out the event
        this.processEvent(event);
    }

    // Generate enough samples to complete the block
    var remainingTime = startTime + length - lastEventTime;
    if (remainingTime) {
        this.tickParents(remainingTime,
                         timestamp + lastEventTime - startTime);
        var inputBuffers = this.createInputBuffers(remainingTime);

        // Make sure we have an output buffer
        if (!outputBuffers) {
            var outputBuffers = this.createOutputBuffers(length);
        }

        var offset = lastEventTime - startTime;
        this.generate(inputBuffers, outputBuffers, offset);
    }
};

Scheduler.prototype.updateClock = function(time) {
    this.time = time;
    this.seconds = this.time * this.audiolet.device.sampleRate;
    if (this.time >= this.lastBeatTime + this.beatLength) {
        this.beat += 1;
        this.beatInBar += 1;
        if (this.beatInBar == this.beatsPerBar) {
            this.bar += 1;
            this.beatInBar = 0;
        }
        this.lastBeatTime += this.beatLength;
    }
};

Scheduler.prototype.processEvent = function(event) {
    var durationPattern = event.durationPattern;
    if (durationPattern) {
        // Pattern event
        var args = [];
        var patterns = event.patterns;
        var numberOfPatterns = patterns.length;
        for (var i = 0; i < numberOfPatterns; i++) {
            var pattern = patterns[i];
            var value = pattern.next();
            if (value != null) {
                args.push(value);
            }
            else {
                // Null value for an argument, so don't process the
                // callback or add any further events
                return;
            }
        }
        event.callback.apply(null, args);

        var duration;
        if (durationPattern instanceof Pattern) {
            duration = durationPattern.next();
        }
        else {
            duration = durationPattern;
        }

        if (duration) {
            // Beats -> time
            event.time += duration * this.beatLength;
            this.queue.push(event);
        }
    }
    else {
        // Regular event
        event.callback();
    }
};

Scheduler.prototype.generate = function(inputBuffers, outputBuffers, offset) {
    var inputBuffer = inputBuffers[0];
    var outputBuffer = outputBuffers[0];
    for (var i = 0; i < inputBuffer.numberOfChannels; i++) {
        var inputChannel;
        if (inputBuffer.isEmpty) {
            // Substitute the supposedly empty buffer with an actually
            // empty buffer.  This means that we don't have to  zero
            // buffers in other nodes
            var emptyBuffer = this.emptyBuffer;
            emptyBuffer.resize(inputBuffer.numberOfChannels,
                               inputBuffer.length);
            inputChannel = emptyBuffer.getChannelData(0);
        }
        else {
            inputChannel = inputBuffer.getChannelData(i);
        }
        var outputChannel = outputBuffer.getChannelData(i);
        outputChannel.set(inputChannel, offset);
    }
};

Scheduler.prototype.toString = function() {
    return 'Scheduler';
};

// Shim for subarray/slice
var Int8Array, Uint8Array, Int16Array, Uint16Array;
var Int32Array, Uint32Array, Float32Array, Float64Array;
var types = [Int8Array, Uint8Array, Int16Array, Uint16Array,
             Int32Array, Uint32Array, Float32Array, Float64Array];
var original, shim;
for (var i = 0; i < types.length; ++i) {
    if (types[i]) {
        if (types[i].prototype.slice === undefined) {
            original = 'subarray';
            shim = 'slice';
        }
        else if (types[i].prototype.subarray === undefined) {
            original = 'slice';
            shim = 'subarray';
        }
        Object.defineProperty(types[i].prototype, shim, {
            value: types[i].prototype[original],
            enumerable: false
        });
    }
}


/**
 * @depends AbstractAudioletDevice.js
 */

var WebAudioAPIDevice = function(audiolet, sampleRate, numberOfChannels,
                                 bufferSize) {
    // Call Super class contructor
    AbstractAudioletDevice.call(this, audiolet);

    this.numberOfChannels = numberOfChannels || 2;
    this.bufferSize = bufferSize || 8192;

    // AudioContext is called webkitAudioContext in the current
    // implementation, so look for either
    if (typeof AudioContext != 'undefined') {
        this.context = new AudioContext();
    }
    else {
        // Must be webkitAudioContext
        this.context = new webkitAudioContext();
    }

    // Ignore specified sample rate, and use whatever the context gives us
    this.sampleRate = this.context.sampleRate;

    this.node = this.context.createJavaScriptNode(this.bufferSize, 1,
                                                  1);

    this.node.onaudioprocess = this.tick.bind(this);
    this.node.connect(this.context.destination);
    this.writePosition = 0;
};
extend(WebAudioAPIDevice, AbstractAudioletDevice);

WebAudioAPIDevice.prototype.tick = function(event) {
    var buffer = event.outputBuffer;
    var samplesNeeded = buffer.length;
    AudioletNode.prototype.tick.call(this, samplesNeeded, this.getWriteTime());
    var numberOfChannels = buffer.numberOfChannels;
    for (var i = 0; i < numberOfChannels; i++) {
        var channel = buffer.getChannelData(i);
        channel.set(this.buffer.getChannelData(i));
    }
    this.writePosition += samplesNeeded;
};

WebAudioAPIDevice.prototype.getPlaybackTime = function() {
    return this.context.currentTime * this.sampleRate;
};

WebAudioAPIDevice.prototype.getWriteTime = function() {
    return this.writePosition;
};

WebAudioAPIDevice.prototype.toString = function() {
    return 'Web Audio API Device';
};

/**
 * @depends ../core/AudioletNode.js
 */
var Envelope = function(audiolet, gate, levels, times, releaseStage,
                        onComplete) {
    AudioletNode.call(this, audiolet, 1, 1);
    this.gate = new AudioletParameter(this, 0, gate || 1);

    this.levels = levels;
    this.times = times;
    this.releaseStage = releaseStage;
    this.onComplete = onComplete;

    this.stage = null;
    this.time = null;
    this.changeTime = null;

    this.level = 0;
    this.delta = 0;
    this.gateOn = false;
};
extend(Envelope, AudioletNode);

Envelope.prototype.generate = function(inputBuffers, outputBuffers) {
    var buffer = outputBuffers[0];
    var channel = buffer.getChannelData(0);

    var gateParameter = this.gate;
    var gate, gateChannel;
    if (gateParameter.isStatic()) {
        gate = gateParameter.getValue();
    }
    else {
        gateChannel = gateParameter.getChannel();
    }
    var releaseStage = this.releaseStage;

    var stage = this.stage;
    var time = this.time;
    var changeTime = this.changeTime;

    var level = this.level;
    var delta = this.delta;
    var gateOn = this.gateOn;

    var stageChanged = false;

    var bufferLength = buffer.length;
    for (var i = 0; i < bufferLength; i++) {
        if (gateChannel) {
            gate = gateChannel[i];
        }

        if (gate && !gateOn) {
            // Key pressed
            gateOn = true;
            stage = 0;
            time = 0;
            stageChanged = true;
        }

        if (gateOn && !gate) {
            // Key released
            gateOn = false;
            if (releaseStage) {
                // Jump to the release stage
                stage = releaseStage;
                stageChanged = true;
            }
        }

        if (changeTime) {
            // We are not sustaining, and we are playing, so increase the
            // time
            time += 1;
            if (time >= changeTime) {
                // Need to go to the next stage
                stage += 1;
                if (stage != releaseStage) {
                    stageChanged = true;
                }
                else {
                    // If we reach the release stage then sustain the value
                    // until the gate is released rather than moving on
                    // to the next level.
                    changeTime = null;
                    delta = 0;
                }
            }
        }

        if (stageChanged) {
            level = this.levels[stage];
            if (stage != this.times.length) {
                // Actually update the variables
                delta = this.calculateDelta(stage, level);
                changeTime = this.calculateChangeTime(stage, time);
            }
            else {
                // Made it to the end, so finish up
                if (this.onComplete) {
                    this.onComplete();
                }
                stage = null;
                time = null;
                changeTime = null;

                delta = 0;
            }
            stageChanged = false;
        }

        level += delta;
        channel[i] = level;
    }

    this.stage = stage;
    this.time = time;
    this.changeTime = changeTime;

    this.level = level;
    this.delta = delta;
    this.gateOn = gateOn;
};

Envelope.prototype.calculateDelta = function(stage, level) {
    var delta = this.levels[stage + 1] - level;
    var stageTime = this.times[stage] * this.audiolet.device.sampleRate;
    return (delta / stageTime);
};

Envelope.prototype.calculateChangeTime = function(stage, time) {
    var stageTime = this.times[stage] * this.audiolet.device.sampleRate;
    return (time + stageTime);
};

Envelope.prototype.toString = function() {
    return 'Envelope';
};

/*!
 * @depends Envelope.js
 */

/**
 * Linear attack-decay-sustain-release envelope
 *
 * **Inputs**
 *
 * - Gate
 *
 * **Outputs**
 *
 * - Envelope
 *
 * **Parameters**
 *
 * - gate The gate turning the envelope on and off.  Value changes from 0 -> 1
 * trigger the envelope.  Value changes from 1 -> 0 make the envelope move to
 * its release stage.  Linked to input 0.
 *
 * @constructor
 * @extends Envelope
 * @param {Audiolet} audiolet The audiolet object.
 * @param {Number} gate The initial gate value.
 * @param {Number} attack The attack time in seconds.
 * @param {Number} decay The decay time in seconds.
 * @param {Number} sustain The sustain level (between 0 and 1).
 * @param {Number} release The release time in seconds.
 * @param {Function} onComplete A function called after the release stage.
 */
var ADSREnvelope = function(audiolet, gate, attack, decay, sustain, release,
                            onComplete) {
    var levels = [0, 1, sustain, 0];
    var times = [attack, decay, release];
    Envelope.call(this, audiolet, gate, levels, times, 2, onComplete);
};
extend(ADSREnvelope, Envelope);

/**
 * toString
 *
 * @return {String} String representation.
 */
ADSREnvelope.prototype.toString = function() {
    return 'ADSR Envelope';
};

/*!
 * @depends ../core/AudioletNode.js
 */

/**
 * Generic biquad filter.  The coefficients (a0, a1, a2, b0, b1 and b2) are set
 * using the calculateCoefficients function, which should be overridden and
 * will be called automatically when new values are needed.
 *
 * **Inputs**
 *
 * - Audio
 * - Filter frequency
 *
 * **Outputs**
 *
 * - Filtered audio
 *
 * **Parameters**
 *
 * - frequency The filter frequency.  Linked to input 1.
 *
 * @constructor
 * @extends AudioletNode
 * @param {Audiolet} audiolet The audiolet object.
 * @param {Number} frequency The initial frequency.
 */
var BiquadFilter = function(audiolet, frequency) {
    AudioletNode.call(this, audiolet, 2, 1);

    // Same number of output channels as input channels
    this.linkNumberOfOutputChannels(0, 0);

    this.frequency = new AudioletParameter(this, 1, frequency || 22100);
    this.lastFrequency = null; // See if we need to recalculate coefficients

    // Delayed values
    this.xValues = [];
    this.yValues = [];

    // Coefficients
    this.b0 = 0;
    this.b1 = 0;
    this.b2 = 0;
    this.a0 = 0;
    this.a1 = 0;
    this.a2 = 0;
};
extend(BiquadFilter, AudioletNode);

/**
 * Calculate the biquad filter coefficients.  This should be overridden.
 *
 * @param {Number} frequency The filter frequency.
 */
BiquadFilter.prototype.calculateCoefficients = function(frequency) {
};

/**
 * Process a block of samples
 *
 * @param {AudioletBuffer[]} inputBuffers Samples received from the inputs.
 * @param {AudioletBuffer[]} outputBuffers Samples to be sent to the outputs.
 */
BiquadFilter.prototype.generate = function(inputBuffers, outputBuffers) {
    var inputBuffer = inputBuffers[0];
    var outputBuffer = outputBuffers[0];

    if (inputBuffer.isEmpty) {
        outputBuffer.isEmpty = true;
        return;
    }

    var xValueArray = this.xValues;
    var yValueArray = this.yValues;

    var inputChannels = [];
    var outputChannels = [];
    var numberOfChannels = inputBuffer.numberOfChannels;
    for (var i = 0; i < numberOfChannels; i++) {
        inputChannels.push(inputBuffer.getChannelData(i));
        outputChannels.push(outputBuffer.getChannelData(i));
        if (i >= xValueArray.length) {
            xValueArray.push([0, 0]);
            yValueArray.push([0, 0]);
        }
    }

    // Local processing variables
    var frequencyParameter = this.frequency;
    var frequency, frequencyChannel;
    if (frequencyParameter.isStatic()) {
        frequency = frequencyParameter.getValue();
    }
    else {
        frequencyChannel = frequencyParameter.getChannel();
    }


    var lastFrequency = this.lastFrequency;

    var a0 = this.a0;
    var a1 = this.a1;
    var a2 = this.a2;
    var b0 = this.b0;
    var b1 = this.b1;
    var b2 = this.b2;

    var bufferLength = outputBuffer.length;
    for (var i = 0; i < bufferLength; i++) {
        if (frequencyChannel) {
            var frequency = frequencyChannel[i];
        }

        if (frequency != lastFrequency) {
            // Recalculate and make the coefficients local
            this.calculateCoefficients(frequency);
            lastFrequency = frequency;
            a0 = this.a0;
            a1 = this.a1;
            a2 = this.a2;
            b0 = this.b0;
            b1 = this.b1;
            b2 = this.b2;
        }

        for (var j = 0; j < numberOfChannels; j++) {
            var inputChannel = inputChannels[j];
            var outputChannel = outputChannels[j];

            var xValues = xValueArray[j];
            var x1 = xValues[0];
            var x2 = xValues[1];
            var yValues = yValueArray[j];
            var y1 = yValues[0];
            var y2 = yValues[1];

            var x0 = inputChannel[i];
            var y0 = (b0 / a0) * x0 +
                     (b1 / a0) * x1 +
                     (b2 / a0) * x2 -
                     (a1 / a0) * y1 -
                     (a2 / a0) * y2;

            outputChannel[i] = y0;


            xValues[0] = x0;
            xValues[1] = x1;
            yValues[0] = y0;
            yValues[1] = y1;
        }
    }
    this.lastFrequency = lastFrequency;
};

/**
 * toString
 *
 * @return {String} String representation.
 */
BiquadFilter.prototype.toString = function() {
    return 'Biquad Filter';
};

/*!
 * @depends BiquadFilter.js
 */

/**
 * All-pass filter
 *
 * **Inputs**
 *
 * - Audio
 * - Filter frequency
 *
 * **Outputs**
 *
 * - Filtered audio
 *
 * **Parameters**
 *
 * - frequency The filter frequency.  Linked to input 1.
 *
 * @constructor
 * @extends BiquadFilter
 *
 * @param {Audiolet} audiolet The audiolet object.
 * @param {Number} frequency The initial frequency.
 */
var AllPassFilter = function(audiolet, frequency) {
    BiquadFilter.call(this, audiolet, frequency);
};
extend(AllPassFilter, BiquadFilter);

/**
 * Calculate the biquad filter coefficients using maths from
 * http://www.musicdsp.org/files/Audio-EQ-Cookbook.txt
 *
 * @param {Number} frequency The filter frequency.
 */
AllPassFilter.prototype.calculateCoefficients = function(frequency) {
    var w0 = 2 * Math.PI * frequency /
             this.audiolet.device.sampleRate;
    var cosw0 = Math.cos(w0);
    var sinw0 = Math.sin(w0);
    var alpha = sinw0 / (2 / Math.sqrt(2));

    this.b0 = 1 - alpha;
    this.b1 = -2 * cosw0;
    this.b2 = 1 + alpha;
    this.a0 = 1 + alpha;
    this.a1 = -2 * cosw0;
    this.a2 = 1 - alpha;
};

/**
 * toString
 *
 * @return {String} String representation.
 */
AllPassFilter.prototype.toString = function() {
    return 'All Pass Filter';
};

/*!
 * @depends ../core/AudioletNode.js
 */

/**
 * Amplitude envelope follower
 *
 * **Inputs**
 *
 * - Audio
 * - Attack time
 * - Release time
 *
 * **Outputs**
 *
 * - Amplitude envelope
 *
 * **Parameters**
 *
 * - attack The attack time of the envelope follower.  Linked to input 1.
 * - release The release time of the envelope follower.  Linked to input 2.
 *
 * @constructor
 * @extends AudioletNode
 * @param {Audiolet} audiolet The audiolet object.
 * @param {Number} [attack=0.01] The initial attack time in seconds.
 * @param {Number} [release=0.01] The initial release time in seconds.
 */
var Amplitude = function(audiolet, attack, release) {
    AudioletNode.call(this, audiolet, 3, 1);
    this.linkNumberOfOutputChannels(0, 0);

    this.followers = [];
    var sampleRate = this.audiolet.device.sampleRate;

    //        attack = Math.pow(0.01, 1 / (attack * sampleRate));
    this.attack = new AudioletParameter(this, 1, attack || 0.01);

    //        release = Math.pow(0.01, 1 / (release * sampleRate));
    this.release = new AudioletParameter(this, 2, release || 0.01);
};
extend(Amplitude, AudioletNode);

/**
 * Process a block of samples
 *
 * @param {AudioletBuffer[]} inputBuffers Samples received from the inputs.
 * @param {AudioletBuffer[]} outputBuffers Samples to be sent to the outputs.
 */
Amplitude.prototype.generate = function(inputBuffers, outputBuffers) {
    var inputBuffer = inputBuffers[0];
    var outputBuffer = outputBuffers[0];

    if (inputBuffer.isEmpty) {
        outputBuffer.isEmpty = true;
        return;
    }

    var followers = this.followers;
    var numberOfFollowers = followers.length;

    // Local processing variables
    var attackParameter = this.attack;
    var attack, attackChannel;
    if (attackParameter.isStatic()) {
        attack = attackParameter.getValue();
    }
    else {
        attackChannel = attackParameter.getChannel();
    }

    // Local processing variables
    var releaseParameter = this.release;
    var release, releaseChannel;
    if (releaseParameter.isStatic()) {
        release = releaseParameter.getValue();
    }
    else {
        releaseChannel = releaseParameter.getChannel();
    }

    var numberOfChannels = inputBuffer.numberOfChannels;
    for (var i = 0; i < numberOfChannels; i++) {
        if (i > numberOfFollowers) {
            followers.push(0);
        }
        var follower = followers[i];

        var inputChannel = inputBuffer.getChannelData(i);
        var outputChannel = outputBuffer.getChannelData(i);
        var bufferLength = inputBuffer.length;
        for (var j = 0; j < bufferLength; j++) {
            var value = inputChannel[j];
            if (attackChannel) {
                attack = attackChannel[j];
            }
            if (releaseChannel) {
                release = releaseChannel[j];
            }
            if (i > follower) {
                follower = attack * (follower - value) + value;
            }
            else {
                follower = release * (follower - value) + value;
            }
            outputChannel[j] = follower;
        }
        followers[i] = follower;
    }
};

/**
 * toString
 *
 * @return {String} String representation.
 */
Amplitude.prototype.toString = function() {
    return ('Amplitude');
};

/*!
 * @depends ../core/PassThroughNode.js
 */

/**
 * Detect potentially hazardous values in the audio stream.  Looks for
 * undefineds, nulls, NaNs and Infinities.
 *
 * **Inputs**
 *
 * - Audio
 *
 * **Outputs**
 *
 * - Audio
 *
 * @constructor
 * @extends PassThroughNode
 * @param {Audiolet} audiolet The audiolet object.
 * @param {Function} [callback] Function called if a bad value is detected.
 */
var BadValueDetector = function(audiolet, callback) {
    PassThroughNode.call(this, audiolet, 1, 1);
    this.linkNumberOfOutputChannels(0, 0);

    if (callback) {
        this.callback = callback;
    }
};
extend(BadValueDetector, PassThroughNode);

/**
 * Default callback.  Logs the value and position of the bad value.
 *
 * @param {Number|Object|'undefined'} value The value detected.
 * @param {Number} channel The index of the channel the value was found in.
 * @param {Number} index The sample index the value was found at.
 */
BadValueDetector.prototype.callback = function(value, channel, index) {
    console.error(value + ' detected at channel ' + channel + ' index ' +
                  index);
};

/**
 * Process a block of samples
 *
 * @param {AudioletBuffer[]} inputBuffers Samples received from the inputs.
 * @param {AudioletBuffer[]} outputBuffers Samples to be sent to the outputs.
 */
BadValueDetector.prototype.generate = function(inputBuffers, outputBuffers) {
    var inputBuffer = inputBuffers[0];

    if (inputBuffer.isEmpty) {
        return;
    }

    var numberOfChannels = inputBuffer.numberOfChannels;
    for (var i = 0; i < numberOfChannels; i++) {
        var channel = inputBuffer.getChannelData(i);

        var bufferLength = inputBuffer.length;
        for (var j = 0; j < bufferLength; j++) {
            var value = channel[j];
            if (typeof value == 'undefined' ||
                value == null ||
                isNaN(value) ||
                value == Infinity ||
                value == -Infinity) {
                this.callback(value, i, j);
            }
        }
    }
};

/**
 * toString
 *
 * @return {String} String representation.
 */
BadValueDetector.prototype.toString = function() {
    return 'Bad Value Detector';
};

/*!
 * @depends BiquadFilter.js
 */

/**
 * Band-pass filter
 *
 * **Inputs**
 *
 * - Audio
 * - Filter frequency
 *
 * **Outputs**
 *
 * - Filtered audio
 *
 * **Parameters**
 *
 * - frequency The filter frequency.  Linked to input 1.
 *
 * @constructor
 * @extends BiquadFilter
 * @param {Audiolet} audiolet The audiolet object.
 * @param {Number} frequency The initial frequency.
 */
var BandPassFilter = function(audiolet, frequency) {
    BiquadFilter.call(this, audiolet, frequency);
};
extend(BandPassFilter, BiquadFilter);

/**
 * Calculate the biquad filter coefficients using maths from
 * http://www.musicdsp.org/files/Audio-EQ-Cookbook.txt
 *
 * @param {Number} frequency The filter frequency.
 */
BandPassFilter.prototype.calculateCoefficients = function(frequency) {
    var w0 = 2 * Math.PI * frequency / this.audiolet.device.sampleRate;
    var cosw0 = Math.cos(w0);
    var sinw0 = Math.sin(w0);
    var alpha = sinw0 / (2 / Math.sqrt(2));

    this.b0 = alpha;
    this.b1 = 0;
    this.b2 = -alpha;
    this.a0 = 1 + alpha;
    this.a1 = -2 * cosw0;
    this.a2 = 1 - alpha;
};

/**
 * toString
 *
 * @return {String} String representation.
 */
BandPassFilter.prototype.toString = function() {
    return 'Band Pass Filter';
};

/*!
 * @depends BiquadFilter.js
 */

/**
 * Band-reject filter
 *
 * **Inputs**
 *
 * - Audio
 * - Filter frequency
 *
 * **Outputs**
 *
 * - Filtered audio
 *
 * **Parameters**
 *
 * - frequency The filter frequency.  Linked to input 1.
 *
 * @constructor
 * @extends BiquadFilter
 * @param {Audiolet} audiolet The audiolet object.
 * @param {Number} frequency The initial frequency.
 */
var BandRejectFilter = function(audiolet, frequency) {
    BiquadFilter.call(this, audiolet, frequency);
};
extend(BandRejectFilter, BiquadFilter);

/**
 * Calculate the biquad filter coefficients using maths from
 * http://www.musicdsp.org/files/Audio-EQ-Cookbook.txt
 *
 * @param {Number} frequency The filter frequency.
 */
BandRejectFilter.prototype.calculateCoefficients = function(frequency) {
    var w0 = 2 * Math.PI * frequency /
             this.audiolet.device.sampleRate;
    var cosw0 = Math.cos(w0);
    var sinw0 = Math.sin(w0);
    var alpha = sinw0 / (2 / Math.sqrt(2));

    this.b0 = 1;
    this.b1 = -2 * cosw0;
    this.b2 = 1;
    this.a0 = 1 + alpha;
    this.a1 = -2 * cosw0;
    this.a2 = 1 - alpha;
};

/**
 * toString
 *
 * @return {String} String representation.
 */
BandRejectFilter.prototype.toString = function() {
    return 'Band Reject Filter';
};

/*!
 * @depends ../core/AudioletNode.js
 */

/**
 * Play the contents of an audio buffer
 *
 * **Inputs**
 *
 * - Playback rate
 * - Restart trigger
 * - Start position
 * - Loop on/off
 *
 * **Outputs**
 *
 * - Audio
 *
 * **Parameters**
 *
 * - playbackRate The rate that the buffer should play at.  Value of 1 plays at
 * the regular rate.  Values > 1 are pitched up.  Values < 1 are pitched down.
 * Linked to input 0.
 * - restartTrigger Changes of value from 0 -> 1 restart the playback from the
 * start position.  Linked to input 1.
 * - startPosition The position at which playback should begin.  Values between
 * 0 (the beginning of the buffer) and 1 (the end of the buffer).  Linked to
 * input 2.
 * - loop Whether the buffer should loop when it reaches the end.  Linked to
 * input 3
 *
 * @constructor
 * @extends AudioletNode
 * @param {Audiolet} audiolet The audiolet object.
 * @param {AudioletBuffer} buffer The buffer to play.
 * @param {Number} [playbackRate=1] The initial playback rate.
 * @param {Number} [startPosition=0] The initial start position.
 * @param {Number} [loop=0] Initial value for whether to loop.
 */
var BufferPlayer = function(audiolet, buffer, playbackRate, startPosition,
                            loop) {
    AudioletNode.call(this, audiolet, 3, 1);
    this.buffer = buffer;
    this.setNumberOfOutputChannels(0, this.buffer.numberOfChannels);
    this.position = startPosition || 0;
    this.playbackRate = new AudioletParameter(this, 0, playbackRate || 1);
    this.restartTrigger = new AudioletParameter(this, 1, 0);
    this.startPosition = new AudioletParameter(this, 2, startPosition || 0);
    this.loop = new AudioletParameter(this, 3, loop || 0);

    this.restartTriggerOn = false;
    this.playing = true;
};
extend(BufferPlayer, AudioletNode);

/**
 * Process a block of samples
 *
 * @param {AudioletBuffer[]} inputBuffers Samples received from the inputs.
 * @param {AudioletBuffer[]} outputBuffers Samples to be sent to the outputs.
 */
BufferPlayer.prototype.generate = function(inputBuffers, outputBuffers) {
    var outputBuffer = outputBuffers[0];

    // Cache local variables
    var buffer = this.buffer;
    var position = this.position;
    var playing = this.playing;
    var restartTriggerOn = this.restartTriggerOn;

    // Crap load of parameters
    var playbackRateParameter = this.playbackRate;
    var playbackRate, playbackRateChannel;
    if (playbackRateParameter.isStatic()) {
        playbackRate = playbackRateParameter.getValue();
    }
    else {
        playbackRateChannel = playbackRateParameter.getChannel();
    }

    var restartTriggerParameter = this.restartTrigger;
    var restartTrigger, restartTriggerChannel;
    if (restartTriggerParameter.isStatic()) {
        restartTrigger = restartTriggerParameter.getValue();
    }
    else {
        restartTriggerChannel = restartTriggerParameter.getChannel();
    }

    var startPositionParameter = this.startPosition;
    var startPosition, startPositionChannel;
    if (startPositionParameter.isStatic()) {
        startPosition = startPositionParameter.getValue();
    }
    else {
        startPositionChannel = startPositionParameter.getChannel();
    }

    var loopParameter = this.loop;
    var loop, loopChannel;
    if (loopParameter.isStatic()) {
        loop = loopParameter.getValue();
    }
    else {
        loopChannel = loopParameter.getChannel();
    }


    if (buffer.length == 0 || (!restartTriggerChannel && !playing)) {
        // No buffer data, or chance of starting playing in this block, so
        // we can just send an empty buffer and return
        outputBuffer.isEmpty = true;
        return;
    }

    var numberOfChannels = buffer.numberOfChannels;
    var bufferLength = outputBuffer.length;
    for (var i = 0; i < bufferLength; i++) {
        if (playbackRateChannel) {
            playbackRate = playbackRateChannel[i];
        }
        if (restartTriggerChannel) {
            restartTrigger = restartTriggerChannel[i];
        }
        if (loopChannel) {
            loop = loopChannel[i];
        }

        if (restartTrigger > 0 && !restartTriggerOn) {
            // Trigger moved from <=0 to >0, so we restart playback from
            // startPosition
            position = startPosition;
            restartTriggerOn = true;
            playing = true;
        }

        if (restartTrigger <= 0 && restartTriggerOn) {
            // Trigger moved back to <= 0
            restartTriggerOn = false;
        }

        if (playing) {
            for (var j = 0; j < numberOfChannels; j++) {
                var inputChannel = buffer.channels[j];
                var outputChannel = outputBuffer.channels[j];
                outputChannel[i] = inputChannel[Math.floor(position)];
            }
            position += playbackRate;
            if (position >= buffer.length) {
                if (loop) {
                    // Back to the start
                    position %= buffer.length;
                }
                else {
                    // Finish playing until a new restart trigger
                    playing = false;
                }
            }
        }
        else {
            // Give zeros until we restart
            for (var j = 0; j < numberOfChannels; j++) {
                var outputChannel = outputBuffer.channels[j];
                outputChannel[i] = 0;
            }
        }
    }

    this.playing = playing;
    this.position = position;
    this.restartTriggerOn = restartTriggerOn;
};

/**
 * toString
 *
 * @return {String} String representation.
 */
BufferPlayer.prototype.toString = function() {
    return ('Buffer player');
};

/**
 * @depends ../core/AudioletNode.js
 */

var CombFilter = function(audiolet, maximumDelayTime, delayTime, decayTime) {
    AudioletNode.call(this, audiolet, 3, 1);
    this.linkNumberOfOutputChannels(0, 0);
    this.maximumDelayTime = maximumDelayTime;
    this.delayTime = new AudioletParameter(this, 1, delayTime || 1);
    this.decayTime = new AudioletParameter(this, 2, decayTime);
    var bufferSize = maximumDelayTime * this.audiolet.device.sampleRate;
    this.buffers = [];
    this.readWriteIndex = 0;
};
extend(CombFilter, AudioletNode);

CombFilter.prototype.generate = function(inputBuffers, outputBuffers) {
    var inputBuffer = inputBuffers[0];
    var outputBuffer = outputBuffers[0];

    if (inputBuffer.isEmpty) {
        outputBuffer.isEmpty = true;
        return;
    }

    // Local processing variables
    var maximumDelayTime = this.maximumDelayTime;
    var sampleRate = this.audiolet.device.sampleRate;

    var delayTimeParameter = this.delayTime;
    var delayTime, delayTimeChannel;
    if (delayTimeParameter.isStatic()) {
        delayTime = Math.floor(delayTimeParameter.getValue() * sampleRate);
    }
    else {
        delayTimeChannel = delayTimeParameter.getChannel();
    }

    var decayTimeParameter = this.decayTime;
    var decayTime, decayTimeChannel;
    if (decayTimeParameter.isStatic()) {
        decayTime = Math.floor(decayTimeParameter.getValue() * sampleRate);
    }
    else {
        decayTimeChannel = decayTimeParameter.getChannel();
    }


    var feedback;
    if (delayTimeParameter.isStatic() && decayTimeParameter.isStatic()) {
        feedback = Math.exp(-3 * delayTime / decayTime);
    }



    var buffers = this.buffers;
    var readWriteIndex = this.readWriteIndex;

    var inputChannels = inputBuffer.channels;
    var outputChannels = outputBuffer.channels;
    var numberOfChannels = inputBuffer.numberOfChannels;
    var numberOfBuffers = buffers.length;
    for (var i = numberOfBuffers; i < numberOfChannels; i++) {
        // Create buffer for channel if it doesn't already exist
        var bufferSize = maximumDelayTime * sampleRate;
        buffers.push(new Float32Array(bufferSize));
    }


    var bufferLength = inputBuffer.length;
    for (var i = 0; i < bufferLength; i++) {
        if (delayTimeChannel) {
            delayTime = Math.floor(delayTimeChannel[i] * sampleRate);
        }

        if (decayTimeChannel) {
            decayTime = Math.floor(decayTimeChannel[i] * sampleRate);
        }

        if (delayTimeChannel || decayTimeChannel) {
            feedback = Math.exp(-3 * delayTime / decayTime);
        }

        for (var j = 0; j < numberOfChannels; j++) {
            var inputChannel = inputChannels[j];
            var outputChannel = outputChannels[j];
            var buffer = buffers[j];
            var output = buffer[readWriteIndex];
            outputChannel[i] = output;
            buffer[readWriteIndex] = inputChannel[i] +
                                     feedback * output;
        }

        readWriteIndex += 1;
        if (readWriteIndex >= delayTime) {
            readWriteIndex = 0;
        }
    }
    this.readWriteIndex = readWriteIndex;
};

CombFilter.prototype.toString = function() {
    return 'Comb Filter';
};

/**
 * @depends ../core/AudioletNode.js
 */
var TableLookupOscillator = function(audiolet, table, frequency) {
    AudioletNode.call(this, audiolet, 1, 1);
    this.table = table;
    this.frequency = new AudioletParameter(this, 0, frequency || 440);
    this.phase = 0;
};
extend(TableLookupOscillator, AudioletNode);

TableLookupOscillator.prototype.generate = function(inputBuffers,
                                                    outputBuffers) {
    var buffer = outputBuffers[0];
    var channel = buffer.getChannelData(0);

    // Make processing variables local
    var sampleRate = this.audiolet.device.sampleRate;
    var table = this.table;
    var tableSize = table.length;
    var phase = this.phase;
    var frequencyParameter = this.frequency;
    var frequency, frequencyChannel;
    if (frequencyParameter.isStatic()) {
        frequency = frequencyParameter.getValue();
    }
    else {
        frequencyChannel = frequencyParameter.getChannel();
    }

    // Processing loop
    var bufferLength = buffer.length;
    for (var i = 0; i < bufferLength; i++) {
        if (frequencyChannel) {
            frequency = frequencyChannel[i];
        }
        var step = frequency * tableSize / sampleRate;
        phase += step;
        if (phase >= tableSize) {
            phase %= tableSize;
        }
        channel[i] = table[Math.floor(phase)];
    }
    this.phase = phase;
};

TableLookupOscillator.prototype.toString = function() {
    return 'Table Lookup Oscillator';
};


/*!
 * @depends TableLookupOscillator.js
 */

/**
 * Sine wave oscillator using a lookup table
 *
 * **Inputs**
 *
 * - Frequency
 *
 * **Outputs**
 *
 * - Sine wave
 *
 * **Parameters**
 *
 * - frequency The frequency of the oscillator.  Linked to input 0.
 *
 * @constructor
 * @extends TableLookupOscillator
 * @param {Audiolet} audiolet The audiolet object.
 * @param {Number} [frequency=440] Initial frequency.
 */
var Sine = function(audiolet, frequency) {
    TableLookupOscillator.call(this, audiolet, Sine.TABLE, frequency);
};
extend(Sine, TableLookupOscillator);

/**
 * toString
 *
 * @return {String} String representation.
 */
Sine.prototype.toString = function() {
    return 'Sine';
};

/**
 * Sine table
 */
Sine.TABLE = [];
for (var i = 0; i < 8192; i++) {
    Sine.TABLE.push(Math.sin(i * 2 * Math.PI / 8192));
}


/**
 * @depends ../core/AudioletNode.js
 * @depends Sine.js
 */

var CrossFade = function(audiolet, position) {
    AudioletNode.call(this, audiolet, 3, 1);
    this.linkNumberOfOutputChannels(0, 0);
    this.position = new AudioletParameter(this, 2, position || 0.5);
};
extend(CrossFade, AudioletNode);

CrossFade.prototype.generate = function(inputBuffers, outputBuffers) {
    var inputBufferA = inputBuffers[0];
    var inputBufferB = inputBuffers[1];
    var outputBuffer = outputBuffers[0];

    var inputChannelsA = inputBufferA.channels;
    var inputChannelsB = inputBufferB.channels;
    var outputChannels = outputBuffer.channels;

    if (inputBufferA.isEmpty && inputBufferB.isEmpty) {
        outputBuffer.isEmpty = true;
        return;
    }

    // Local processing variables
    var positionParameter = this.position;
    var position, positionChannel;
    if (positionParameter.isStatic()) {
        position = positionParameter.getValue();
    }
    else {
        positionChannel = positionParameter.getChannel();
    }

    var bufferLength = outputBuffer.length;
    for (var i = 0; i < bufferLength; i++) {
        if (positionChannel) {
            position = positionChannel[i];
        }

        var tableLength = Sine.TABLE.length / 4;
        var scaledPosition = Math.floor(position * tableLength);
        // TODO: Use sine/cos tables?
        var gainA = Sine.TABLE[scaledPosition + tableLength];
        var gainB = Sine.TABLE[scaledPosition];

        var numberOfChannels = inputBufferA.numberOfChannels;
        for (var j = 0; j < numberOfChannels; j++) {
            var inputChannelA = inputChannelsA[j];
            var inputChannelB = inputChannelsB[j];
            var outputChannel = outputChannels[j];

            var valueA, valueB;
            if (!inputBufferA.isEmpty) {
                valueA = inputChannelA[i];
            }
            else {
                valueA = 0;
            }

            if (!inputBufferB.isEmpty) {
                valueB = inputChannelB[i];
            }
            else {
                valueB = 0;
            }
            outputChannel[i] = valueA * gainA +
                valueB * gainB;
        }
    }
};

CrossFade.prototype.toString = function() {
    return 'Cross Fader';
};

/**
 * @depends ../core/AudioletNode.js
 */

var DampedCombFilter = function(audiolet, maximumDelayTime, delayTime,
                                decayTime, damping) {
    AudioletNode.call(this, audiolet, 4, 1);
    this.linkNumberOfOutputChannels(0, 0);
    this.maximumDelayTime = maximumDelayTime;
    this.delayTime = new AudioletParameter(this, 1, delayTime || 1);
    this.decayTime = new AudioletParameter(this, 2, decayTime);
    this.damping = new AudioletParameter(this, 3, damping);
    var bufferSize = maximumDelayTime * this.audiolet.device.sampleRate;
    this.buffers = [];
    this.readWriteIndex = 0;
    this.filterStore = 0;
};
extend(DampedCombFilter, AudioletNode);

DampedCombFilter.prototype.generate = function(inputBuffers, outputBuffers) {
    var inputBuffer = inputBuffers[0];
    var outputBuffer = outputBuffers[0];

    if (inputBuffer.isEmpty) {
        outputBuffer.isEmpty = true;
        return;
    }

    // Local processing variables
    var maximumDelayTime = this.maximumDelayTime;
    var sampleRate = this.audiolet.device.sampleRate;

    var delayTimeParameter = this.delayTime;
    var delayTime, delayTimeChannel;
    if (delayTimeParameter.isStatic()) {
        delayTime = Math.floor(delayTimeParameter.getValue() * sampleRate);
    }
    else {
        delayTimeChannel = delayTimeParameter.getChannel();
    }

    var decayTimeParameter = this.decayTime;
    var decayTime, decayTimeChannel;
    if (decayTimeParameter.isStatic()) {
        decayTime = Math.floor(decayTimeParameter.getValue() * sampleRate);
    }
    else {
        decayTimeChannel = decayTimeParameter.getChannel();
    }

    var dampingParameter = this.damping;
    var damping, dampingChannel;
    if (dampingParameter.isStatic()) {
        damping = dampingParameter.getValue();
    }
    else {
        dampingChannel = dampingParameter.getChannel();
    }


    var feedback;
    if (delayTimeParameter.isStatic() && decayTimeParameter.isStatic()) {
        feedback = Math.exp(-3 * delayTime / decayTime);
    }



    var buffers = this.buffers;
    var readWriteIndex = this.readWriteIndex;
    var filterStore = this.filterStore;

    var inputChannels = inputBuffer.channels;
    var outputChannels = outputBuffer.channels;
    var numberOfChannels = inputBuffer.numberOfChannels;
    var numberOfBuffers = buffers.length;
    for (var i = numberOfBuffers; i < numberOfChannels; i++) {
        // Create buffer for channel if it doesn't already exist
        var bufferSize = maximumDelayTime * sampleRate;
        buffers.push(new Float32Array(bufferSize));
    }


    var bufferLength = inputBuffer.length;
    for (var i = 0; i < bufferLength; i++) {
        if (delayTimeChannel) {
            delayTime = Math.floor(delayTimeChannel[i] * sampleRate);
        }

        if (decayTimeChannel) {
            decayTime = Math.floor(decayTimeChannel[i] * sampleRate);
        }

        if (dampingChannel) {
            damping = dampingChannel[i];
        }

        if (delayTimeChannel || decayTimeChannel) {
            feedback = Math.exp(-3 * delayTime / decayTime);
        }

        for (var j = 0; j < numberOfChannels; j++) {
            var inputChannel = inputChannels[j];
            var outputChannel = outputChannels[j];
            var buffer = buffers[j];
            var output = buffer[readWriteIndex];
            filterStore = (output * (1 - damping)) +
                          (filterStore * damping);
            outputChannel[i] = output;
            buffer[readWriteIndex] = inputChannel[i] +
                                     feedback * filterStore;
        }

        readWriteIndex += 1;
        if (readWriteIndex >= delayTime) {
            readWriteIndex = 0;
        }
    }
    this.readWriteIndex = readWriteIndex;
    this.filterStore = filterStore;
};

DampedCombFilter.prototype.toString = function() {
    return 'Damped Comb Filter';
};

/**
 * @depends ../core/AudioletNode.js
 */

var Delay = function(audiolet, maximumDelayTime, delayTime) {
    AudioletNode.call(this, audiolet, 2, 1);
    this.linkNumberOfOutputChannels(0, 0);
    this.maximumDelayTime = maximumDelayTime;
    this.delayTime = new AudioletParameter(this, 1, delayTime || 1);
    var bufferSize = maximumDelayTime * this.audiolet.device.sampleRate;
    this.buffers = [];
    this.readWriteIndex = 0;
};
extend(Delay, AudioletNode);

Delay.prototype.generate = function(inputBuffers, outputBuffers) {
    var inputBuffer = inputBuffers[0];
    var outputBuffer = outputBuffers[0];

    // Local processing variables
    var maximumDelayTime = this.maximumDelayTime;
    var sampleRate = this.audiolet.device.sampleRate;

    var delayTimeParameter = this.delayTime;
    var delayTime, delayTimeChannel;
    if (delayTimeParameter.isStatic()) {
        delayTime = Math.floor(delayTimeParameter.getValue() * sampleRate);
    }
    else {
        delayTimeChannel = delayTimeParameter.getChannel();
    }

    var buffers = this.buffers;
    var readWriteIndex = this.readWriteIndex;

    var inputChannels = [];
    var outputChannels = [];
    var numberOfChannels = inputBuffer.numberOfChannels;
    for (var i = 0; i < numberOfChannels; i++) {
        inputChannels.push(inputBuffer.getChannelData(i));
        outputChannels.push(outputBuffer.getChannelData(i));
        // Create buffer for channel if it doesn't already exist
        if (i >= buffers.length) {
            var bufferSize = maximumDelayTime * sampleRate;
            buffers.push(new Float32Array(bufferSize));
        }
    }


    var bufferLength = inputBuffer.length;
    for (var i = 0; i < bufferLength; i++) {
        if (delayTimeChannel) {
            delayTime = Math.floor(delayTimeChannel[i] * sampleRate);
        }

        for (var j = 0; j < numberOfChannels; j++) {
            var inputChannel = inputChannels[j];
            var outputChannel = outputChannels[j];
            var buffer = buffers[j];
            outputChannel[i] = buffer[readWriteIndex];
            if (!inputBuffer.isEmpty) {
                buffer[readWriteIndex] = inputChannel[i];
            }
            else {
                buffer[readWriteIndex] = 0;
            }
        }

        readWriteIndex += 1;
        if (readWriteIndex >= delayTime) {
            readWriteIndex = 0;
        }
    }
    this.readWriteIndex = readWriteIndex;
};

Delay.prototype.toString = function() {
    return 'Delay';
};

/**
 * @depends ../core/AudioletNode.js
 */

var DiscontinuityDetector = function(audiolet, threshold, callback) {
    AudioletNode.call(this, audiolet, 1, 1);
    this.linkNumberOfOutputChannels(0, 0);

    this.threshold = threshold || 0.2;
    if (callback) {
        this.callback = callback;
    }
    this.lastValues = [];

};
extend(DiscontinuityDetector, AudioletNode);

// Override me
DiscontinuityDetector.prototype.callback = function(size, channel, index) {
    console.error('Discontinuity of ' + size + ' detected on channel ' +
                  channel + ' index ' + index);
};

DiscontinuityDetector.prototype.generate = function(inputBuffers,
                                                    outputBuffers) {
    var inputBuffer = inputBuffers[0];

    if (inputBuffer.isEmpty) {
        this.lastValues = [];
        return;
    }

    var lastValues = this.lastValues;
    var threshold = this.threshold;

    var numberOfChannels = inputBuffer.numberOfChannels;
    for (var i = 0; i < numberOfChannels; i++) {
        var channel = inputBuffer.getChannelData(i);

        if (i >= lastValues.length) {
            lastValues.push(null);
        }
        var lastValue = lastValues[i];

        var bufferLength = inputBuffer.length;
        for (var j = 0; j < bufferLength; j++) {
            var value = channel[j];
            if (lastValue != null) {
                if (Math.abs(lastValue - value) > threshold) {
                    this.callback(Math.abs(lastValue - value), i, j);
                }
            }
            lastValue = value;
        }

        lastValues[i] = lastValue;
    }
};

DiscontinuityDetector.prototype.toString = function() {
    return 'Discontinuity Detector';
};


/**
 * @depends ../core/AudioletNode.js
 */

var Gain = function(audiolet, gain) {
    AudioletNode.call(this, audiolet, 2, 1);
    this.linkNumberOfOutputChannels(0, 0);
    this.gain = new AudioletParameter(this, 1, gain || 1);
};
extend(Gain, AudioletNode);

Gain.prototype.generate = function(inputBuffers, outputBuffers) {
    var inputBuffer = inputBuffers[0];
    var outputBuffer = outputBuffers[0];

    if (inputBuffer.isEmpty) {
        outputBuffer.isEmpty = true;
        return;
    }

    // Local processing variables
    var gainParameter = this.gain;
    var gain, gainChannel;
    if (gainParameter.isStatic()) {
        gain = gainParameter.getValue();
    }
    else {
        gainChannel = gainParameter.getChannel();
    }

    var numberOfChannels = inputBuffer.numberOfChannels;
    for (var i = 0; i < numberOfChannels; i++) {
        var inputChannel = inputBuffer.getChannelData(i);
        var outputChannel = outputBuffer.getChannelData(i);
        var bufferLength = inputBuffer.length;
        for (var j = 0; j < bufferLength; j++) {
            if (gainChannel) {
                gain = gainChannel[j];
            }
            outputChannel[j] = inputChannel[j] * gain;
        }
    }
};

Gain.prototype.toString = function() {
    return ('Gain');
};

/**
 * @depends BiquadFilter.js
 */

// Maths from http://www.musicdsp.org/files/Audio-EQ-Cookbook.txt
var HighPassFilter = function(audiolet, frequency) {
    BiquadFilter.call(this, audiolet, frequency);
};
extend(HighPassFilter, BiquadFilter);

HighPassFilter.prototype.calculateCoefficients = function(frequency) {
    var w0 = 2 * Math.PI * frequency /
             this.audiolet.device.sampleRate;
    var cosw0 = Math.cos(w0);
    var sinw0 = Math.sin(w0);
    var alpha = sinw0 / (2 / Math.sqrt(2));

    this.b0 = (1 + cosw0) / 2;
    this.b1 = - (1 + cosw0);
    this.b2 = this.b0;
    this.a0 = 1 + alpha;
    this.a1 = -2 * cosw0;
    this.a2 = 1 - alpha;
};

HighPassFilter.prototype.toString = function() {
    return 'High Pass Filter';
};

/**
 * @depends ../core/AudioletNode.js
 */

var Lag = function(audiolet, value, lagTime) {
    AudioletNode.call(this, audiolet, 2, 1);
    this.value = new AudioletParameter(this, 0, value || 0);
    this.lag = new AudioletParameter(this, 1, lagTime || 1);
    this.lastValue = value || 0;

    this.log001 = Math.log(0.001);
};
extend(Lag, AudioletNode);

Lag.prototype.generate = function(inputBuffers, outputBuffers) {
    var outputBuffer = outputBuffers[0];
    var outputChannel = outputBuffer.getChannelData(0);

    var sampleRate = this.audiolet.device.sampleRate;
    var log001 = this.log001;

    var valueParameter = this.value;
    var value, valueChannel;
    if (valueParameter.isStatic()) {
        value = valueParameter.getValue();
    }
    else {
        valueChannel = valueParameter.getChannel();
    }

    var lagParameter = this.lag;
    var lag, lagChannel, coefficient;
    if (lagParameter.isStatic()) {
        lag = lagParameter.getValue();
        coefficient = Math.exp(log001 / (lag * sampleRate));
    }
    else {
        lagChannel = lagParameter.getChannel();
    }

    var lastValue = this.lastValue;

    var bufferLength = outputBuffer.length;
    for (var i = 0; i < bufferLength; i++) {
        if (valueChannel) {
            value = valueChannel[i];
            coefficient = Math.exp(log001 / (lag * sampleRate));
        }

        if (lagChannel) {
            lag = lagChannel[i];
        }
        var output = ((1 - coefficient) * value) +
                     (coefficient * lastValue);
        outputChannel[i] = output;
        lastValue = output;
    }
    this.lastValue = lastValue;
};

Lag.prototype.toString = function() {
    return 'Lag';
};


/**
 * @depends ../core/AudioletGroup.js
 */

var Limiter = function(audiolet, threshold, attack, release) {
    AudioletGroup.call(this, audiolet, 4, 1);

    // Parameters
    var attack = attack || 0.01;
    this.attackNode = new ParameterNode(audiolet, attack);
    this.attack = this.attackNode.parameter;

    var release = release || 0.4;
    this.releaseNode = new ParameterNode(audiolet, release);
    this.release = this.releaseNode.parameter;

    this.amplitude = new Amplitude(audiolet);
    this.limitFromAmplitude = new LimitFromAmplitude(audiolet, threshold);
    this.threshold = this.limitFromAmplitude.threshold;

    this.inputs[0].connect(this.amplitude);
    this.inputs[0].connect(this.limitFromAmplitude, 0, 0);
    this.inputs[1].connect(this.limitFromAmplitude, 0, 2);
    this.inputs[2].connect(this.attackNode);
    this.inputs[3].connect(this.releaseNode);

    this.attackNode.connect(this.amplitude, 0, 1);
    this.releaseNode.connect(this.amplitude, 0, 2);

    this.amplitude.connect(this.limitFromAmplitude, 0, 1);
    this.limitFromAmplitude.connect(this.outputs[0]);
};
extend(Limiter, AudioletGroup);

Limiter.prototype.toString = function() {
    return 'Limiter';
};

var LimitFromAmplitude = function(audiolet, threshold) {
    AudioletNode.call(this, audiolet, 3, 1);
    this.linkNumberOfOutputChannels(0, 0);
    this.threshold = new AudioletParameter(this, 2, threshold || 0.95);
};
extend(LimitFromAmplitude, AudioletNode);

LimitFromAmplitude.prototype.generate = function(inputBuffers, outputBuffers) {
    var inputBuffer = inputBuffers[0];
    var amplitudeBuffer = inputBuffers[1];
    var amplitudeChannel = inputBuffer.getChannelData(0);
    var outputBuffer = outputBuffers[0];

    if (inputBuffer.isEmpty || amplitudeBuffer.isEmpty) {
        outputBuffer.isEmpty = true;
        return;
    }

    // Local processing variables
    var thresholdParameter = this.threshold;
    var threshold, thresholdChannel;
    if (thresholdParameter.isStatic()) {
        threshold = thresholdParameter.getValue();
    }
    else {
        thresholdChannel = thresholdParameter.getChannel();
    }

    var numberOfChannels = inputBuffer.numberOfChannels;
    for (var i = 0; i < numberOfChannels; i++) {
        var inputChannel = inputBuffer.getChannelData(i);
        var outputChannel = outputBuffer.getChannelData(i);
        var bufferLength = inputBuffer.length;
        for (var j = 0; j < bufferLength; j++) {
            var value = inputChannel[j];
            var amplitude = amplitudeChannel[j];
            if (thresholdChannel) {
                threshold = thresholdChannel[j];
            }

            var diff = amplitude - threshold;
            if (diff > 0) {
                outputChannel[j] = inputChannel[j] / (1 + diff);
            }
            else {
                outputChannel[j] = inputChannel[j];
            }
        }
    }
};

LimitFromAmplitude.prototype.toString = function() {
    return ('Limit From Amplitude');
};

/**
 * @depends ../core/AudioletNode.js
 */

var LinearCrossFade = function(audiolet, position) {
    AudioletNode.call(this, audiolet, 3, 1);
    this.linkNumberOfOutputChannels(0, 0);
    this.position = new AudioletParameter(this, 2, position || 0.5);
};
extend(LinearCrossFade, AudioletNode);

LinearCrossFade.prototype.generate = function(inputBuffers, outputBuffers) {
    var inputBufferA = inputBuffers[0];
    var inputBufferB = inputBuffers[1];
    var outputBuffer = outputBuffers[0];

    var inputChannelsA = inputBufferA.channels;
    var inputChannelsB = inputBufferB.channels;
    var outputChannels = outputBuffer.channels;

    if (inputBufferA.isEmpty || inputBufferB.isEmpty) {
        outputBuffer.isEmpty = true;
        return;
    }

    // Local processing variables
    var positionParameter = this.position;
    var position, positionChannel;
    if (positionParameter.isStatic()) {
        position = positionParameter.getValue();
    }
    else {
        positionChannel = positionParameter.getChannel();
    }

    var bufferLength = outputBuffer.length;
    for (var i = 0; i < bufferLength; i++) {
        if (positionChannel) {
            position = positionChannel[i];
        }

        var gainA = 1 - position;
        var gainB = position;

        var numberOfChannels = inputBufferA.numberOfChannels;
        for (var j = 0; j < numberOfChannels; j++) {
            var inputChannelA = inputChannelsA[j];
            var inputChannelB = inputChannelsB[j];
            var outputChannel = outputChannels[j];

            outputChannel[i] = inputChannelA[i] * gainA +
                               inputChannelB[i] * gainB;
        }
    }
};

LinearCrossFade.prototype.toString = function() {
    return 'Linear Cross Fader';
};

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

/**
 * @depends ../core/AudioletNode.js
 */

var Pan = function(audiolet) {
    AudioletNode.call(this, audiolet, 2, 1);
    // Hardcode two output channels
    this.setNumberOfOutputChannels(0, 2);
    this.pan = new AudioletParameter(this, 1, 0.5);
};
extend(Pan, AudioletNode);

Pan.prototype.generate = function(inputBuffers, outputBuffers) {
    var inputBuffer = inputBuffers[0];
    var outputBuffer = outputBuffers[0];

    if (inputBuffer.isEmpty) {
        outputBuffer.isEmpty = true;
        return;
    }

    var inputChannel = inputBuffer.getChannelData(0);
    var leftOutputChannel = outputBuffer.getChannelData(0);
    var rightOutputChannel = outputBuffer.getChannelData(1);

    // Local processing variables
    var panParameter = this.pan;
    var pan, panChannel;
    if (panParameter.isStatic()) {
        pan = panParameter.getValue();
    }
    else {
        panChannel = panParameter.getChannel();
    }

    var bufferLength = outputBuffer.length;
    for (var i = 0; i < bufferLength; i++) {
        if (panChannel) {
            pan = panChannel[i];
        }
        var scaledPan = pan * Math.PI / 2;
        var value = inputChannel[i];
        // TODO: Use sine/cos tables?
        leftOutputChannel[i] = value * Math.cos(scaledPan);
        rightOutputChannel[i] = value * Math.sin(scaledPan);
    }
};

Pan.prototype.toString = function() {
    return 'Stereo Panner';
};

/*!
 * @depends Envelope.js
 */

/**
 * Simple attack-release envelope
 *
 * **Inputs**
 *
 * - Gate
 *
 * **Outputs**
 *
 * - Envelope
 *
 * **Parameters**
 *
 * - gate The gate controlling the envelope.  Value changes from 0 -> 1
 * trigger the envelope.  Linked to input 0.
 *
 * @constructor
 * @extends Envelope
 * @param {Audiolet} audiolet The audiolet object.
 * @param {Number} gate The initial gate value.
 * @param {Number} attack The attack time in seconds.
 * @param {Number} release The release time in seconds.
 * @param {Function} [onComplete] A function called after the release stage.
 */
var PercussiveEnvelope = function(audiolet, gate, attack, release,
                                  onComplete) {
    var levels = [0, 1, 0];
    var times = [attack, release];
    Envelope.call(this, audiolet, gate, levels, times, null, onComplete);
};
extend(PercussiveEnvelope, Envelope);

/**
 * toString
 *
 * @return {String} String representation.
 */
PercussiveEnvelope.prototype.toString = function() {
    return 'Percussive Envelope';
};

/**
 * @depends ../core/AudioletGroup.js
 */

// Schroder/Moorer Reverb Unit based on Freeverb
// https://ccrma.stanford.edu/~jos/pasp/Freeverb.html has a good description
// of how it all works

var Reverb = function(audiolet, mix, roomSize, damping) {
    AudioletGroup.call(this, audiolet, 4, 1);

    // Constants
    this.initialMix = 0.33;
    this.fixedGain = 0.015;
    this.initialDamping = 0.5;
    this.scaleDamping = 0.4;
    this.initialRoom = 0.5;
    this.scaleRoom = 0.28;
    this.offsetRoom = 0.7;

    // Parameters: for 44.1k or 48k
    this.combTuning = [1116, 1188, 1277, 1356, 1422, 1491, 1557, 1617];
    this.allPassTuning = [556, 441, 341, 225];

    // Controls
    // Room size control
    var roomSize = roomSize || this.initialRoomSize;
    this.roomSizeNode = new ParameterNode(audiolet, roomSize);
    this.roomSizeMulAdd = new MulAdd(audiolet, this.scaleRoom,
                                     this.offsetRoom);

    // Damping control
    var damping = damping || this.initialDamping;
    this.dampingNode = new ParameterNode(audiolet, damping);
    this.dampingMulAdd = new MulAdd(audiolet, this.scaleDamping);

    // Access the controls as if this is an AudioletNode, and they are it's
    // parameters.
    this.roomSize = this.roomSizeNode.parameter;
    this.damping = this.dampingNode.parameter;

    // Initial gain control
    this.gain = new Gain(audiolet, this.fixedGain);

    // Eight comb filters and feedback gain converters
    this.combFilters = [];
    this.fgConverters = [];
    for (var i = 0; i < this.combTuning.length; i++) {
        var delayTime = this.combTuning[i] /
                        this.audiolet.device.sampleRate;
        this.combFilters[i] = new DampedCombFilter(audiolet, delayTime,
                                                   delayTime);

        this.fgConverters[i] = new FeedbackGainToDecayTime(audiolet,
                                                           delayTime);
    }

    // Four allpass filters
    this.allPassFilters = [];
    for (var i = 0; i < this.allPassTuning.length; i++) {
        this.allPassFilters[i] = new AllPassFilter(audiolet,
                                                   this.allPassTuning[i]);
    }

    // Mixer
    var mix = mix || this.initialMix;
    this.mixer = new LinearCrossFade(audiolet, mix);

    this.mix = this.mixer.position;

    // Connect up the controls
    this.inputs[1].connect(this.mixer, 0, 2);

    this.inputs[2].connect(this.roomSizeNode);
    this.roomSizeNode.connect(this.roomSizeMulAdd);

    this.inputs[3].connect(this.dampingNode);
    this.dampingNode.connect(this.dampingMulAdd);

    // Connect up the gain
    this.inputs[0].connect(this.gain);

    // Connect up the comb filters
    for (var i = 0; i < this.combFilters.length; i++) {
        this.gain.connect(this.combFilters[i]);
        this.combFilters[i].connect(this.allPassFilters[0]);

        // Controls
        this.roomSizeMulAdd.connect(this.fgConverters[i]);
        this.fgConverters[i].connect(this.combFilters[i], 0, 2);

        this.dampingMulAdd.connect(this.combFilters[i], 0, 3);
    }

    // Connect up the all pass filters
    var numberOfAllPassFilters = this.allPassFilters.length;
    for (var i = 0; i < numberOfAllPassFilters - 1; i++) {
        this.allPassFilters[i].connect(this.allPassFilters[i + 1]);
    }

    this.inputs[0].connect(this.mixer);
    var lastAllPassIndex = numberOfAllPassFilters - 1;
    this.allPassFilters[lastAllPassIndex].connect(this.mixer, 0, 1);

    this.mixer.connect(this.outputs[0]);
};
extend(Reverb, AudioletGroup);

Reverb.prototype.toString = function() {
    return 'Reverb';
};

// Converts a feedback gain multiplier to a 60db decay time
var FeedbackGainToDecayTime = function(audiolet, delayTime) {
    AudioletNode.call(this, audiolet, 1, 1);
    this.delayTime = delayTime;
    this.lastFeedbackGain = null;
    this.decayTime = null;
};
extend(FeedbackGainToDecayTime, AudioletNode);

FeedbackGainToDecayTime.prototype.generate = function(inputBuffers,
                                                      outputBuffers) {
    var inputBuffer = inputBuffers[0];
    var outputBuffer = outputBuffers[0];
    var inputChannel = inputBuffer.channels[0];
    var outputChannel = outputBuffer.channels[0];

    var delayTime = this.lastDelayTime;
    var decayTime = this.decayTime;
    var lastFeedbackGain = this.lastFeedbackGain;

    var bufferLength = outputBuffer.length;
    for (var i = 0; i < bufferLength; i++) {
        var feedbackGain = inputChannel[i];
        if (feedbackGain != lastFeedbackGain) {
            decayTime = - 3 * delayTime / Math.log(feedbackGain);
            lastFeedbackGain = feedbackGain;
        }
        outputChannel[i] = feedbackGain;
    }

    this.decayTime = decayTime;
    this.lastFeedbackGain = lastFeedbackGain;
};

/*!
 * @depends TableLookupOscillator.js
 */

/**
 * Saw wave oscillator using a lookup table
 *
 * **Inputs**
 *
 * - Frequency
 *
 * **Outputs**
 *
 * - Saw wave
 *
 * **Parameters**
 *
 * - frequency The frequency of the oscillator.  Linked to input 0.
 *
 * @constructor
 * @extends TableLookupOscillator
 * @param {Audiolet} audiolet The audiolet object.
 * @param {Number} [frequency=440] Initial frequency.
 */
var Saw = function(audiolet, frequency) {
    TableLookupOscillator.call(this, audiolet, Saw.TABLE, frequency);
};
extend(Saw, TableLookupOscillator);

/**
 * toString
 *
 * @return {String} String representation.
 */
Saw.prototype.toString = function() {
    return 'Saw';
};

/**
 * Saw table
 */
Saw.TABLE = [];
for (var i = 0; i < 8192; i++) {
    Saw.TABLE.push(((((i - 4096) / 8192) % 1) + 1) % 1 * 2 - 1);
}


/**
 * @depends ../core/AudioletNode.js
 */

var SoftClip = function(audiolet) {
    AudioletNode.call(this, audiolet, 1, 1);
    this.linkNumberOfOutputChannels(0, 0);
};
extend(SoftClip, AudioletNode);

SoftClip.prototype.generate = function(inputBuffers, outputBuffers) {
    var inputBuffer = inputBuffers[0];
    var outputBuffer = outputBuffers[0];

    if (inputBuffer.isEmpty) {
        outputBuffer.isEmpty = true;
        return;
    }

    var numberOfChannels = inputBuffer.numberOfChannels;
    for (var i = 0; i < numberOfChannels; i++) {
        var inputChannel = inputBuffer.getChannelData(i);
        var outputChannel = outputBuffer.getChannelData(i);
        var bufferLength = inputBuffer.length;
        for (var j = 0; j < bufferLength; j++) {
            var value = inputChannel[j];
            if (value > 0.5) {
                outputChannel[j] = (value - 0.25) / value;
            }
            else if (value < -0.5) {
                outputChannel[j] = (-value - 0.25) / value;
            }
            else {
                outputChannel[j] = value;
            }
        }
    }
};

SoftClip.prototype.toString = function() {
    return ('SoftClip');
};


/*!
 * @depends TableLookupOscillator.js
 */

/**
 * Square wave oscillator using a lookup table
 *
 * **Inputs**
 *
 * - Frequency
 *
 * **Outputs**
 *
 * - Square wave
 *
 * **Parameters**
 *
 * - frequency The frequency of the oscillator.  Linked to input 0.
 *
 * @constructor
 * @extends TableLookupOscillator
 * @param {Audiolet} audiolet The audiolet object.
 * @param {Number} [frequency=440] Initial frequency.
 */
var Square = function(audiolet, frequency) {
    TableLookupOscillator.call(this, audiolet, Square.TABLE, frequency);
};
extend(Square, TableLookupOscillator);

/**
 * toString
 *
 * @return {String} String representation.
 */
Square.prototype.toString = function() {
    return 'Square';
};

/**
 * Square wave table
 */
Square.TABLE = [];
for (var i = 0; i < 8192; i++) {
    Square.TABLE.push(((i - 4096) / 8192) < 0 ? 1 : -1);
}



/*!
 * @depends TableLookupOscillator.js
 */

/**
 * Triangle wave oscillator using a lookup table
 *
 * **Inputs**
 *
 * - Frequency
 *
 * **Outputs**
 *
 * - Triangle wave
 *
 * **Parameters**
 *
 * - frequency The frequency of the oscillator.  Linked to input 0.
 *
 * @constructor
 * @extends TableLookupOscillator
 * @param {Audiolet} audiolet The audiolet object.
 * @param {Number} [frequency=440] Initial frequency.
 */
var Triangle = function(audiolet, frequency) {
    TableLookupOscillator.call(this, audiolet, Triangle.TABLE, frequency);
};
extend(Triangle, TableLookupOscillator);

/**
 * toString
 *
 * @return {String} String representation.
 */
Triangle.prototype.toString = function() {
    return 'Triangle';
};

/**
 * Triangle table
 */
Triangle.TABLE = [];
for (var i = 0; i < 8192; i++) {
    // Smelly, but looks right...
    Triangle.TABLE.push(Math.abs(((((i - 2048) / 8192) % 1) + 1) % 1 * 2 - 1) * 2 - 1);
}


/**
 * @depends ../core/AudioletNode.js
 */

var TriggerControl = function(audiolet, trigger) {
    AudioletNode.call(this, audiolet, 0, 1);
    this.trigger = new AudioletParameter(this, null, trigger || 0);
};
extend(TriggerControl, AudioletNode);

TriggerControl.prototype.generate = function(inputBuffers, outputBuffers) {
    var buffer = outputBuffers[0];
    var channel = buffer.getChannelData(0);

    var triggerParameter = this.trigger;
    var trigger = triggerParameter.getValue();

    var bufferLength = buffer.length;
    for (var i = 0; i < bufferLength; i++) {
        if (trigger) {
            channel[i] = 1;
            triggerParameter.setValue(0);
            trigger = 0;
        }
        else {
            channel[i] = 0;
        }
    }
};

TriggerControl.prototype.toString = function() {
    return 'Trigger Control';
};

/**
 * @depends ../core/AudioletNode.js
 */

var UpMixer = function(audiolet, outputChannels) {
    AudioletNode.call(this, audiolet, 1, 1);
    this.outputChannels = outputChannels;
    this.outputs[0].numberOfChannels = outputChannels;
};
extend(UpMixer, AudioletNode);

UpMixer.prototype.generate = function(inputBuffers, outputBuffers) {
    var inputBuffer = inputBuffers[0];
    var outputBuffer = outputBuffers[0];

    if (inputBuffer.isEmpty) {
        outputBuffer.isEmpty = true;
        return;
    }

    var outputChannels = this.outputChannels;

    var numberOfChannels = inputBuffer.numberOfChannels;
    for (var i = 0; i < outputChannels; i++) {
        var inputChannel = inputBuffer.getChannelData(i % numberOfChannels);
        var outputChannel = outputBuffer.getChannelData(i);
        outputChannel.set(inputChannel);
    }
};

UpMixer.prototype.toString = function() {
    return 'UpMixer';
};


/**
 * @depends ../core/AudioletNode.js
 */
var WhiteNoise = function(audiolet) {
    AudioletNode.call(this, audiolet, 0, 1);
};
extend(WhiteNoise, AudioletNode);

WhiteNoise.prototype.generate = function(inputBuffers, outputBuffers) {
    var buffer = outputBuffers[0];
    var channel = buffer.getChannelData(0);

    // Processing loop
    var bufferLength = buffer.length;
    for (var i = 0; i < bufferLength; i++) {
        channel[i] = Math.random() * 2 - 1;
    }
};

WhiteNoise.prototype.toString = function() {
    return 'White Noise';
};


/**
 * @depends ../core/AudioletNode.js
 */

var Add = function(audiolet, value) {
    AudioletNode.call(this, audiolet, 2, 1);
    this.linkNumberOfOutputChannels(0, 0);
    this.value = new AudioletParameter(this, 1, value || 1);
};
extend(Add, AudioletNode);

Add.prototype.generate = function(inputBuffers, outputBuffers) {
    var inputBuffer = inputBuffers[0];
    var outputBuffer = outputBuffers[0];

    if (inputBuffer.isEmpty) {
        outputBuffer.isEmpty = true;
        return;
    }

    // Local processing variables
    var valueParameter = this.value;
    var value, valueChannel;
    if (valueParameter.isStatic()) {
        value = valueParameter.getValue();
    }
    else {
        valueChannel = valueParameter.getChannel();
    }

    var numberOfChannels = inputBuffer.numberOfChannels;
    for (var i = 0; i < numberOfChannels; i++) {
        var inputChannel = inputBuffer.getChannelData(i);
        var outputChannel = outputBuffer.getChannelData(i);
        var bufferLength = inputBuffer.length;
        for (var j = 0; j < bufferLength; j++) {
            if (valueChannel) {
                value = valueChannel[j];
            }
            outputChannel[j] = inputChannel[j] + value;
        }
    }
};

Add.prototype.toString = function() {
    return 'Add';
};


/**
 * @depends ../core/AudioletNode.js
 */

var Divide = function(audiolet, value) {
    AudioletNode.call(this, audiolet, 2, 1);
    this.linkNumberOfOutputChannels(0, 0);
    this.value = new AudioletParameter(this, 1, value || 1);
};
extend(Divide, AudioletNode);

Divide.prototype.generate = function(inputBuffers, outputBuffers) {
    var inputBuffer = inputBuffers[0];
    var outputBuffer = outputBuffers[0];

    if (inputBuffer.isEmpty) {
        outputBuffer.isEmpty = true;
        return;
    }

    // Local processing variables
    var valueParameter = this.value;
    var value, valueChannel;
    if (valueParameter.isStatic()) {
        value = valueParameter.getValue();
    }
    else {
        valueChannel = valueParameter.getChannel();
    }

    var numberOfChannels = inputBuffer.numberOfChannels;
    for (var i = 0; i < numberOfChannels; i++) {
        var inputChannel = inputBuffer.getChannelData(i);
        var outputChannel = outputBuffer.getChannelData(i);
        var bufferLength = inputBuffer.length;
        for (var j = 0; j < bufferLength; j++) {
            if (valueChannel) {
                value = valueChannel[j];
            }
            outputChannel[j] = inputChannel[j] / value;
        }
    }
};

Divide.prototype.toString = function() {
    return 'Divide';
};


/**
 * @depends ../core/AudioletNode.js
 */

var Modulo = function(audiolet, value) {
    AudioletNode.call(this, audiolet, 2, 1);
    this.linkNumberOfOutputChannels(0, 0);
    this.value = new AudioletParameter(this, 1, value || 1);
};
extend(Modulo, AudioletNode);

Modulo.prototype.generate = function(inputBuffers, outputBuffers) {
    var inputBuffer = inputBuffers[0];
    var outputBuffer = outputBuffers[0];

    if (inputBuffer.isEmpty) {
        outputBuffer.isEmpty = true;
        return;
    }

    // Local processing variables
    var valueParameter = this.value;
    var value, valueChannel;
    if (valueParameter.isStatic()) {
        value = valueParameter.getValue();
    }
    else {
        valueChannel = valueParameter.getChannel();
    }

    var numberOfChannels = inputBuffer.numberOfChannels;
    for (var i = 0; i < numberOfChannels; i++) {
        var inputChannel = inputBuffer.getChannelData(i);
        var outputChannel = outputBuffer.getChannelData(i);
        var bufferLength = inputBuffer.length;
        for (var j = 0; j < bufferLength; j++) {
            if (valueChannel) {
                value = valueChannel[j];
            }
            outputChannel[j] = inputChannel[j] % value;
        }
    }
};

Modulo.prototype.toString = function() {
    return 'Modulo';
};


/**
 * @depends ../core/AudioletNode.js
 */

var MulAdd = function(audiolet, mul, add) {
    AudioletNode.call(this, audiolet, 3, 1);
    this.linkNumberOfOutputChannels(0, 0);
    this.mul = new AudioletParameter(this, 1, mul || 1);
    this.add = new AudioletParameter(this, 2, add || 0);
};
extend(MulAdd, AudioletNode);

MulAdd.prototype.generate = function(inputBuffers, outputBuffers) {
    var inputBuffer = inputBuffers[0];
    var outputBuffer = outputBuffers[0];

    if (inputBuffer.isEmpty) {
        outputBuffer.isEmpty = true;
        return;
    }

    // Local processing variables
    var mulParameter = this.mul;
    var mul, mulChannel;
    if (mulParameter.isStatic()) {
        mul = mulParameter.getValue();
    }
    else {
        mulChannel = mulParameter.getChannel();
    }

    var addParameter = this.add;
    var add, addChannel;
    if (addParameter.isStatic()) {
        add = addParameter.getValue();
    }
    else {
        addChannel = addParameter.getChannel();
    }

    var numberOfChannels = inputBuffer.numberOfChannels;
    for (var i = 0; i < numberOfChannels; i++) {
        var inputChannel = inputBuffer.getChannelData(i);
        var outputChannel = outputBuffer.getChannelData(i);
        var bufferLength = inputBuffer.length;
        for (var j = 0; j < bufferLength; j++) {
            if (mulChannel) {
                mul = mulChannel[j];
            }
            if (addChannel) {
                add = addChannel[j];
            }
            outputChannel[j] = inputChannel[j] * mul + add;
        }
    }
};

MulAdd.prototype.toString = function() {
    return 'Multiplier/Adder';
};


/**
 * @depends ../core/AudioletNode.js
 */

var Multiply = function(audiolet, value) {
    AudioletNode.call(this, audiolet, 2, 1);
    this.linkNumberOfOutputChannels(0, 0);
    this.value = new AudioletParameter(this, 1, value || 1);
};
extend(Multiply, AudioletNode);

Multiply.prototype.generate = function(inputBuffers, outputBuffers) {
    var inputBuffer = inputBuffers[0];
    var outputBuffer = outputBuffers[0];

    if (inputBuffer.isEmpty) {
        outputBuffer.isEmpty = true;
        return;
    }

    // Local processing variables
    var valueParameter = this.value;
    var value, valueChannel;
    if (valueParameter.isStatic()) {
        value = valueParameter.getValue();
    }
    else {
        valueChannel = valueParameter.getChannel();
    }

    var numberOfChannels = inputBuffer.numberOfChannels;
    for (var i = 0; i < numberOfChannels; i++) {
        var inputChannel = inputBuffer.getChannelData(i);
        var outputChannel = outputBuffer.getChannelData(i);
        var bufferLength = inputBuffer.length;
        for (var j = 0; j < bufferLength; j++) {
            if (valueChannel) {
                value = valueChannel[j];
            }
            outputChannel[j] = inputChannel[j] * value;
        }
    }
};

Multiply.prototype.toString = function() {
    return 'Multiply';
};


/**
 * @depends ../core/AudioletNode.js
 */

var Reciprocal = function(audiolet, value) {
    AudioletNode.call(this, audiolet, 1, 1);
    this.linkNumberOfOutputChannels(0, 0);
};
extend(Reciprocal, AudioletNode);

Reciprocal.prototype.generate = function(inputBuffers, outputBuffers) {
    var inputBuffer = inputBuffers[0];
    var outputBuffer = outputBuffers[0];

    if (inputBuffer.isEmpty) {
        outputBuffer.isEmpty = true;
        return;
    }

    var numberOfChannels = inputBuffer.numberOfChannels;
    for (var i = 0; i < numberOfChannels; i++) {
        var inputChannel = inputBuffer.getChannelData(i);
        var outputChannel = outputBuffer.getChannelData(i);
        var bufferLength = inputBuffer.length;
        for (var j = 0; j < bufferLength; j++) {
            outputChannel[j] = 1 / inputChannel[j];
        }
    }
};

Reciprocal.prototype.toString = function() {
    return 'Reciprocal';
};


/**
 * @depends ../core/AudioletNode.js
 */

var Subtract = function(audiolet, value) {
    AudioletNode.call(this, audiolet, 2, 1);
    this.linkNumberOfOutputChannels(0, 0);
    this.value = new AudioletParameter(this, 1, value || 1);
};
extend(Subtract, AudioletNode);

Subtract.prototype.generate = function(inputBuffers, outputBuffers) {
    var inputBuffer = inputBuffers[0];
    var outputBuffer = outputBuffers[0];

    if (inputBuffer.isEmpty) {
        outputBuffer.isEmpty = true;
        return;
    }

    // Local processing variables
    var valueParameter = this.value;
    var value, valueChannel;
    if (valueParameter.isStatic()) {
        value = valueParameter.getValue();
    }
    else {
        valueChannel = valueParameter.getChannel();
    }

    var numberOfChannels = inputBuffer.numberOfChannels;
    for (var i = 0; i < numberOfChannels; i++) {
        var inputChannel = inputBuffer.getChannelData(i);
        var outputChannel = outputBuffer.getChannelData(i);
        var bufferLength = inputBuffer.length;
        for (var j = 0; j < bufferLength; j++) {
            if (valueChannel) {
                value = valueChannel[j];
            }
            outputChannel[j] = inputChannel[j] - value;
        }
    }
};

Subtract.prototype.toString = function() {
    return 'Subtract';
};


/**
 * @depends ../core/AudioletNode.js
 */

var Tanh = function(audiolet) {
    AudioletNode.call(this, audiolet, 1, 1);
    this.linkNumberOfOutputChannels(0, 0);
};
extend(Tanh, AudioletNode);

Tanh.prototype.generate = function(inputBuffers, outputBuffers) {
    var inputBuffer = inputBuffers[0];
    var outputBuffer = outputBuffers[0];

    if (inputBuffer.isEmpty) {
        outputBuffer.isEmpty = true;
        return;
    }

    var numberOfChannels = inputBuffer.numberOfChannels;
    for (var i = 0; i < numberOfChannels; i++) {
        var inputChannel = inputBuffer.getChannelData(i);
        var outputChannel = outputBuffer.getChannelData(i);
        var bufferLength = inputBuffer.length;
        for (var j = 0; j < bufferLength; j++) {
            var value = inputChannel[j];
            outputChannel[j] = (Math.exp(value) - Math.exp(-value)) /
                (Math.exp(value) + Math.exp(-value));
        }
    }
};

Tanh.prototype.toString = function() {
    return ('Tanh');
};


var Pattern = function() {
};

Pattern.prototype.next = function() {
    return null;
};

Pattern.prototype.valueOf = function(item) {
    if (item instanceof Pattern) {
        return (item.next());
    }
    else {
        return (item);
    }
};

Pattern.prototype.reset = function() {
};


/**
 * @depends Pattern.js
 */

var PArithmetic = function(start, step, repeats) {
    Pattern.call(this);
    this.start = start;
    this.value = start;
    this.step = step;
    this.repeats = repeats;
    this.position = 0;
};
extend(PArithmetic, Pattern);

PArithmetic.prototype.next = function() {
    var returnValue;
    if (this.position == 0) {
        returnValue = this.value;
        this.position += 1;
    }
    else if (this.position < this.repeats) {
        var step = this.valueOf(this.step);
        if (step != null) {
            this.value += step;
            returnValue = this.value;
            this.position += 1;
        }
        else {
            returnValue = null;
        }
    }
    else {
        returnValue = null;
    }
    return (returnValue);
};

PArithmetic.prototype.reset = function() {
    this.value = this.start;
    this.position = 0;
    if (this.step instanceof Pattern) {
        this.step.reset();
    }
};

var Pseries = PArithmetic;


/**
 * @depends Pattern.js
 */

var PChoose = function(list, repeats) {
    Pattern.call(this);
    this.list = list;
    this.repeats = repeats || 1;
    this.position = 0;
};
extend(PChoose, Pattern);

PChoose.prototype.next = function() {
    var returnValue;
    if (this.position < this.repeats) {
        var index = Math.floor(Math.random() * this.list.length);
        var item = this.list[index];
        var value = this.valueOf(item);
        if (value != null) {
            if (!(item instanceof Pattern)) {
                this.position += 1;
            }
            returnValue = value;
        }
        else {
            if (item instanceof Pattern) {
                item.reset();
            }
            this.position += 1;
            returnValue = this.next();
        }
    }
    else {
        returnValue = null;
    }
    return (returnValue);
};

PChoose.prototype.reset = function() {
    this.position = 0;
    for (var i = 0; i < this.list.length; i++) {
        var item = this.list[i];
        if (item instanceof Pattern) {
            item.reset();
        }
    }
};
var Prand = PChoose;


/**
 * @depends Pattern.js
 */

var PGeometric = function(start, step, repeats) {
    Pattern.call(this);
    this.start = start;
    this.value = start;
    this.step = step;
    this.repeats = repeats;
    this.position = 0;
};
extend(PGeometric, Pattern);

PGeometric.prototype.next = function() {
    var returnValue;
    if (this.position == 0) {
        returnValue = this.value;
        this.position += 1;
    }
    else if (this.position < this.repeats) {
        var step = this.valueOf(this.step);
        if (step != null) {
            this.value *= step;
            returnValue = this.value;
            this.position += 1;
        }
        else {
            returnValue = null;
        }
    }
    else {
        returnValue = null;
    }
    return (returnValue);
};

PGeometric.prototype.reset = function() {
    this.value = this.start;
    this.position = 0;
    if (this.step instanceof Pattern) {
        this.step.reset();
    }
};
var Pgeom = PGeometric;


/**
 * @depends Pattern.js
 */

var PProxy = function(pattern) {
    Pattern.call(this);
    if (pattern) {
        this.pattern = pattern;
    }
};
extend(PProxy, Pattern);

PProxy.prototype.next = function() {
    var returnValue;
    if (this.pattern) {
        var returnValue = this.pattern.next();
    }
    else {
        returnValue = null;
    }
    return returnValue;
};
var Pp = PProxy;


/**
 * @depends Pattern.js
 */

var PRandom = function(low, high, repeats) {
    Pattern.call(this);
    this.low = low;
    this.high = high;
    this.repeats = repeats;
    this.position = 0;
};
extend(PRandom, Pattern);

PRandom.prototype.next = function() {
    var returnValue;
    if (this.position < this.repeats) {
        var low = this.valueOf(this.low);
        var high = this.valueOf(this.high);
        if (low != null && high != null) {
            this.value *= step;
            returnValue = this.value;
            this.position += 1;
        }
        else {
            returnValue = null;
        }
    }
    else {
        returnValue = null;
    }
    return (returnValue);
};

PRandom.prototype.reset = function() {
    this.position = 0;
};
var Pwhite = PRandom;


/**
 * @depends Pattern.js
 */

var PSequence = function(list, repeats, offset) {
    Pattern.call(this);
    this.list = list;
    this.repeats = repeats || 1;
    this.position = 0;
    this.offset = offset || 0;
};
extend(PSequence, Pattern);

PSequence.prototype.next = function() {
    var returnValue;
    if (this.position < this.repeats * this.list.length) {
        var index = (this.position + this.offset) % this.list.length;
        var item = this.list[index];
        var value = this.valueOf(item);
        if (value != null) {
            if (!(item instanceof Pattern)) {
                this.position += 1;
            }
            returnValue = value;
        }
        else {
            if (item instanceof Pattern) {
                item.reset();
            }
            this.position += 1;
            returnValue = this.next();
        }
    }
    else {
        returnValue = null;
    }
    return (returnValue);
};

PSequence.prototype.reset = function() {
    this.position = 0;
    for (var i = 0; i < this.list.length; i++) {
        var item = this.list[i];
        if (item instanceof Pattern) {
            item.reset();
        }
    }
};
var Pseq = PSequence;


/**
 * @depends Pattern.js
 */

var PSeries = function(list, repeats, offset) {
    Pattern.call(this);
    this.list = list;
    this.repeats = repeats || 1;
    this.position = 0;
    this.offset = offset || 0;
};
extend(PSeries, Pattern);

PSeries.prototype.next = function() {
    var returnValue;
    if (this.position < this.repeats) {
        var index = (this.position + this.offset) % this.list.length;
        var item = this.list[index];
        var value = this.valueOf(item);
        if (value != null) {
            if (!(item instanceof Pattern)) {
                this.position += 1;
            }
            returnValue = value;
        }
        else {
            if (item instanceof Pattern) {
                item.reset();
            }
            this.position += 1;
            returnValue = this.next();
        }
    }
    else {
        returnValue = null;
    }
    return (returnValue);
};

PSeries.prototype.reset = function() {
    this.position = 0;
    for (var i = 0; i < this.list.length; i++) {
        var item = this.list[i];
        if (item instanceof Pattern) {
            item.reset();
        }
    }
};
var Pser = PSeries;


/**
 * @depends Pattern.js
 */

var PShuffle = function(list, repeats) {
    Pattern.call(this);
    this.list = [];
    // Shuffle values into new list
    while (list.length) {
        var index = Math.floor(Math.random() * list.length);
        var value = list.splice(index, 1);
        this.list.push(value);
    }
    this.repeats = repeats;
    this.position = 0;
};
extend(PShuffle, Pattern);
PShuffle.prototype.next = function() {
    var returnValue;
    if (this.position < this.repeats * this.list.length) {
        var index = (this.position + this.offset) % this.list.length;
        var item = this.list[index];
        var value = this.valueOf(item);
        if (value != null) {
            if (!(item instanceof Pattern)) {
                this.position += 1;
            }
            returnValue = value;
        }
        else {
            if (item instanceof Pattern) {
                item.reset();
            }
            this.position += 1;
            returnValue = this.next();
        }
    }
    else {
        returnValue = null;
    }
    return (returnValue);
};
var Pshuffle = PShuffle;


/**
 * @depends Pattern.js
 */

var PWeightedChoose = function() {
    Pattern.call(this);
};

PWeightedChoose.prototype.next = function() {
};
extend(PWeightedChoose, Pattern);

Pwrand = PWeightedChoose;

var Scale = function(degrees, tuning) {
    this.degrees = degrees;
    this.tuning = tuning || new EqualTemperamentTuning(12);
};

Scale.prototype.getFrequency = function(degree, rootFrequency, octave) {
    var frequency = rootFrequency;
    octave += Math.floor(degree / this.degrees.length);
    degree %= this.degrees.length;
    frequency *= Math.pow(this.tuning.octaveRatio, octave);
    frequency *= this.tuning.ratios[this.degrees[degree]];
    return frequency;
};

/**
 * @depends Scale.js
 */
var MajorScale = function() {
    Scale.call(this, [0, 2, 4, 5, 7, 9, 11]);
};
extend(MajorScale, Scale);

/**
 * @depends Scale.js
 */
var MinorScale = function() {
    Scale.call(this, [0, 2, 3, 5, 7, 8, 10]);
};
extend(MinorScale, Scale);

var Tuning = function(semitones, octaveRatio) {
    this.semitones = semitones;
    this.octaveRatio = octaveRatio || 2;
    this.ratios = [];
    var tuningLength = this.semitones.length;
    for (var i = 0; i < tuningLength; i++) {
        this.ratios.push(Math.pow(2, i / tuningLength));
    }
};

/**
 * @depends Tuning.js
 */
var EqualTemperamentTuning = function(pitchesPerOctave) {
    var semitones = [];
    for (var i = 0; i < pitchesPerOctave; i++) {
        semitones.push(i);
    }
    Tuning.call(this, semitones, 2);
};
extend(EqualTemperamentTuning, Tuning);

