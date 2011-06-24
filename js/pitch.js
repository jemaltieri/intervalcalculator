function Pitch() {
	var frequency = 440.;
	this.note = new NoteName();
	
	this.setFreq = function(freq) {
		frequency = freq;
		this.note.setNoteFromFreq();
	};
	
	this.getFreq = function() {
		return frequency;
	};
	
	this.setNote = function(newNote) { //expecting a noteName object
		note = newNote.clone(); //clone function in intervalcalc-util.js
		frequency = note.getFreqFromNote();
	};
	
	this.getNote = function() {
		return note;
	};

}