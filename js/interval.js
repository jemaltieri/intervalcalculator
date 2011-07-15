function Interval() {
	var name = new Object; // ie minor third
	name.modifier = null; // ie minor
	name.interval = null; // ie third
	var ratio = new Object; 
	ratio.numerator = 1;
	ratio.denominator = 1;
	var ET = new Object;
	ET.steps = null;
	ET.stepsPerOctave = null;
	var intervalType = "JI";
	
	this.setRatio = function(num,den) {
		ratio.numerator = num;
		ratio.denominator = den;
		intervalType = "JI";
	};
	
	this.setET = function(interval,peroct) {
		ET.steps = interval;
		ET.stepsPerOctave = peroct;
		intervalType = "ET";
	};

	this.setCents = function(cents) {
		ET.steps = cents;
		ET.stepsPerOctave = 1200;
		intervalType = "ET";
	};	
	
	this.getMult = function() {
		var result;
		//alert(intervalType);
		switch(intervalType) {
			case "JI": result = ratio.numerator/ratio.denominator; break;
			case "ET": result = Math.pow(2,ET.steps/ET.stepsPerOctave); break;
			default: result = -1;
		}
		return result;
	};

}