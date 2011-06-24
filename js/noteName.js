function NoteName() {
	this.noteLetter = "A";
	this.noteAccidental = "natural";
	this.noteAccidentalSymbol = "♮"
	this.noteAccidentalLetter = "N";
	this.octave = 4;
	this.noteCentsDeviation = 0.; //should always be between -50 and +50
	var midiNum = 69.;
	var noteNameScale=["C","C","D","D","E","F","F","G","G","A","A","B"];
	var accidentalLetterScale=["N","#","N","#","N","N","#","N","#","N","#","N"];
	
	this.setNoteFromFreq = function(freq) { //public
		midiNum = this.freq2midi(freq);
		var roundedMidiNum = Math.round(midiNum);
		this.noteCentsDeviation = Math.round(((midiNum-roundedMidiNum)*10000)/100);	
		this.octave = ((roundedMidiNum - (roundedMidiNum % 12)) / 12) - 1;
		//since we're setting from frequency, no way to intelligently choose accidentals or note names, so by default, choose naturals/sharps
		this.noteLetter = noteNameScale[roundedMidiNum%12];
		this.noteAccidentalLetter = accidentalLetterScale[roundedMidiNum%12];
		this.setFromAccidentalLetter();
	};
	
	this.setNoteFromMidiNum = function(num) { //public
		midiNum = num;
		var roundedMidiNum = Math.round(midiNum);
		this.noteCentsDeviation = Math.round(((midiNum-roundedMidiNum)*10000)/100);	
		this.octave = ((roundedMidiNum - (roundedMidiNum % 12)) / 12) - 1;
		//since we're setting from frequency, no way to intelligently choose accidentals or note names, so by default, choose naturals/sharps
		this.noteLetter = noteNameScale[roundedMidiNum%12];
		this.noteAccidentalLetter = accidentalLetterScale[roundedMidiNum%12];
		this.setFromAccidentalLetter();
	};
	
	this.getMidiNum = function() {
		return midiNum;
	};
	
	this.getFreqFromNote = function() { //public
		return 440. * Math.pow(2, (midiNum-69)/12.);
	};
	
	this.setNoteFromNoteName = function(letter,accidental,oct,cents) { //string,string,number,number
		this.noteLetter = letter;
		this.noteAccidental = accidental;
		this.octave = oct;
		this.noteCentsDeviation = cents;
		this.setMidiNumFromNote();
		this.setFromAccidental();
	};

	this.printCents = function() {
		n = noteCentsDeviation;
		return (n > 0) ? "+" + n : n; 
	};

	this.humanReadable = function() {
		return noteLetter + noteAccidentalSymbol + octave + " " + printCents() + "¢";
	};

	this.setMidiNumFromNote = function() {
		switch(this.noteLetter) {
			case 'C': midiNum = 0; break;
			case 'D': midiNum = 2; break;
			case 'E': midiNum = 4; break;
			case 'F': midiNum = 5; break;
			case 'G': midiNum = 7; break;
			case 'A': midiNum = 9; break;
			case 'B': midiNum = 11; break;
			default: alert("setNoteFromNoteName: problem with note letter: "+this.noteLetter);
		}
		switch(this.noteAccidental) {
			case 'natural': break;
			case 'sharp': midiNum = midiNum+1; break;
			case 'flat': midiNum = midiNum-1; break;
			default: alert("setMidiNumFromNoteName: problem with accidental "+this.noteAccidental);
		}
		midiNum = midiNum + ((parseFloat(this.octave)+1)*12);		
	};
	
	this.freq2midi = function(frequency) {
		// (log (base 2^(1/12)) freq/440.) + 69
		return Math.log(frequency/440.)/Math.log(Math.pow(2,1./12.)) + 69.
	};
	
	this.setFromAccidentalLetter = function() { //private
		switch(this.noteAccidentalLetter) {
			case 'N': this.noteAccidental = "natural"; this.noteAccidentalSymbol = "♮"; break;
			case '#': this.noteAccidental = "sharp"; this.noteAccidentalSymbol = "♯"; break;
			case 'B': this.noteAccidental = "flat"; this.noteAccidentalSymbol = "♭"; break;
			default: alert("setFromAccidentalLetter: unrecognized noteAccidentalLetter");
		}
	};
	
	this.setFromAccidental = function() { //private
		switch(this.noteAccidental) {
			case 'natural': this.noteAccidentalLetter = "N"; this.noteAccidentalSymbol = "♮"; break;
			case 'sharp': this.noteAccidentalLetter = "#"; this.noteAccidentalSymbol = "♯"; break;
			case 'flat': this.noteAccidentalLetter = "B"; this.noteAccidentalSymbol = "♭"; break;
			default: alert("setFromAccidental: unrecognized noteAccidental");
		}
	};
	
	this.getNoteStr = function() { //for interacting with vexflow
		var notestr;
		if (this.octave < 4) { //vexflow doesn't take bass clef into account, so hacking around here
			tmpNote = this.clone();
			tmpNote.setNoteFromMidiNum(tmpNote.getMidiNum()+21.); //convert between clefs
			notestr = tmpNote.noteLetter+tmpNote.accidentalLetter+"/"+tmpNote.octave;
		} else {
			notestr = this.noteLetter+this.noteAccidentalLetter+"/"+this.octave;
		}
		return notestr;
	};
	
	this.getClef = function() {
		var clef;
		if (this.octave > 3) {
			clef = "treble";
		} else {
			clef = "bass";
		}
		return clef;
	};
}