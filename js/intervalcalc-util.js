function multbyratio() {
	var startFreq = parseFloat(document.getElementById('inputFreq').value);
	var num = parseFloat(document.getElementById('numerator').value);
	var den = parseFloat(document.getElementById('denominator').value);
	var result = startFreq*num/den;
	synths[1].sine.frequency.setValue(result);
	result = Math.round(result*100)/100;
	noteNameResult(result);
	document.getElementById('resultHz').innerHTML = result + " Hz";
}

function multbyet(startFreq) {
	var startFreq = parseFloat(document.getElementById('inputFreq').value);
	var steps = parseFloat(document.getElementById('steps').value);
	var stepsper = parseFloat(document.getElementById('stepsperoctave').value);
	var result = startFreq * Math.pow(2,steps/stepsper);
	synths[1].sine.frequency.setValue(result);
	result = Math.round(result*100)/100;
	noteNameResult(result);
	document.getElementById('resultHz').innerHTML = result + "Hz";
}

function switchTransform(selectObj) {
	var chosenoption=selectObj.options[selectObj.selectedIndex].value;
	if (chosenoption == "JI") {
		document.getElementById('transformspan').innerHTML = "Ratio: <input type=\"text\" size=\"3\" maxlength=\"3\" id=\"numerator\" value=\"1\" onchange=\"multbyratio()\"  /> / <input type=\"text\" size=\"3\" maxlength=\"3\" id=\"denominator\" value=\"1\" onchange=\"multbyratio()\"  /><br />";
	} else if (chosenoption == "ET") {	
		document.getElementById('transformspan').innerHTML = "<input type=\"text\" size=\"3\" maxlength=\"3\" id=\"steps\" value=\"0\" onchange=\"multbyet()\"  /> steps out of <input type=\"text\" size=\"3\" maxlength=\"3\" id=\"stepsperoctave\" value=\"12\" onchange=\"multbyet()\"  /> steps per octave <br />";
	}
	updateResult();
}

function note2midi(noteName, accidental, octave) {
	var result;
	switch(noteName) {
		case 'C': result = 0; break;
		case 'D': result = 2; break;
		case 'E': result = 4; break;
		case 'F': result = 5; break;
		case 'G': result = 7; break;
		case 'A': result = 9; break;
		case 'B': result = 11; break;
		default: alert("note2midi: problem with note name");
	}
	switch(accidental) {
		case 'natural': break;
		case 'sharp': result = result+1; break;
		case 'flat': result = result-1; break;
		default: alert("note2midi: problem with accidental");
	}
	result = result + ((parseFloat(octave)+1)*12);
	return result;		
}

function midi2freq(midiNote) {
	return 440. * Math.pow(2, (midiNote-69)/12.);
}

function freq2midi(freq) {
	// (log (base 2^(1/12)) freq/440.) + 69
	return Math.log(freq/440.)/Math.log(Math.pow(2,1./12.)) + 69.
}

function midi2note(midiNote) {
}

function selectValueSet(selectId, val) {
	var selectObject = document.getElementById(selectId);
	for (index = 0; index < selectObject.length; index++) {
		if (selectObject[index].value == val) {
			selectObject.selectedIndex = index;
			break;
		}
   } 
}

function selectValueGet(selectId) {
	var e = document.getElementById(selectId);
	return e.options[e.selectedIndex].value;
}

function noteNameResult(freq) {
	var midiNum = freq2midi(freq);
	var roundedMidiNum = Math.round(midiNum);
	var cents = Math.round(((midiNum-roundedMidiNum)*10000)/100);
	var octave = ((roundedMidiNum - (roundedMidiNum % 12)) / 12) - 1;
	midiNum = roundedMidiNum % 12;
	var noteNames=["C","C","D","D","E","F","F","G","G","A","A","B"];
	var accidentals=["♮","♯","♮","♯","♮","♮","♯","♮","♯","♮","♯","♮"];
	document.getElementById("result12tet").innerHTML = noteNames[midiNum] + accidentals[midiNum] + octave + " " + printCents(cents) + "¢";
}

function updateResult() {
	var calcType = selectValueGet('calcType');
	switch(calcType) {
		case 'JI': multbyratio(); break;
		case 'ET': multbyet(); break;
		default: alert("updateResult: what kind of calculation?");
	}
}


function printCents(n) {
	return (n > 0) ? "+" + n : n; 
}

function changedFreq() {
	var newFreq = parseFloat(document.getElementById("inputFreq").value)
	synths[0].sine.frequency.setValue(newFreq);
	var midiNum = freq2midi(newFreq);
	var roundedMidiNum = Math.round(midiNum);
	var cents = Math.round(((midiNum-roundedMidiNum)*10000)/100);	
	document.getElementById("inputCents").value = printCents(cents);
	var octave = ((roundedMidiNum - (roundedMidiNum % 12)) / 12) - 1;
	midiNum = roundedMidiNum % 12;
	var noteNames=["C","C","D","D","E","F","F","G","G","A","A","B"];
	var accidentals=["natural","sharp","natural","sharp","natural","natural","sharp","natural","sharp","natural","sharp","natural"];
	selectValueSet("inputNoteName",noteNames[midiNum]);
	selectValueSet("inputAccidental",accidentals[midiNum]);
	selectValueSet("inputOctave",octave+'');
	updateResult();
}

function changedNote() {
	var noteName = selectValueGet("inputNoteName");
	var accidental = selectValueGet("inputAccidental");
	var octave = selectValueGet("inputOctave");
	var centsStr = document.getElementById("inputCents").value;
	if (centsStr == "") {
		centsStr = "0";
	}
	var cents = parseFloat(centsStr);
	var newFreq = midi2freq(note2midi(noteName,accidental,octave)+(cents/100));
	synths[0].sine.frequency.setValue(newFreq);
	document.getElementById("inputFreq").value = newFreq;
	updateResult();
}

function toggleSynth(val, n) {
	if (val == true) {
		synths[n].gain.gain.setValue(0.7);
	} else {
		synths[n].gain.gain.setValue(0);
	}
}