// @ts-check
// Paint on Cassiel is in English, like the desktop. The interface text goes through
// localize() all the same (so a translation can come back later); here it only fills in
// the %1, %2… placeholders.

((exports) => {
	/**
	 * @param {string} english_text - The text, with %1, %2… for the values
	 * @param {...string} interpolations - The values
	 * @returns {string}
	 */
	function localize(english_text, ...interpolations) {
		let text = english_text;
		for (let i = 0; i < interpolations.length; i++) {
			text = text.replace(`%${i + 1}`, interpolations[i]);
		}
		return text;
	}
	/** @returns {"ltr"} */
	const get_direction = () => "ltr";

	exports.localize = localize;
	exports.get_direction = get_direction;
})(window);
