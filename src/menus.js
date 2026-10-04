// @ts-check
/* global tool_transparent_mode:writable, palette:writable, show_font_box:writable */
/* global $canvas_area, $colorbox, $status_area, $toolbox, localize, magnification, main_canvas, redos, selected_tool, selection, show_grid, systemHooks, textbox, undos */
const MENU_DIVIDER = "MENU_DIVIDER";
export { MENU_DIVIDER };

import { OnCanvasTextBox } from "./OnCanvasTextBox.js";
import { show_edit_colors_window } from "./edit-colors.js";
import { palette_formats } from "./file-format-data.js";
import { are_you_sure, choose_file_to_paste, clear, delete_selection, edit_copy, edit_cut, edit_paste, file_new, file_open, file_print, file_save, file_save_as, image_attributes, image_flip_and_rotate, image_invert_colors, image_stretch_and_skew, redo, sanity_check_blob, save_selection_to_file, select_all, set_magnification, show_about_paint, show_custom_zoom_window, show_file_format_errors, toggle_grid, undo, view_bitmap } from "./functions.js";

import { $G, get_rgba_from_color } from "./helpers.js";

const looksLikeChrome = !!(window.chrome && (window.chrome.loadTimes || window.chrome.csi));
// NOTE: Microsoft Edge includes window.chrome.app
// (also this browser detection logic could likely use some more nuance)

/** @type {OSGUITopLevelMenus} */
const menus = {
	[localize("&File")]: [
		{
			label: localize("&New"),
			...shortcut("Ctrl+Alt+N"), // Ctrl+N opens a new browser window
			action: () => { file_new(); },
			description: localize("Creates a new document."),
		},
		{
			label: localize("&Open"),
			...shortcut("Ctrl+O"),
			action: () => { file_open(); },
			description: localize("Opens an existing document."),
		},
		{
			label: localize("&Save"),
			...shortcut("Ctrl+S"),
			action: () => { file_save(); },
			description: localize("Saves the active document."),
		},
		{
			label: localize("Save &As"),
			// in mspaint, no shortcut is listed; it supports F12 (but in a browser that opens the dev tools)
			// it doesn't support Ctrl+Shift+S but that's a good & common modern shortcut
			...shortcut("Ctrl+Shift+S"),
			action: () => { file_save_as(); },
			description: localize("Saves the active document with a new name."),
		},
		MENU_DIVIDER,
		{
			label: localize("Print Pre&view"),
			action: () => {
				file_print();
			},
			description: localize("Prints the active document and sets printing options."),
			//description: localize("Displays full pages."),
		},
		{
			label: localize("Page Se&tup"),
			action: () => {
				file_print();
			},
			description: localize("Prints the active document and sets printing options."),
			//description: localize("Changes the page layout."),
		},
		{
			label: localize("&Print"),
			...shortcut("Ctrl+P"), // relies on browser's print shortcut being Ctrl+P
			action: () => {
				file_print();
			},
			description: localize("Prints the active document and sets printing options."),
		},
		MENU_DIVIDER,
		{
			label: localize("Set As &Wallpaper (Tiled)"),
			action: () => { systemHooks.setWallpaperTiled(main_canvas); },
			description: localize("Tiles this bitmap as the desktop background."),
		},
		{
			label: localize("Set As Wallpaper (&Centered)"), // in mspaint it's Wa&llpaper
			action: () => { systemHooks.setWallpaperCentered(main_canvas); },
			description: localize("Centers this bitmap as the desktop background."),
		},
		MENU_DIVIDER,
		{
			label: localize("Recent File"),
			enabled: false, // @TODO for desktop app
			description: localize(""),
		},
		MENU_DIVIDER,
		{
			label: localize("E&xit"),
			// Alt+F4 closes the browser window (in most window managers)
			action: () => {
				are_you_sure(() => window.cassiel.close());
			},
			description: localize("Quits Paint."),
		},
	],
	[localize("&Edit")]: [
		{
			label: localize("&Undo"),
			...shortcut("Ctrl+Z"),
			enabled: () => undos.length >= 1,
			action: () => { undo(); },
			description: localize("Undoes the last action."),
		},
		{
			label: localize("&Repeat"),
			...shortcut("F4"), // also supported: Ctrl+Shift+Z, Ctrl+Y
			enabled: () => redos.length >= 1,
			action: () => { redo(); },
			description: localize("Redoes the previously undone action."),
		},
		MENU_DIVIDER,
		{
			label: localize("Cu&t"),
			...shortcut("Ctrl+X"),
			enabled: () =>
				// @TODO: support cutting text with this menu item as well (e.g. for the text tool)
				!!selection,
			action: () => {
				edit_cut(true);
			},
			description: localize("Cuts the selection and puts it on the Clipboard."),
		},
		{
			label: localize("&Copy"),
			...shortcut("Ctrl+C"),
			enabled: () =>
				// @TODO: support copying text with this menu item as well (e.g. for the text tool)
				!!selection,
			action: () => {
				edit_copy(true);
			},
			description: localize("Copies the selection and puts it on the Clipboard."),
		},
		{
			label: localize("&Paste"),
			...shortcut("Ctrl+V"),
			enabled: () =>
				// @TODO: disable if nothing in clipboard or wrong type (if we can access that)
				true,
			action: () => {
				edit_paste(true);
			},
			description: localize("Inserts the contents of the Clipboard."),
		},
		{
			label: localize("C&lear Selection"),
			...shortcut("Del"),
			enabled: () => !!selection,
			action: () => { delete_selection(); },
			description: localize("Deletes the selection."),
		},
		{
			label: localize("Select &All"),
			...shortcut("Ctrl+A"),
			action: () => { select_all(); },
			description: localize("Selects everything."),
		},
		MENU_DIVIDER,
		{
			label: `${localize("C&opy To")}...`,
			enabled: () => !!selection,
			action: () => { save_selection_to_file(); },
			description: localize("Copies the selection to a file."),
		},
		{
			label: `${localize("Paste &From")}...`,
			action: () => { choose_file_to_paste(); },
			description: localize("Pastes a file into the selection."),
		},
	],
	[localize("&View")]: [
		{
			label: localize("&Tool Box"),
			// Ctrl+T opens a new browser tab, Ctrl+Alt+T opens a Terminal in Ubuntu, and Ctrl+Shift+Alt+T feels silly.
			checkbox: {
				toggle: () => {
					$toolbox.toggle();
				},
				check: () => $toolbox.is(":visible"),
			},
			description: localize("Shows or hides the tool box."),
		},
		{
			label: localize("&Color Box"),
			...shortcut("Ctrl+L"), // focuses browser address bar, but Firefox and Chrome both allow overriding the default behavior
			checkbox: {
				toggle: () => {
					$colorbox.toggle();
				},
				check: () => $colorbox.is(":visible"),
			},
			description: localize("Shows or hides the color box."),
		},
		{
			label: localize("&Status Bar"),
			checkbox: {
				toggle: () => {
					$status_area.toggle();
				},
				check: () => $status_area.is(":visible"),
			},
			description: localize("Shows or hides the status bar."),
		},
		{
			label: localize("T&ext Toolbar"),
			enabled: () => selected_tool.id === "TOOL_TEXT",
			checkbox: {
				toggle: () => {
					show_font_box = !show_font_box;
					OnCanvasTextBox.update_fontbox();
				},
				check: () => show_font_box,
			},
			description: localize("Shows or hides the text toolbar."),
		},
		MENU_DIVIDER,
		{
			label: localize("&Zoom"),
			submenu: [
				{
					label: localize("&Normal Size"),
					// Ctrl+PageUp cycles thru browser tabs in Chrome & Firefox; can be overridden in Chrome in fullscreen only
					description: localize("Zooms the picture to 100%."),
					enabled: () => magnification !== 1,
					action: () => {
						set_magnification(1);
					},
				},
				{
					label: localize("&Large Size"),
					// Ctrl+PageDown cycles thru browser tabs in Chrome & Firefox; can be overridden in Chrome in fullscreen only
					description: localize("Zooms the picture to 400%."),
					enabled: () => magnification !== 4,
					action: () => {
						set_magnification(4);
					},
				},
				{
					label: localize("Zoom To &Window"),
					description: localize("Zooms the picture to fit within the view."),
					action: () => {
						const rect = $canvas_area[0].getBoundingClientRect();
						const margin = 30; // leave a margin so scrollbars won't appear
						let mag = Math.min(
							(rect.width - margin) / main_canvas.width,
							(rect.height - margin) / main_canvas.height,
						);
						// round to an integer percent for the View > Zoom > Custom... dialog, which shows non-integers as invalid
						mag = Math.floor(100 * mag) / 100;
						set_magnification(mag);
					},
				},
				{
					label: `${localize("C&ustom")}...`,
					description: localize("Zooms the picture."),
					action: () => { show_custom_zoom_window(); },
				},
				MENU_DIVIDER,
				{
					label: localize("Show &Grid"),
					...shortcut("Ctrl+G"),
					enabled: () => magnification >= 4,
					checkbox: {
						toggle: () => { toggle_grid(); },
						check: () => show_grid,
					},
					description: localize("Shows or hides the grid."),
				},
			],
		},
		{
			label: localize("&View Bitmap"),
			...shortcut("Ctrl+F"),
			action: () => { view_bitmap(); },
			description: localize("Displays the entire picture."),
		},
	],
	[localize("&Image")]: [
		// @TODO: speech recognition: terms that apply to selection
		{
			label: localize("&Flip/Rotate"),
			...shortcut("Ctrl+Alt+R"), // Ctrl+R reloads the browser tab (or Electron window in dev mode via electron-debug)
			action: () => { image_flip_and_rotate(); },
			description: localize("Flips or rotates the picture or a selection."),
		},
		{
			label: localize("&Stretch/Skew"),
			...shortcut("Ctrl+Alt+W"), // Ctrl+W closes the browser tab
			action: () => { image_stretch_and_skew(); },
			description: localize("Stretches or skews the picture or a selection."),
		},
		{
			label: localize("&Invert Colors"),
			...shortcut("Ctrl+I"),
			action: () => { image_invert_colors(); },
			description: localize("Inverts the colors of the picture or a selection."),
		},
		{
			label: `${localize("&Attributes")}...`,
			...shortcut("Ctrl+E"),
			action: () => { image_attributes(); },
			description: localize("Changes the attributes of the picture."),
		},
		{
			label: localize("&Clear Image"),
			...shortcut(!looksLikeChrome ? "Ctrl+Shift+N" : ""), // Ctrl+Shift+N opens incognito window in chrome
			// (mspaint says "Ctrl+Shft+N")
			action: () => { if (!selection) { clear(); } },
			enabled: () => !selection,
			description: localize("Clears the picture."),
			// action: ()=> {
			// 	if (selection) {
			// 		delete_selection();
			// 	} else {
			// 		clear();
			// 	}
			// },
			// mspaint says localize("Clears the picture or selection."), but grays out the option when there's a selection
		},
		{
			label: localize("&Draw Opaque"),
			checkbox: {
				toggle: () => {
					tool_transparent_mode = !tool_transparent_mode;
					$G.trigger("option-changed");
				},
				check: () => !tool_transparent_mode,
			},
			description: localize("Makes the current selection either opaque or transparent."),
		},
	],
	[localize("&Colors")]: [
		{
			label: `${localize("&Edit Colors")}...`,
			action: () => {
				show_edit_colors_window();
			},
			description: localize("Creates a new color."),
		},
		{
			label: localize("&Get Colors"),
			action: async () => {
				const { file } = await systemHooks.showOpenFileDialog({ formats: palette_formats });
				AnyPalette.loadPalette(file, (error, new_palette) => {
					if (error) {
						show_file_format_errors({ as_palette_error: error });
					} else {
						palette = new_palette.map((color) => color.toString());
						$colorbox.rebuild_palette();
						window.console?.log(`Loaded palette: ${palette.map(() => "%c█").join("")}`, ...palette.map((color) => `color: ${color};`));
					}
				});
			},
			description: localize("Uses a previously saved palette of colors."),
		},
		{
			label: localize("&Save Colors"),
			action: () => {
				const ap = new AnyPalette.Palette();
				ap.name = "JS Paint Saved Colors";
				ap.numberOfColumns = 16; // 14?
				for (const color of palette) {
					const [r, g, b] = get_rgba_from_color(color);
					ap.push(new AnyPalette.Color({
						red: r / 255,
						green: g / 255,
						blue: b / 255,
					}));
				}
				systemHooks.showSaveFileDialog({
					dialogTitle: localize("Save Colors"),
					defaultFileName: localize("untitled.pal"),
					formats: palette_formats,
					getBlob: (format_id) => {
						const file_content = AnyPalette.writePalette(ap, AnyPalette.formats[format_id]);
						const blob = new Blob([file_content], { type: "text/plain" });
						return new Promise((resolve) => {
							sanity_check_blob(blob, () => {
								resolve(blob);
							});
						});
					},
				});
			},
			description: localize("Saves the current palette of colors to a file."),
		},
	],
	[localize("&Help")]: [
		{
			label: localize("&About Paint"),
			action: () => { show_about_paint(); },
			description: localize("Displays information about this application."),
			//description: localize("Displays program information, version number, and copyright."),
		},
	],
};

export { menus };

/**
 * A menu item's shortcut, as shown in the menu (Paint's own key handling runs it).
 * @param {string} shortcutLabel
 * @returns {{shortcutLabel?: string}}
 */
function shortcut(shortcutLabel) {
	return shortcutLabel ? { shortcutLabel } : {};
}
