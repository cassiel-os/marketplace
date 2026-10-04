// @ts-check
import { E } from "./helpers.js";

/**
 * A panel docked at one edge of Paint (the tool box, the color box).
 * @param {string} className
 * @param {"tall" | "wide"} orientation
 * @param {JQuery<HTMLElement>} $el
 * @returns {JQuery<HTMLDivElement> & I$Component}
 */
function $Component(className, orientation, $el) {
	const $c = /** @type {JQuery<HTMLDivElement> & I$Component} */ ($(E("div")).addClass("component"));
	$c.addClass(className);
	$c.addClass(orientation);
	$c.append($el);
	$c.css("touch-action", "none");

	$c.destroy = () => {
		$c.remove();
	};

	return $c;
}

export { $Component };
