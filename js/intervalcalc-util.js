var interval = new Interval();

Object.prototype.clone = function() { //copied from Brian Huisman at http://my.opera.com/GreyWyvern/blog/show.dml/1725165
  var newObj = (this instanceof Array) ? [] : {};
  for (i in this) {
    if (i == 'clone') continue;
    if (this[i] && typeof this[i] == "object") {
      newObj[i] = this[i].clone();
    } else newObj[i] = this[i]
  } return newObj;
};

function initPitches() {
	pitches[0] = new Pitch();
	pitches[1] = new Pitch();
}

function switchTransform(selectObj) {
	var chosenoption=selectObj.options[selectObj.selectedIndex].value;
	if (chosenoption == "JI") {
		document.getElementById('transformspan').innerHTML = "Ratio: <input type=\"text\" size=\"3\" maxlength=\"3\" id=\"numerator\" value=\"1\" onchange=\"changedTransform()\"  /> / <input type=\"text\" size=\"3\" maxlength=\"3\" id=\"denominator\" value=\"1\" onchange=\"changedTransform()\"  /><br />";
	} else if (chosenoption == "ET") {	
		document.getElementById('transformspan').innerHTML = "<input type=\"text\" size=\"3\" maxlength=\"3\" id=\"steps\" value=\"0\" onchange=\"changedTransform()\"  /> steps out of <input type=\"text\" size=\"3\" maxlength=\"3\" id=\"stepsperoctave\" value=\"12\" onchange=\"changedTransform()\"  /> steps per octave <br />";
	}
	changedTransform();
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

function changedTransform() {
	switch (selectValueGet('calcType')) {
		case "JI": interval.setRatio(document.getElementById("numerator").value, document.getElementById("denominator").value); break;
		case "ET": interval.setET(document.getElementById("steps").value, document.getElementById("stepsperoctave").value); break;
		default: alert("changedTransform(): bad value for transform type");
	}
	updateResult();	
}

function updateResult() {
	var result = pitches[0].getFreq()*interval.getMult()
	pitches[1].setFreq(result);
	synths[1].sine.frequency.setValue(result);
	document.getElementById('resultHz').innerHTML = result + "Hz";
	updateStave(1,pitches[1].note); //to vexflow
	document.getElementById("result12tet").innerHTML = pitches[1].note.humanReadable();
}

function changedFreq() {
	var newFreq = parseFloat(document.getElementById("inputFreq").value)
	pitches[0].setFreq(newFreq);
	synths[0].sine.frequency.setValue(newFreq);
	selectValueSet("inputNoteName",pitches[0].note.noteLetter);
	selectValueSet("inputAccidental",pitches[0].note.noteAccidental);
	selectValueSet("inputOctave",pitches[0].note.octave+'');
	document.getElementById("inputCents").value = pitches[0].note.printCents(cents);	
	updateStave(0,pitches[0].note);
	updateResult();	
}

function changedNote() {
	var noteNameStr = selectValueGet("inputNoteName");
	var accidentalStr = selectValueGet("inputAccidental");
	var octaveStr = selectValueGet("inputOctave");
	var centsStr = document.getElementById("inputCents").value;
	if (centsStr == "") {
		centsStr = "0";
	}
	centsNum = parseFloat(centsStr);
	//alert(centsNum);
	octNum = parseInt(octaveStr);
	newNote = new NoteName();
	newNote.setNoteFromNoteName(noteNameStr,accidentalStr,octNum,centsNum);
	pitches[0].setNote(newNote);
	//alert("new starting pitch: "+pitches[0].getFreq());
	synths[0].sine.frequency.setValue(pitches[0].getFreq());
	document.getElementById("inputFreq").value = pitches[0].getFreq();
	//alert(pitches[0].note.noteLetter);
	updateStave(0,pitches[0].note);
	updateResult();
}

function updateStave(canvasnum, noteNameObj) {
	//alert("called updateStave() with "+canvasnum+" and "+noteNameObj);
	canvases[canvasnum].width = canvases[canvasnum].width;
	var renderer = new Vex.Flow.Renderer(canvases[canvasnum], Vex.Flow.Renderer.Backends.CANVAS);
	var ctx = renderer.getContext();
	var stave = new Vex.Flow.Stave(0, 10, 150);
	stave.addClef(noteNameObj.getClef()).setContext(ctx).draw();
	notestr = noteNameObj.getNoteStr();
	var note = new Vex.Flow.StaveNote({keys:[notestr],duration:"w"})
	if ((notestr.charAt(1) != '/') && (notestr.charAt(1) != 'N')) {
		note.addAccidental(0, new Vex.Flow.Accidental(notestr.charAt(1).toLowerCase()));
	}
	var voice = new Vex.Flow.Voice({num_beats:4,beat_value:4,resolution:Vex.Flow.RESOLUTION});
	voice.addTickable(note);
	var formatter = new Vex.Flow.Formatter().joinVoices([voice]).format([voice], 500);
	voice.draw(ctx,stave);
}

function toggleSynth(val, n) {
	if (val == true) {
		synths[n].gain.gain.setValue(0.7);
	} else {
		synths[n].gain.gain.setValue(0);
	}
}