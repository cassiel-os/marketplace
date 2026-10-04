// @ts-check
/* global palette:writable */
/* global $colorbox, localize, main_ctx, monochrome, selected_colors, selection */
import { update_$swatch } from "./$ColorBox.js";

// import { localize } from "./app-localization.js";
import { custom_colors } from "./color-data.js";
import { detect_monochrome, make_monochrome_palette, show_error_message, undoable } from "./functions.js";
import { $G, get_rgba_from_color } from "./helpers.js";
import { replace_color_globally } from "./image-manipulation.js";

/**
 * Paint-specific handling of color picking.
 *
 * Note: It always updates a cell in the palette and one of the color selections.
 * When the dialog is opened, it always starts[1] with one of the color selections,
 * which lets you use the color picker and then add a custom color based on that.
 * [1]: It may not show the color in the grid, but it will in the custom colors area.
 *
 * @param {JQuery<HTMLDivElement>=} $swatch_to_edit
 * @param {ColorSelectionSlot=} color_selection_slot_to_edit
 */
function show_edit_colors_window($swatch_to_edit, color_selection_slot_to_edit) {
	// console.log($swatch_to_edit, $colorbox.data("$last_fg_color_button"));
	$swatch_to_edit = $swatch_to_edit || $colorbox.data("$last_fg_color_button");
	color_selection_slot_to_edit = color_selection_slot_to_edit || "foreground";

	const $palette = $swatch_to_edit.closest(".palette, .color-box");
	const swatch_index = $palette.find(".swatch").toArray().indexOf($swatch_to_edit[0]);
	const initial_color = selected_colors[color_selection_slot_to_edit];
	choose_color(initial_color, (color) => {
		// The palette may have changed or rerendered due to switching themes,
		// toggling vertical color box mode, or monochrome document mode.
		$swatch_to_edit = $(/** @type {HTMLDivElement} */($palette.find(".swatch")[swatch_index]));
		if (!$swatch_to_edit.length) {
			show_error_message("Swatch no longer exists.");
			return;
		}

		if (monochrome && (swatch_index === 0 || swatch_index === 14)) {
			// when editing first color in first or second row (the solid base colors),
			// update whole monochrome patterns palette and image
			let old_rgba = get_rgba_from_color(palette[swatch_index]);
			const new_rgba = get_rgba_from_color(color);
			const other_rgba = get_rgba_from_color(palette[14 - swatch_index]);
			const main_monochrome_info = detect_monochrome(main_ctx);
			const selection_monochrome_info = (selection && selection.canvas) ? detect_monochrome(selection.canvas.ctx) : main_monochrome_info;
			const selection_matches_main_canvas_colors =
				selection_monochrome_info.isMonochrome &&
				selection_monochrome_info.presentNonTransparentRGBAs.every((rgba) =>
					main_monochrome_info.presentNonTransparentRGBAs.map((rgba) => rgba.toString()).includes(rgba.toString())
				);
			if (
				main_monochrome_info.isMonochrome &&
				selection_monochrome_info.isMonochrome &&
				selection_matches_main_canvas_colors
			) {
				const recolor = (ctx, present_rgbas) => {
					// HTML5 Canvas API is unreliable for exact colors.
					// 1. The specifications specify unpremultiplied alpha, but in practice browsers use premultiplied alpha for performance.
					// 2. Some browsers implement protections against fingerprinting that return slightly random data
					// 3. There may be color profiles that affect returned pixel values vs color table values when loading images.
					//    (BMPs are supposed to be able to embed ICC profiles although I doubt it's prevalent.
					//    Some global system color profile might apply however, I don't know how all that works.)
					if (
						present_rgbas.length === 2 &&
						present_rgbas.every((present_rgba) => `${present_rgba}` !== `${old_rgba}`)
					) {
						// Find the nearer color in the image data to replace.
						const distances = present_rgbas.map((rgba) =>
							Math.abs(rgba[0] - old_rgba[0]) +
							Math.abs(rgba[1] - old_rgba[1]) +
							Math.abs(rgba[2] - old_rgba[2]) +
							Math.abs(rgba[3] - old_rgba[3])
						);
						if (distances[0] < distances[1]) {
							old_rgba = present_rgbas[0];
						} else {
							old_rgba = present_rgbas[1];
						}
					}
					const image_data = ctx.getImageData(0, 0, ctx.canvas.width, ctx.canvas.height);
					replace_color_globally(image_data, old_rgba[0], old_rgba[1], old_rgba[2], old_rgba[3], new_rgba[0], new_rgba[1], new_rgba[2], new_rgba[3]);
					ctx.putImageData(image_data, 0, 0);
				};
				undoable({
					name: "Recolor",
				}, () => {
					recolor(main_ctx, main_monochrome_info.presentNonTransparentRGBAs);
					if (selection && selection.canvas) {
						recolor(selection.canvas.ctx, selection_monochrome_info.presentNonTransparentRGBAs);
						// I feel like this shouldn't be necessary, if I'm not changing the size, but it makes it work:
						selection.replace_source_canvas(selection.canvas);
					}
				});
			}
			if (swatch_index) {
				palette = make_monochrome_palette(other_rgba, new_rgba);
			} else {
				palette = make_monochrome_palette(new_rgba, other_rgba);
			}
			$colorbox.rebuild_palette();
			selected_colors.foreground = palette[0];
			selected_colors.background = palette[14]; // first in second row
			selected_colors.ternary = "";
			$G.triggerHandler("option-changed");
		} else {
			palette[swatch_index] = color;
			update_$swatch($swatch_to_edit, color);
			selected_colors[color_selection_slot_to_edit] = color;
			$G.triggerHandler("option-changed");
			window.console?.log(`Updated palette: ${palette.map(() => "%c█").join("")}`, ...palette.map((color) => `color: ${color};`));
		}
	});
}

// Repurposable color picker modeled after the Windows system color picker
// The color dialog is the desktop's (it keeps the custom colors too).
function choose_color(initial_color, callback) {
	window.cassiel.dialog.chooseColor({ title: localize("Edit Colors"), color: initial_color, customColors: custom_colors }).then((result) => {
		if (!result) return;
		custom_colors.splice(0, custom_colors.length, ...result.customColors);
		callback(result.color);
	});
}

export { show_edit_colors_window };
