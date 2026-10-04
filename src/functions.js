// @ts-check
// eslint-disable-next-line no-unused-vars
/* global canvas_bounding_client_rect:writable, current_history_node:writable, file_format:writable, file_name:writable, helper_layer:writable, history_node_to_cancel_to:writable, magnification:writable, monochrome:writable, palette:writable, pointer:writable, return_to_magnification:writable, return_to_tools:writable, root_history_node:writable, saved:writable, selected_colors:writable, selected_tool:writable, selected_tools:writable, selection:writable, show_grid:writable, system_file_handle:writable, textbox:writable, tool_transparent_mode:writable, transparency:writable, undos:writable */
/* global $canvas, $canvas_area, $colorbox, $status_text, $toolbox, AccessKeys, decodeBMP, default_canvas_height, default_canvas_width, default_magnification, default_tool, enable_palette_loading_from_indexed_images, encodeBMP, localize, main_canvas, main_ctx, monochrome_palette, my_canvas_height, my_canvas_width, pointer_active, pointers, polychrome_palette, redos, systemHooks, text_tool_font, update_fill_and_stroke_colors_and_lineWidth, UPNG, UTIF */

import { OnCanvasHelperLayer } from "./OnCanvasHelperLayer.js";
import { OnCanvasSelection } from "./OnCanvasSelection.js";
import { OnCanvasTextBox } from "./OnCanvasTextBox.js";
// import { localize } from "./app-localization.js";
import { default_palette } from "./color-data.js";
import { image_formats } from "./file-format-data.js";
import { $G, TAU, from_canvas_coords, get_rgba_from_color, make_canvas, to_canvas_coords } from "./helpers.js";
import { apply_image_transformation, draw_grid, flip_horizontal, flip_vertical, invert_monochrome, invert_rgb, rotate, stretch_and_skew, threshold_black_and_white } from "./image-manipulation.js";
import { showMessageBox } from "./msgbox.js";
import { localStore } from "./storage.js";
import { TOOL_FREE_FORM_SELECT, TOOL_SELECT, TOOL_TEXT, tools } from "./tools.js";

function update_magnified_canvas_size() {
	$canvas.css("width", main_canvas.width * magnification);
	$canvas.css("height", main_canvas.height * magnification);

	update_canvas_rect();
}

function update_canvas_rect() {
	window.canvas_bounding_client_rect = main_canvas.getBoundingClientRect();

	update_helper_layer();
}

let helper_layer_update_queued = false;
/**
 * for updating the brush preview when the mouse stays in the same place,
 * but its coordinates in the document change due to scrolling or browser zooming (handled with scroll and resize events)
 * @type {{ clientX: number, clientY: number, devicePixelRatio: number }}
 */
let info_for_updating_pointer;
/** @param {{ clientX: number, clientY: number }} [e] */
function update_helper_layer(e) {
	// e should be passed for pointer events, but not scroll or resize events
	// e may be a synthetic event without clientX/Y, so ignore that (using isFinite)
	// e may also be a timestamp from requestAnimationFrame callback; ignore that
	if (e && isFinite(e.clientX)) {
		info_for_updating_pointer = { clientX: e.clientX, clientY: e.clientY, devicePixelRatio };
	}
	if (helper_layer_update_queued) {
		// window.console?.log("update_helper_layer - nah, already queued");
		return;
	} else {
		// window.console?.log("update_helper_layer");
	}
	helper_layer_update_queued = true;
	requestAnimationFrame(() => {
		helper_layer_update_queued = false;
		update_helper_layer_immediately();
	});
}
function update_helper_layer_immediately() {
	// window.console?.log("Update helper layer NOW");
	if (info_for_updating_pointer) {
		const rescale = info_for_updating_pointer.devicePixelRatio / devicePixelRatio;
		info_for_updating_pointer.clientX *= rescale;
		info_for_updating_pointer.clientY *= rescale;
		info_for_updating_pointer.devicePixelRatio = devicePixelRatio;
		pointer = to_canvas_coords(info_for_updating_pointer);
	}

	const scale = magnification * window.devicePixelRatio;

	if (!helper_layer) {
		helper_layer = new OnCanvasHelperLayer(0, 0, main_canvas.width, main_canvas.height, false, scale);
	}

	const margin = 15;
	const viewport_x = Math.floor(Math.max($canvas_area.scrollLeft() / magnification - margin, 0));
	// Nevermind, canvas, isn't aligned to the right in RTL layout!
	// const viewport_x =
	// 	get_direction() === "rtl" ?
	// 		// Note: $canvas_area.scrollLeft() can return negative numbers for RTL layout
	// 		Math.floor(Math.max(($canvas_area.scrollLeft() - $canvas_area.innerWidth()) / magnification + canvas.width - margin, 0)) :
	// 		Math.floor(Math.max($canvas_area.scrollLeft() / magnification - margin, 0));
	const viewport_y = Math.floor(Math.max($canvas_area.scrollTop() / magnification - margin, 0));
	const viewport_x2 = Math.floor(Math.min(viewport_x + $canvas_area.width() / magnification + margin * 2, main_canvas.width));
	const viewport_y2 = Math.floor(Math.min(viewport_y + $canvas_area.height() / magnification + margin * 2, main_canvas.height));
	const viewport_width = viewport_x2 - viewport_x;
	const viewport_height = viewport_y2 - viewport_y;
	const resolution_width = viewport_width * scale;
	const resolution_height = viewport_height * scale;
	if (
		helper_layer.canvas.width !== resolution_width ||
		helper_layer.canvas.height !== resolution_height
	) {
		helper_layer.canvas.width = resolution_width;
		helper_layer.canvas.height = resolution_height;
		helper_layer.canvas.ctx.disable_image_smoothing();
		helper_layer.width = viewport_width;
		helper_layer.height = viewport_height;
	}
	helper_layer.x = viewport_x;
	helper_layer.y = viewport_y;
	helper_layer.position();

	render_canvas_view(helper_layer.canvas, scale, viewport_x, viewport_y);
}

/**
 * @param {PixelCanvas} hcanvas
 * @param {number} scale
 * @param {number} viewport_x
 * @param {number} viewport_y
 */
function render_canvas_view(hcanvas, scale, viewport_x, viewport_y) {
	update_fill_and_stroke_colors_and_lineWidth(selected_tool);

	const grid_visible = show_grid && magnification >= 4 && (window.devicePixelRatio * magnification) >= 4;

	const hctx = hcanvas.ctx;

	hctx.clearRect(0, 0, hcanvas.width, hcanvas.height);

	var tools_to_preview = [...selected_tools];

	// the select box previews draw the document canvas onto the preview canvas
	// so they have something to invert within the preview canvas
	// but this means they block out anything earlier
	// NOTE: sort Select after Free-Form Select,
	// Brush after Eraser, as they are from the toolbar ordering
	tools_to_preview.sort((a, b) => {
		if (a.selectBox && !b.selectBox) {
			return -1;
		}
		if (!a.selectBox && b.selectBox) {
			return 1;
		}
		return 0;
	});
	// two select box previews would just invert and cancel each other out
	// so only render one if there's one or more
	var select_box_index = tools_to_preview.findIndex((tool) => tool.selectBox);
	if (select_box_index >= 0) {
		tools_to_preview = tools_to_preview.filter((tool, index) => !tool.selectBox || index == select_box_index);
	}

	tools_to_preview.forEach((tool) => {
		if (tool.drawPreviewUnderGrid && pointer && pointers.length < 2) {
			hctx.save();
			tool.drawPreviewUnderGrid(hctx, pointer.x, pointer.y, grid_visible, scale, -viewport_x, -viewport_y);
			hctx.restore();
		}
	});

	if (selection) {
		hctx.save();

		hctx.scale(scale, scale);
		hctx.translate(-viewport_x, -viewport_y);

		hctx.drawImage(selection.canvas, selection.x, selection.y);

		hctx.restore();
	}

	if (textbox) {
		hctx.save();

		hctx.scale(scale, scale);
		hctx.translate(-viewport_x, -viewport_y);

		hctx.drawImage(textbox.canvas, textbox.x, textbox.y);

		hctx.restore();
	}

	if (grid_visible) {
		draw_grid(hctx, scale);
	}

	tools_to_preview.forEach((tool) => {
		if (tool.drawPreviewAboveGrid && pointer && pointers.length < 2) {
			hctx.save();
			tool.drawPreviewAboveGrid(hctx, pointer.x, pointer.y, grid_visible, scale, -viewport_x, -viewport_y);
			hctx.restore();
		}
	});
}
function update_disable_aa() {
	const dots_per_canvas_px = window.devicePixelRatio * magnification;
	const round = Math.floor(dots_per_canvas_px) === dots_per_canvas_px;
	$canvas_area.toggleClass("disable-aa-for-things-at-main-canvas-scale", dots_per_canvas_px >= 3 || round);
}

/**
 * @param {number} new_scale
 * @param {{x: number, y: number}} [anchor_point] - uses canvas coordinates; default is the top-left of the $canvas_area viewport
 */
function set_magnification(new_scale, anchor_point) {
	// How this works is, you imagine "what if it was zoomed, where would the anchor point be?"
	// Then to make it end up where it started, you simply shift the viewport by the difference.
	// And actually you don't have to "imagine" zooming, you can just do the zoom.

	anchor_point = anchor_point ?? {
		x: $canvas_area.scrollLeft() / magnification,
		y: $canvas_area.scrollTop() / magnification,
	};
	const anchor_on_page = from_canvas_coords(anchor_point);

	magnification = new_scale;
	if (new_scale !== 1) {
		return_to_magnification = new_scale;
	}
	update_magnified_canvas_size(); // also updates canvas_bounding_client_rect used by from_canvas_coords()

	const anchor_after_zoom = from_canvas_coords(anchor_point);
	// Note: scrollBy() not scrollTo()
	$canvas_area[0].scrollBy({
		left: anchor_after_zoom.clientX - anchor_on_page.clientX,
		top: anchor_after_zoom.clientY - anchor_on_page.clientY,
		behavior: "instant",
	});

	$G.triggerHandler("resize"); // updates handles & grid
	$G.trigger("option-changed"); // updates options area
	$G.trigger("magnification-changed"); // updates custom zoom window
}

function toggle_grid() {
	show_grid = !show_grid;
	// $G.trigger("option-changed");
	update_helper_layer();
}

function reset_selected_colors() {
	selected_colors = {
		foreground: "#000000",
		background: "#ffffff",
		ternary: "",
	};
	$G.trigger("option-changed");
}

function reset_file() {
	system_file_handle = null;
	file_name = localize("untitled");
	file_format = "image/png";
	saved = true;
	update_title();
}

function reset_canvas_and_history() {
	undos.length = 0;
	redos.length = 0;
	current_history_node = root_history_node = make_history_node({
		name: localize("New"),
	});
	history_node_to_cancel_to = null;

	main_canvas.width = Math.max(1, my_canvas_width);
	main_canvas.height = Math.max(1, my_canvas_height);
	main_ctx.disable_image_smoothing();
	main_ctx.fillStyle = selected_colors.background;
	main_ctx.fillRect(0, 0, main_canvas.width, main_canvas.height);

	current_history_node.image_data = main_ctx.getImageData(0, 0, main_canvas.width, main_canvas.height);

	$canvas_area.trigger("resize");
}

// TODO: fix inconsistent use of ancestry metaphor (parent vs futures); could use the term "basis" for the parent, or "children" for the futures
/**
 * @param {object} options
 * @param {HistoryNode | null=} options.parent - the state before this state (its basis), or null if this is the first state
 * @param {HistoryNode[]=} options.futures - the states branching off from this state (its children)
 * @param {number=} options.timestamp - when this state was created
 * @param {boolean=} options.soft - indicates that undo should skip this state
 * @param {ImageData | null=} options.image_data - the image data for the canvas (TODO: region updates)
 * @param {ImageData | null=} options.selection_image_data - the image data for the selection, if any
 * @param {number=} options.selection_x - the x position of the selection, if any
 * @param {number=} options.selection_y - the y position of the selection, if any
 * @param {string=} options.textbox_text - the text in the textbox, if any
 * @param {number=} options.textbox_x - the x position of the textbox, if any
 * @param {number=} options.textbox_y - the y position of the textbox, if any
 * @param {number=} options.textbox_width - the width of the textbox, if any
 * @param {number=} options.textbox_height - the height of the textbox, if any
 * @param {TextToolFontOptions | null=} options.text_tool_font - the font of the Text tool (important to restore a textbox-containing state, but persists without a textbox)
 * @param {boolean=} options.tool_transparent_mode - whether transparent mode is on for Select/Free-Form Select/Text tools; otherwise box is opaque
 * @param {string | CanvasPattern=} options.foreground_color - selected foreground color (left click)
 * @param {string | CanvasPattern=} options.background_color - selected background color (right click)
 * @param {string | CanvasPattern=} options.ternary_color - selected ternary color (ctrl+click)
 * @param {string=} options.name - the name of the operation, e.g. localize("Resize Canvas")
 * @returns {HistoryNode}
 */
function make_history_node({
	parent = null, // the state before this state (its basis), or null if this is the first state
	futures = [], // the states branching off from this state (its children)
	timestamp = Date.now(), // when this state was created
	soft = false, // indicates that undo should skip this state
	image_data = null, // the image data for the canvas (TODO: region updates)
	selection_image_data = null, // the image data for the selection, if any
	selection_x, // the x position of the selection, if any
	selection_y, // the y position of the selection, if any
	textbox_text, // the text in the textbox, if any
	textbox_x, // the x position of the textbox, if any
	textbox_y, // the y position of the textbox, if any
	textbox_width, // the width of the textbox, if any
	textbox_height, // the height of the textbox, if any
	text_tool_font = null, // the font of the Text tool (important to restore a textbox-containing state, but persists without a textbox)
	tool_transparent_mode = false, // whether transparent mode is on for Select/Free-Form Select/Text tools; otherwise box is opaque
	foreground_color, // selected foreground color (left click)
	background_color, // selected background color (right click)
	ternary_color, // selected ternary color (ctrl+click)
	name, // the name of the operation, e.g. localize("Resize Canvas")
}) {
	return {
		parent,
		futures,
		timestamp,
		soft,
		image_data,
		selection_image_data,
		selection_x,
		selection_y,
		textbox_text,
		textbox_x,
		textbox_y,
		textbox_width,
		textbox_height,
		text_tool_font,
		tool_transparent_mode,
		foreground_color,
		background_color,
		ternary_color,
		name,
	};
}

function update_title() {
	document.title = `${file_name} - ${localize("Paint")}`;

	if (window.setRepresentedFilename) {
		window.setRepresentedFilename(system_file_handle ?? "");
	}
	if (window.setDocumentEdited) {
		window.setDocumentEdited(!saved);
	}
}

/**
 * Parse text/uri-list format
 * @param {string} text
 * @returns {string[]} URLs
 */
function get_uris(text) {
	// get lines, discarding comments
	const lines = text.split(/[\n\r]+/).filter((line) => line[0] !== "#" && line);
	// discard text with too many lines (likely pasted HTML or something) - may want to revisit this
	if (lines.length > 15) {
		return [];
	}
	// parse URLs, discarding anything that parses as a relative URL
	const uris = [];
	for (let i = 0; i < lines.length; i++) {
		// Relative URLs will throw when no base URL is passed to the URL constructor.
		try {
			const url = new URL(lines[i]);
			uris.push(url.href);
		} catch (_error) { /* ignore */ }
	}
	return uris;
}
/**
 * Load an image file from a URL by any means necessary.
 * @param {string} uri
 * @returns {Promise<ImageInfo>}
 * @throws {Error & { code?: string }}
 */
async function load_image_from_uri(uri) {

	// Cases to consider:
	// - data URI
	// - blob URI
	//   - blob URI from another domain
	// - file URI
	// - http URI
	// - https URI
	// - unsupported protocol, e.g. "ftp://example.com/image.png"
	// - invalid URI
	//   - no protocol specified, e.g. "example.com/image.png"
	//     --> We can fix these up!
	//   - The user may be just trying to paste text, not an image.
	// - non-CORS-enabled URI
	//   --> Use a CORS proxy! :)
	//   - In electron, using a CORS proxy 1. is silly, 2. maybe isn't working.
	//     --> Either proxy requests to the main process,
	//         or configure headers in the main process to make requests work.
	//         Probably the latter. @TODO
	//         https://stackoverflow.com/questions/51254618/how-do-you-handle-cors-in-an-electron-app
	// - invalid image / unsupported image format
	// - image is no longer available on the live web
	//   --> try loading from WayBack Machine :)
	//   - often swathes of URLs are redirected to a new site, and do not give a 404.
	//     --> make sure the flow of fallbacks accounts for this, and doesn't just see it as an unsupported file format.
	// - localhost URI, e.g. "http://127.0.0.1/" or "http://localhost/"
	//   --> Don't try to proxy these, as it will just fail.
	//   - Some domain extensions are reserved, e.g. .localdomain (how official is this?)
	//   - There can also be arbitrary hostnames mapped to local servers, which we can't test for
	// - already a proxy URI, e.g. "https://cors.bridged.cc/https://example.com/image.png"
	// - file already downloaded
	//   --> maybe should cache downloads? maybe HTTP caching is good enough? maybe uncommon enough that it doesn't matter.
	// - Pasting (Edit > Paste or Ctrl+V) vs Opening (drag & drop, File > Open, Ctrl+O, or File > Load From URL)
	//   --> make wording generic or specific to the context

	const is_blob_uri = uri.match(/^blob:/i);
	const is_download = !uri.match(/^(blob|data|file):/i);
	const is_localhost = uri.match(/^(http|https):\/\/((127\.0\.0\.1|localhost)|.*(\.(local|localdomain|domain|lan|home|host|corp|invalid)))\b/i);

	if (is_blob_uri && uri.indexOf(`blob:${location.origin}`) === -1) {
		const error = new Error("can't load blob: URI from another domain");
		// @ts-ignore
		error.code = "cross-origin-blob-uri";
		throw error;
	}

	const uris_to_try = (is_download && !is_localhost) ? [
		uri,
		// work around CORS headers not sent by whatever server
		`https://cors.bridged.cc/${uri}`,
		`https://jspaint-cors-proxy.herokuapp.com/${uri}`,
		// if the image isn't available on the live web, see if it's archived
		`https://web.archive.org/${uri}`,
	] : [uri];
	const fails = [];

	for (let index_to_try = 0; index_to_try < uris_to_try.length; index_to_try += 1) {
		const uri_to_try = uris_to_try[index_to_try];
		try {
			if (is_download) {
				$status_text.text("Downloading picture...");
			}

			const show_progress = ({ loaded, total }) => {
				if (is_download) {
					$status_text.text(`Downloading picture... (${Math.round(loaded / total * 100)}%)`);
				}
			};

			if (is_download) {
				console.log(`Try loading image from URI (${index_to_try + 1}/${uris_to_try.length}): "${uri_to_try}"`);
			}

			const original_response = await fetch(uri_to_try);
			let response_to_read = original_response;
			if (!original_response.ok) {
				fails.push({ status: original_response.status, statusText: original_response.statusText, url: uri_to_try });
				continue;
			}
			if (!original_response.body) {
				if (is_download) {
					console.log("ReadableStream not yet supported in this browser. Progress won't be shown for image requests.");
				}
			} else {
				// to access headers, server must send CORS header "Access-Control-Expose-Headers: content-encoding, content-length x-file-size"
				// server must send custom x-file-size header if gzip or other content-encoding is used
				const contentEncoding = original_response.headers.get("content-encoding");
				const contentLength = original_response.headers.get(contentEncoding ? "x-file-size" : "content-length");
				if (contentLength === null) {
					if (is_download) {
						console.log("Response size header unavailable. Progress won't be shown for this image request.");
					}
				} else {
					const total = parseInt(contentLength, 10);
					let loaded = 0;
					response_to_read = new Response(
						new ReadableStream({
							start(controller) {
								const reader = original_response.body.getReader();

								read();
								function read() {
									reader.read().then(({ done, value }) => {
										if (done) {
											controller.close();
											return;
										}
										loaded += value.byteLength;
										show_progress({ loaded, total });
										controller.enqueue(value);
										read();
									}).catch((error) => {
										console.error(error);
										controller.error(error);
									});
								}
							},
						})
					);
				}
			}

			const blob = await response_to_read.blob();
			if (is_download) {
				console.log("Download complete.");
				$status_text.text("Download complete.");
			}
			// @TODO: use headers to detect HTML, since a doctype is not guaranteed
			// @TODO: fall back to WayBack Machine still for decode errors,
			// since a website might start redirecting swathes of URLs regardless of what they originally pointed to,
			// at which point they would likely point to a web page instead of an image.
			// (But still show an error about it not being an image, if WayBack also fails.)
			const info = await new Promise((resolve, reject) => {
				read_image_file(blob, (error, info) => {
					if (error) {
						reject(error);
					} else {
						resolve(info);
					}
				});
			});
			return info;
		} catch (error) {
			fails.push({ url: uri_to_try, error });
		}
	}
	if (is_download) {
		$status_text.text("Failed to download picture.");
	}
	const error = new Error(`failed to fetch image from any of ${uris_to_try.length} URI(s):\n  ${fails.map((fail) =>
		(fail.statusText ? `${fail.status} ${fail.statusText} ` : "") + fail.url + (fail.error ? `\n    ${fail.error}` : "")
	).join("\n  ")}`);
	// @ts-ignore
	error.code = "access-failure";
	// @ts-ignore
	error.fails = fails;
	throw error;
}

/**
 * @param {ImageInfo} info
 * @param {() => void} [callback]
 * @param {() => void} [canceled]
 * @param {boolean} [into_existing_session]
 * @param {boolean} [from_session_load]
 */
function open_from_image_info(info, callback, canceled, into_existing_session, from_session_load) {
	are_you_sure(({ canvas_modified_while_loading } = {}) => {
		deselect();
		cancel();

		reset_file();
		reset_selected_colors();
		reset_canvas_and_history(); // (with newly reset colors)
		set_magnification(default_magnification);

		main_ctx.copy(info.image || info.image_data);
		apply_file_format_and_palette_info(info);
		transparency = has_any_transparency(main_ctx);
		$canvas_area.trigger("resize");

		current_history_node.name = localize("Open");
		current_history_node.image_data = main_ctx.getImageData(0, 0, main_canvas.width, main_canvas.height);

		if (info.source_blob instanceof File) {
			file_name = info.source_blob.name;
			// file.path is available in Electron (see https://www.electronjs.org/docs/api/file-object#file-object)
			// @ts-ignore
			system_file_handle = info.source_blob.path;
		}
		if (info.source_file_handle) {
			system_file_handle = info.source_file_handle;
		}
		saved = true;
		update_title();

		callback?.();
	}, canceled, from_session_load);
}

// Note: This function is part of the API.
/**
 * @param {Blob} file
 * @param {UserFileHandle} source_file_handle
 */
function open_from_file(file, source_file_handle) {
	// The browser isn't very smart about MIME types.
	// It seems to look at the file extension, but not the actual file contents.
	// This is particularly problematic for files with no extension, where file.type gives an empty string.
	// And the File Access API currently doesn't let us automatically append a file extension,
	// so the user is likely to end up with files with no extension.
	// It's better to look at the file content to determine file type.
	// We do this for image files in read_image_file, and palette files in AnyPalette.js.

	// Try loading as an image file first, then as a palette file, but show a combined error message if both fail.
	read_image_file(file, (as_image_error, image_info) => {
		if (as_image_error) {
			AnyPalette.loadPalette(file, (as_palette_error, new_palette) => {
				if (as_palette_error) {
					show_file_format_errors({ as_image_error, as_palette_error });
					return;
				}
				palette = new_palette.map((color) => color.toString());
				$colorbox.rebuild_palette();
				window.console?.log(`Loaded palette: ${palette.map(() => "%c█").join("")}`, ...palette.map((color) => `color: ${color};`));
			});
			return;
		}
		image_info.source_file_handle = source_file_handle;
		open_from_image_info(image_info);
	});
}

/**
 * @param {ImageInfo} info
 */
function apply_file_format_and_palette_info(info) {
	file_format = info.file_format;

	if (!enable_palette_loading_from_indexed_images) {
		return;
	}

	if (info.palette) {
		window.console?.log(`Loaded palette from image file: ${info.palette.map(() => "%c█").join("")}`, ...info.palette.map((color) => `color: ${color};`));
		palette = info.palette;
		selected_colors.foreground = palette[0];
		selected_colors.background = palette.length === 14 * 2 ? palette[14] : palette[1]; // first in second row for default sized palette, else second color (debatable behavior; should it find a dark and a light color?)
		$G.trigger("option-changed");
	} else if (monochrome && !info.monochrome) {
		palette = default_palette;
		reset_selected_colors();
	}
	$colorbox.rebuild_palette();

	monochrome = info.monochrome;
}

function file_new() {
	are_you_sure(() => {
		deselect();
		cancel();

		reset_file();
		reset_selected_colors();
		reset_canvas_and_history(); // (with newly reset colors)
		set_magnification(default_magnification);

	});
}

async function file_open() {
	const { file, fileHandle } = await systemHooks.showOpenFileDialog({ formats: image_formats });
	open_from_file(file, fileHandle);
}

// Native FS API / File Access API allows you to overwrite files, but people are not used to it.
// So we ask them to confirm it the first time.
let acknowledged_overwrite_capability = false;
const confirmed_overwrite_key = "jspaint confirmed overwrite capable";
try {
	acknowledged_overwrite_capability = localStorage[confirmed_overwrite_key] === "true";
} catch (_error) {
	// no localStorage
	// In the year 2033, people will be more used to it, right?
	// This will be known as the "Y2T bug"
	acknowledged_overwrite_capability = Date.now() >= 2000000000000;
}

function file_save(maybe_saved_callback = () => { }, update_from_saved = true) {
	deselect();
	// store and use file handle at this point in time, to avoid race conditions
	const save_file_handle = system_file_handle;
	if (!save_file_handle || file_name.match(/\.svg$/i)) {
		return file_save_as(maybe_saved_callback, update_from_saved);
	}
	write_image_file(main_canvas, file_format, async (blob) => {
		// An error may be shown by `systemHooks.writeBlobToHandle`,
		// or it may be unknown whether the save will succeed,
		// so for now: true means definite success, false means failure or cancelation, and undefined means it's unknown.
		const success = await systemHooks.writeBlobToHandle(save_file_handle, blob);
		// When using a file download, where it's unknown whether the save will succeed,
		// we don't want to mark the file as saved, as it would prevent the user from retrying the save.
		// So only mark the file as saved if it's definite.
		if (success === true) {
			saved = true;
			update_title();
		}
		// However, we can still apply format-specific color reduction to the canvas,
		// and call the "maybe saved" callback, which, as the name implies, is intended to handle the uncertainty.
		if (success !== false) {
			if (update_from_saved) {
				update_from_saved_file(blob);
			}
			maybe_saved_callback();
		}
	});
}

function file_save_as(maybe_saved_callback = () => { }, update_from_saved = true) {
	deselect();
	systemHooks.showSaveFileDialog({
		dialogTitle: localize("Save As"),
		formats: image_formats,
		defaultFileName: file_name,
		defaultPath: typeof system_file_handle === "string" ? system_file_handle : null,
		defaultFileFormatID: file_format,
		getBlob: (new_file_type) => {
			return new Promise((resolve) => {
				write_image_file(main_canvas, new_file_type, (blob) => {
					resolve(blob);
				});
			});
		},
		savedCallbackUnreliable: ({ newFileName, newFileFormatID, newFileHandle, newBlob }) => {
			saved = true;
			system_file_handle = newFileHandle;
			file_name = newFileName;
			file_format = newFileFormatID;
			update_title();
			maybe_saved_callback();
			if (update_from_saved) {
				update_from_saved_file(newBlob);
			}
		},
	});
}

function file_print() {
	print();
}

/**
 * Prompts the user to save changes to the document.
 * @param {(info?: { canvas_modified_while_loading?: boolean }) => void} action
 * @param {() => void} [canceled]
 * @param {boolean} [from_session_load]
 */
function are_you_sure(action, canceled, from_session_load) {
	if (saved) {
		action();
	} else if (from_session_load) {
		// @FIXME: this dialog is confusingly worded in the best case.
		// It's intended for when the user edits the document while the initial document is loading,
		// which is hard to do, at least for local sessions on my fast new computer.
		// However it's also shown inappropriately if you edit the document and then either:
		// - type a #load: URL into the address bar such as
		//   http://127.0.0.1:1999/#load:https://i.imgur.com/M5zcPuk.jpeg
		// - click an Open link in the Manage Storage dialog in the Electron app
		showMessageBox({
			message: localize("You've modified the document while an existing document was loading.\nSave the new document?", file_name),
			buttons: [
				{
					// label: localize("Save"),
					label: localize("Yes"),
					value: "save",
					default: true,
				},
				{
					// label: "Discard",
					label: localize("No"),
					value: "discard",
				},
			],
			// @TODO: not closable with Escape or close button
		}).then((result) => {
			if (result === "save") {
				file_save(() => {
					action();
				}, false);
			} else if (result === "discard") {
				action({ canvas_modified_while_loading: true });
			} else {
				// should not ideally happen
				// but prefer to preserve the previous document,
				// as the user has only (probably) as small window to make changes while loading,
				// whereas there could be any amount of work put into the document being loaded.
				// @TODO: could show dialog again, but making it un-cancelable would be better.
				action();
			}
		});
	} else {
		showMessageBox({
			message: localize("Save changes to %1?", file_name),
			buttons: [
				{
					// label: localize("Save"),
					label: localize("Yes"),
					value: "save",
					default: true,
				},
				{
					// label: "Discard",
					label: localize("No"),
					value: "discard",
				},
				{
					label: localize("Cancel"),
					value: "cancel",
				},
			],
		}).then((result) => {
			if (result === "save") {
				file_save(() => {
					action();
				}, false);
			} else if (result === "discard") {
				action();
			} else {
				canceled?.();
			}
		});
	}
}

function please_enter_a_number() {
	showMessageBox({
		// title: "Invalid Value",
		message: localize("Please enter a number."),
	});
}

// Note: This function is part of the API.
/**
 * @param {string} message
 * @param {Error | string} [error]
 */
function show_error_message(message, error) {
	let details = "";
	if (error) {
		// Chrome includes the error message in the error.stack string, whereas Firefox doesn't.
		// Also note that there can be Exception objects that don't have a message (empty string) but a name,
		// for instance Exception { message: "", name: "NS_ERROR_FAILURE", ... } for out of memory when resizing the canvas too large in Firefox.
		const e = /** @type {Error} */(error);
		details = e.stack;
		if (!details) {
			details = error.toString();
			if (details === "[object Object]") {
				try {
					details = JSON.stringify(error, null, 2);
				} catch (stringify_error) {
					details = "Error details could not be stringified: " + stringify_error;
				}
			}
		} else if (e.message && details.indexOf(e.message) === -1) {
			details = `${error.toString()}\n\n${details}`;
		} else if (e.name && details.indexOf(e.name) === -1) {
			details = `${e.name}\n\n${details}`;
		}
		window.console?.error?.(message, error);
	} else {
		window.console?.error?.(message);
	}
	showMessageBox({
		iconID: "error",
		message: details ? `${message}\n\nDetails:\n${details}` : message,
	});
}

/** @param {Error & {code: string, fails?: {status: number, statusText: string, url: string}[]}} error */
function show_resource_load_error_message(error) {
	let lines;
	if (error.code === "cross-origin-blob-uri") {
		lines = [
			"Can't load image from address starting with \"blob:\".",
			"Try \"Copy image\" instead of \"Copy image address\".",
		];
	} else if (error.code === "html-not-image") {
		lines = [
			"Address points to a web page, not an image file.",
			"Try copying and pasting an image instead of a URL.",
		];
	} else if (error.code === "decoding-failure") {
		lines = [
			"Address doesn't point to an image file of a supported format.",
			"Try copying and pasting an image instead of a URL.",
		];
	} else if (error.code === "access-failure" && !navigator.onLine) {
		lines = [
			"Failed to download image.",
			"You're offline. Connect to the internet and try again.",
			"Or copy and paste an image instead of a URL, if possible.",
		];
	} else if (error.code === "access-failure") {
		lines = [
			"Failed to download image.",
			"Try copying and pasting an image instead of a URL.",
			...(error.fails ?? []).map(({ status, statusText, url }) => `${status || ""} ${statusText || "Failed"} ${url}`),
		];
	} else {
		lines = ["Failed to load image from URL."];
	}
	showMessageBox({ message: lines.join("\n") });
}
/**
 * @typedef {object} PaletteErrorGroup
 * @property {string} message
 * @property {PaletteErrorObject[]} errors
 *
 * @typedef {object} PaletteErrorObject
 * @property {Error} error
 * @property {{name: string}} __PATCHED_LIB_TO_ADD_THIS__format
 *
 * @param {object} options
 * @param {Error=} options.as_image_error
 * @param {Error|PaletteErrorGroup=} options.as_palette_error
 */
/**
 * Says a file could not be opened: what it is not (a picture, or a palette), without
 * the list of every format tried.
 * @param {{ as_image_error?: unknown, as_palette_error?: unknown }} errors
 */
function show_file_format_errors({ as_image_error }) {
	showMessageBox({
		message: `${localize("Paint cannot open this file.")}\n\n${as_image_error ?
			localize("This is not a valid bitmap file, or its format is not currently supported.") :
			localize("Unexpected file format.")}`,
	});
}

function show_about_paint() {
	window.cassiel.dialog.message({
		title: localize("About Paint"),
		icon: "info",
		text: "Paint 0.2\n\nBased on JS Paint by Isaiah Odhner.",
		buttons: [{ label: "OK", value: true, default: true, cancel: true }],
	});
}

// @TODO: DRY between these functions and open_from_* functions further?

/**
 * @param {Blob} blob
 */
function paste_image_from_file(blob) {
	read_image_file(blob, (error, info) => {
		if (error) {
			show_file_format_errors({ as_image_error: error });
			return;
		}
		paste(info.image || make_canvas(info.image_data));
	});
}

// Edit > Paste From
async function choose_file_to_paste() {
	const { file } = await systemHooks.showOpenFileDialog({ formats: image_formats });
	if (file.type.match(/^image/)) {
		paste_image_from_file(file);
		return;
	}
	show_error_message(localize("This is not a valid bitmap file, or its format is not currently supported."));
}

/**
 * @param {HTMLImageElement | HTMLCanvasElement} img_or_canvas
 */
function paste(img_or_canvas) {

	if (img_or_canvas.width > main_canvas.width || img_or_canvas.height > main_canvas.height) {
		const message = localize("The image in the clipboard is larger than the bitmap.") + "\n" +
			localize("Would you like the bitmap enlarged?");
		showMessageBox({
			message,
			iconID: "question",
			buttons: [
				{
					// label: "Enlarge",
					label: localize("Yes"),
					value: "enlarge",
					default: true,
				},
				{
					// label: "Crop",
					label: localize("No"),
					value: "crop",
				},
				{
					label: localize("Cancel"),
					value: "cancel",
				},
			],
		}).then((result) => {
			if (result === "enlarge") {
				// The resize gets its own undoable, as in mspaint
				resize_canvas_and_save_dimensions(
					Math.max(main_canvas.width, img_or_canvas.width),
					Math.max(main_canvas.height, img_or_canvas.height),
					{
						name: "Enlarge Canvas For Paste",
					}
				);
				do_the_paste();
				$canvas_area.trigger("resize"); // already taken care of by resize_canvas_and_save_dimensions? or does this hide the main canvas handles?
			} else if (result === "crop") {
				do_the_paste();
			}
		});
	} else {
		do_the_paste();
	}

	function do_the_paste() {
		deselect();
		select_tool(get_tool_by_id(TOOL_SELECT));

		const x = Math.max(0, Math.ceil($canvas_area.scrollLeft() / magnification));
		const y = Math.max(0, Math.ceil(($canvas_area.scrollTop()) / magnification));
		// Nevermind, canvas, isn't aligned to the right in RTL layout!
		// let x = Math.max(0, Math.ceil($canvas_area.scrollLeft() / magnification));
		// if (get_direction() === "rtl") {
		// 	// magic number 8 is a guess, I guess based on the scrollbar width which shows on the left in RTL layout
		// 	// x = Math.max(0, Math.ceil(($canvas_area.innerWidth() - canvas.width + $canvas_area.scrollLeft() + 8) / magnification));
		// 	const scrollbar_width = $canvas_area[0].offsetWidth - $canvas_area[0].clientWidth; // maybe??
		// 	console.log("scrollbar_width", scrollbar_width);
		// 	x = Math.max(0, Math.ceil((-$canvas_area.innerWidth() + $canvas_area.scrollLeft() + scrollbar_width) / magnification + canvas.width));
		// }

		undoable({
			name: localize("Paste"),
			soft: true,
		}, () => {
			selection = new OnCanvasSelection(x, y, img_or_canvas.width, img_or_canvas.height, img_or_canvas);
		});
	}
}

/**
 * @param {HistoryNode} target_history_node
 * @param {boolean=} canceling
 */
function go_to_history_node(target_history_node, canceling) {
	const from_history_node = current_history_node;

	if (!target_history_node.image_data) {
		if (!canceling) {
			show_error_message("History entry has no image data.");
			window.console?.log("Target history entry has no image data:", target_history_node);
		}
		return;
	}
	/* For performance (especially with two finger panning), I'm disabling this safety check that preserves certain document states in the history.
	const current_image_data = main_ctx.getImageData(0, 0, main_canvas.width, main_canvas.height);
	if (!current_history_node.image_data || !image_data_match(current_history_node.image_data, current_image_data, 5)) {
		window.console?.log("Canvas image data changed outside of undoable", current_history_node, "current_history_node.image_data:", current_history_node.image_data, "document's current image data:", current_image_data);
		undoable({name: "Unknown [go_to_history_node]", use_loose_canvas_changes: true}, ()=> {});
	}
	*/
	current_history_node = target_history_node;

	deselect(true);
	if (!canceling) {
		cancel(true);
	}
	saved = false;
	update_title();

	main_ctx.copy(target_history_node.image_data);
	if (target_history_node.selection_image_data) {
		if (selection) {
			selection.destroy();
		}
		// @TODO maybe: could store whether a selection is from Free-Form Select
		// so it selects Free-Form Select when you jump to e.g. Move Selection
		// (or could traverse history to figure it out)
		if (target_history_node.name === localize("Free-Form Select")) {
			select_tool(get_tool_by_id(TOOL_FREE_FORM_SELECT));
		} else {
			select_tool(get_tool_by_id(TOOL_SELECT));
		}
		selection = new OnCanvasSelection(
			target_history_node.selection_x,
			target_history_node.selection_y,
			target_history_node.selection_image_data.width,
			target_history_node.selection_image_data.height,
			target_history_node.selection_image_data,
		);
	}
	if (target_history_node.textbox_text != null) {
		if (textbox) {
			textbox.destroy();
		}
		// @# text_tool_font =
		for (const [k, v] of Object.entries(target_history_node.text_tool_font)) {
			text_tool_font[k] = v;
		}

		selected_colors.foreground = target_history_node.foreground_color;
		selected_colors.background = target_history_node.background_color;
		tool_transparent_mode = target_history_node.tool_transparent_mode;
		$G.trigger("option-changed");

		select_tool(get_tool_by_id(TOOL_TEXT));
		textbox = new OnCanvasTextBox(
			target_history_node.textbox_x,
			target_history_node.textbox_y,
			target_history_node.textbox_width,
			target_history_node.textbox_height,
			target_history_node.textbox_text,
		);
	}

	const ancestors_of_target = get_history_ancestors(target_history_node);

	undos = [...ancestors_of_target];
	undos.reverse();

	const old_history_path =
		redos.length > 0 ?
			[redos[0], ...get_history_ancestors(redos[0])] :
			[from_history_node, ...get_history_ancestors(from_history_node)];

	// window.console?.log("target_history_node:", target_history_node);
	// window.console?.log("ancestors_of_target:", ancestors_of_target);
	// window.console?.log("old_history_path:", old_history_path);
	redos.length = 0;

	let latest_node = target_history_node;
	while (latest_node.futures.length > 0) {
		const futures = [...latest_node.futures];
		futures.sort((a, b) => {
			if (old_history_path.indexOf(a) > -1) {
				return -1;
			}
			if (old_history_path.indexOf(b) > -1) {
				return +1;
			}
			return 0;
		});
		latest_node = futures[0];
		redos.unshift(latest_node);
	}
	// window.console?.log("new undos:", undos);
	// window.console?.log("new redos:", redos);

	$canvas_area.trigger("resize");
}

// Note: This function is part of the API.
/**
 * Creates an undo point.
 * @param {ActionMetadata} options
 * @param {function=} callback
 */
function undoable({ name, use_loose_canvas_changes, soft, assume_saved }, callback) {
	if (!use_loose_canvas_changes) {
		/* For performance (especially with two finger panning), I'm disabling this safety check that preserves certain document states in the history.
		const current_image_data = main_ctx.getImageData(0, 0, main_canvas.width, main_canvas.height);
		if (!current_history_node.image_data || !image_data_match(current_history_node.image_data, current_image_data, 5)) {
			window.console?.log("Canvas image data changed outside of undoable", current_history_node, "current_history_node.image_data:", current_history_node.image_data, "document's current image data:", current_image_data);
			undoable({name: "Unknown [undoable]", use_loose_canvas_changes: true}, ()=> {});
		}
		*/
	}

	if (!assume_saved) { // flag is used for undoable file reloading on save, for reduction in color depth
		saved = false;
		update_title();
	}

	const before_callback_history_node = current_history_node;
	callback?.();
	if (current_history_node !== before_callback_history_node) {
		show_error_message(`History node switched during undoable callback for ${name}. This shouldn't happen.`);
		window.console?.log(`History node switched during undoable callback for ${name}, from`, before_callback_history_node, "to", current_history_node);
	}

	const image_data = main_ctx.getImageData(0, 0, main_canvas.width, main_canvas.height);

	redos.length = 0;
	undos.push(current_history_node);

	const new_history_node = make_history_node({
		image_data,
		selection_image_data: selection && selection.canvas.ctx.getImageData(0, 0, selection.canvas.width, selection.canvas.height),
		selection_x: selection && selection.x,
		selection_y: selection && selection.y,
		textbox_text: textbox && textbox.$editor.val(),
		textbox_x: textbox && textbox.x,
		textbox_y: textbox && textbox.y,
		textbox_width: textbox && textbox.width,
		textbox_height: textbox && textbox.height,
		text_tool_font: JSON.parse(JSON.stringify(text_tool_font)),
		tool_transparent_mode,
		foreground_color: selected_colors.foreground,
		background_color: selected_colors.background,
		ternary_color: selected_colors.ternary,
		parent: current_history_node,
		name,
		soft,
	});
	current_history_node.futures.push(new_history_node);
	current_history_node = new_history_node;

}
/**
 * @param {ActionMetadataUpdate} undoable_meta
 * @param {()=> void} undoable_action
 */
function make_or_update_undoable(undoable_meta, undoable_action) {
	if (current_history_node.futures.length === 0 && undoable_meta.match(current_history_node)) {
		undoable_action();
		current_history_node.image_data = main_ctx.getImageData(0, 0, main_canvas.width, main_canvas.height);
		current_history_node.selection_image_data = selection && selection.canvas.ctx.getImageData(0, 0, selection.canvas.width, selection.canvas.height);
		current_history_node.selection_x = selection && selection.x;
		current_history_node.selection_y = selection && selection.y;
		if (undoable_meta.update_name) {
			current_history_node.name = undoable_meta.name;
		}
	} else {
		undoable(undoable_meta, undoable_action);
	}
}
function undo() {
	if (undos.length < 1) { return false; }

	redos.push(current_history_node);
	let target_history_node = undos.pop();

	while (target_history_node.soft && undos.length) {
		redos.push(target_history_node);
		target_history_node = undos.pop();
	}

	go_to_history_node(target_history_node);

	return true;
}

function redo() {
	if (redos.length < 1) {
		return false;
	}

	undos.push(current_history_node);
	let target_history_node = redos.pop();

	while (target_history_node.soft && redos.length) {
		undos.push(target_history_node);
		target_history_node = redos.pop();
	}

	go_to_history_node(target_history_node);

	return true;
}

/**
 * @param {HistoryNode} node
 * @returns {HistoryNode[]} ancestors
 */
function get_history_ancestors(node) {
	const ancestors = [];
	for (node = node.parent; node; node = node.parent) {
		ancestors.push(node);
	}
	return ancestors;
}

/**
 * Cancel the current tool gesture, if any.
 * Note: this function should be idempotent. `cancel(); cancel();` should do the same thing as `cancel();`
 * @param {boolean} [going_to_history_node]
 * @param {boolean} [discard_document_state]
 */
function cancel(going_to_history_node, discard_document_state) {
	if (!history_node_to_cancel_to) {
		return;
	}

	// For two finger panning, I want to prevent history nodes from being created,
	// for performance, and to avoid cluttering the history.
	// (And also so if you undo and then pan, you can still redo.)
	// Most tools create undoables on pointerup, in which case we can prevent them from being created,
	// but Fill tool creates on pointerdown, so we need to delete a history node in that case.
	// Select tool can create multiple undoables before being cancelled (for moving/resizing/inverting/smearing),
	// but only the last should be discarded due to panning. (All of them should be undone you hit Esc. But not deleted.)
	const history_node_to_discard = (
		discard_document_state &&
		current_history_node.parent && // can't discard the root node
		current_history_node !== history_node_to_cancel_to && // can't discard what will be the active node
		current_history_node.futures.length === 0 // prevent discarding whole branches of history if you go back in history and then pan / hit Esc
	) ? current_history_node : null;

	// console.log("history_node_to_discard", history_node_to_discard, "current_history_node", current_history_node, "history_node_to_cancel_to", history_node_to_cancel_to);

	// history_node_to_cancel_to = history_node_to_cancel_to || current_history_node;
	$G.triggerHandler("pointerup", ["canceling", discard_document_state]);
	for (const selected_tool of selected_tools) {
		selected_tool.cancel?.();
	}
	if (!going_to_history_node) {
		// Note: this will revert any changes from other users in multi-user sessions
		// which isn't good, but there's no real conflict resolution in multi-user mode anyways
		go_to_history_node(history_node_to_cancel_to, true);

		if (history_node_to_discard) {
			const index = history_node_to_discard.parent.futures.indexOf(history_node_to_discard);
			if (index === -1) {
				show_error_message("History node not found. Please report this bug.");
				console.log("history_node_to_discard", history_node_to_discard);
				console.log("current_history_node", current_history_node);
				console.log("history_node_to_discard.parent", history_node_to_discard.parent);
			} else {
				history_node_to_discard.parent.futures.splice(index, 1);
				// (@TODO: prevent duplicate update, here vs go_to_history_node)
			}
		}
	}
	history_node_to_cancel_to = null;
	update_helper_layer();
}
/**
 * @param {boolean} [going_to_history_node]
 */
function meld_selection_into_canvas(going_to_history_node) {
	selection.draw();
	selection.destroy();
	selection = null;
	if (!going_to_history_node) {
		undoable({
			name: "Deselect",
			use_loose_canvas_changes: true, // HACK; @TODO: make OnCanvasSelection not change the canvas outside undoable, same rules as tools
		}, () => { });
	}
}
/**
 * @param {boolean} [going_to_history_node]
 */
function meld_textbox_into_canvas(going_to_history_node) {
	const text = textbox.$editor.val();
	if (text && !going_to_history_node) {
		undoable({
			name: localize("Text"),
			soft: true,
		}, () => { });
		undoable({
			name: "Finish Text",
		}, () => {
			main_ctx.drawImage(textbox.canvas, textbox.x, textbox.y);
			textbox.destroy();
			textbox = null;
		});
	} else {
		textbox.destroy();
		textbox = null;
	}
}
/**
 * @param {boolean} [going_to_history_node]
 */
function deselect(going_to_history_node) {
	if (selection) {
		meld_selection_into_canvas(going_to_history_node);
	}
	if (textbox) {
		meld_textbox_into_canvas(going_to_history_node);
	}
	for (const selected_tool of selected_tools) {
		selected_tool.end?.(main_ctx);
	}
}

/**
 * @param {{name?: string}} [meta] - overrides certain properties of ActionMetadata
 */
function delete_selection(meta = {}) {
	if (selection) {
		undoable({
			name: meta.name || localize("Clear Selection"), //"Delete", (I feel like "Clear Selection" is unclear, could mean "Deselect")
			// soft: @TODO: conditionally soft?,
		}, () => {
			selection.destroy();
			selection = null;
		});
	}
}
function select_all() {
	deselect();
	select_tool(get_tool_by_id(TOOL_SELECT));

	undoable({
		name: localize("Select All"),
		soft: true,
	}, () => {
		selection = new OnCanvasSelection(0, 0, main_canvas.width, main_canvas.height);
	});
}

const ctrlOrCmd = /(Mac|iPhone|iPod|iPad)/i.test(navigator.platform) ? "⌘" : "Ctrl";
const recommendationForClipboardAccess = `Please use the keyboard: ${ctrlOrCmd}+C to copy, ${ctrlOrCmd}+X to cut, ${ctrlOrCmd}+V to paste. If keyboard is not an option, try using Chrome version 76 or higher.`;
/**
 * @param {string} commandId
 */
function try_exec_command(commandId) {
	if (document.queryCommandEnabled(commandId)) { // not a reliable source for whether it'll work, if I recall
		document.execCommand(commandId);
		if (!navigator.userAgent.includes("Firefox") || commandId === "paste") {
			return show_error_message(`That ${commandId} probably didn't work. ${recommendationForClipboardAccess}`);
		}
	} else {
		return show_error_message(`Cannot perform ${commandId}. ${recommendationForClipboardAccess}`);
	}
}

function getSelectionText() {
	// instanceof might make this simpler, particularly with TypeScript JSDoc
	const activeEl = document.activeElement;
	const activeElTagName = activeEl ? activeEl.tagName.toLowerCase() : null;
	if (
		(activeElTagName == "textarea") || (
			activeElTagName == "input" &&
			/^(?:text|search|password|tel|url)$/i.test(/** @type {HTMLInputElement} */(activeEl).type)
		)
	) {
		const textField = /** @type {HTMLInputElement | HTMLTextAreaElement} */(activeEl);
		if (typeof textField.selectionStart == "number") {
			return textField.value.slice(textField.selectionStart, textField.selectionEnd);
		}
	}
	if (window.getSelection) {
		return window.getSelection().toString();
	}
	return "";
}

/**
 * @param {boolean} [execCommandFallback]
 */
function edit_copy(execCommandFallback) {
	const text = getSelectionText();

	if (text.length > 0) {
		if (!navigator.clipboard || !navigator.clipboard.writeText) {
			if (execCommandFallback) {
				return try_exec_command("copy");
			} else {
				show_error_message(`${localize("Error getting the Clipboard Data!")} ${recommendationForClipboardAccess}`);
				// show_error_message(`The Async Clipboard API is not supported by this browser. ${browserRecommendationForClipboardAccess}`);
				return;
			}
		}
		navigator.clipboard.writeText(text);
	} else if (selection && selection.canvas) {
		if (!navigator.clipboard || !navigator.clipboard.write) {
			if (execCommandFallback) {
				return try_exec_command("copy");
			} else {
				show_error_message(`${localize("Error getting the Clipboard Data!")} ${recommendationForClipboardAccess}`);
				// show_error_message(`The Async Clipboard API is not supported by this browser. ${browserRecommendationForClipboardAccess}`);
				return;
			}
		}
		selection.canvas.toBlob((blob) => {
			sanity_check_blob(blob, () => {
				navigator.clipboard.write([
					new ClipboardItem(Object.defineProperty({}, blob.type, {
						value: blob,
						enumerable: true,
					})),
				]).then(() => {
					window.console?.log("Copied image to the clipboard.");
				}, (error) => {
					show_error_message("Failed to copy to the Clipboard.", error);
				});
			});
		});
	}
}
/**
 * @param {boolean} [execCommandFallback]
 */
function edit_cut(execCommandFallback) {
	if (!navigator.clipboard || !navigator.clipboard.write) {
		if (execCommandFallback) {
			return try_exec_command("cut");
		} else {
			show_error_message(`${localize("Error getting the Clipboard Data!")} ${recommendationForClipboardAccess}`);
			// show_error_message(`The Async Clipboard API is not supported by this browser. ${browserRecommendationForClipboardAccess}`);
			return;
		}
	}
	edit_copy();
	delete_selection({
		name: localize("Cut"),
	});
}
/**
 * @param {boolean} [execCommandFallback]
 */
async function edit_paste(execCommandFallback) {
	if (
		document.activeElement instanceof HTMLInputElement ||
		document.activeElement instanceof HTMLTextAreaElement
	) {
		if (!navigator.clipboard || !navigator.clipboard.readText) {
			if (execCommandFallback) {
				return try_exec_command("paste");
			} else {
				show_error_message(`${localize("Error getting the Clipboard Data!")} ${recommendationForClipboardAccess}`);
				// show_error_message(`The Async Clipboard API is not supported by this browser. ${browserRecommendationForClipboardAccess}`);
				return;
			}
		}
		const clipboardText = await navigator.clipboard.readText();
		document.execCommand("InsertText", false, clipboardText);
		return;
	}
	if (!navigator.clipboard || !navigator.clipboard.read) {
		if (execCommandFallback) {
			return try_exec_command("paste");
		} else {
			show_error_message(`${localize("Error getting the Clipboard Data!")} ${recommendationForClipboardAccess}`);
			// show_error_message(`The Async Clipboard API is not supported by this browser. ${browserRecommendationForClipboardAccess}`);
			return;
		}
	}
	try {
		const clipboardItems = await navigator.clipboard.read();
		const blob = await clipboardItems[0].getType("image/png");
		paste_image_from_file(blob);
	} catch (error) {
		if (error.name === "NotFoundError") {
			try {
				const clipboardText = await navigator.clipboard.readText();
				if (clipboardText) {
					const uris = get_uris(clipboardText);
					if (uris.length > 0) {
						load_image_from_uri(uris[0]).then((info) => {
							paste(info.image || make_canvas(info.image_data));
						}, (error) => {
							show_resource_load_error_message(error);
						});
					} else {
						// @TODO: should I just make a textbox instead?
						show_error_message("The information on the Clipboard can't be inserted into Paint.");
					}
				} else {
					show_error_message("The information on the Clipboard can't be inserted into Paint.");
				}
			} catch (error) {
				show_error_message(localize("Error getting the Clipboard Data!"), error);
			}
		} else {
			show_error_message(localize("Error getting the Clipboard Data!"), error);
		}
	}
}

function image_invert_colors() {
	apply_image_transformation({
		name: localize("Invert Colors"),
	}, (_original_canvas, original_ctx, _new_canvas, new_ctx) => {
		const monochrome_info = monochrome && detect_monochrome(original_ctx);
		if (monochrome && monochrome_info.isMonochrome) {
			invert_monochrome(original_ctx, new_ctx, monochrome_info);
		} else {
			invert_rgb(original_ctx, new_ctx);
		}
	});
}

function clear() {
	deselect();
	cancel();
	undoable({
		name: localize("Clear Image"),
	}, () => {
		saved = false;
		update_title();

		if (transparency) {
			main_ctx.clearRect(0, 0, main_canvas.width, main_canvas.height);
		} else {
			main_ctx.fillStyle = selected_colors.background;
			main_ctx.fillRect(0, 0, main_canvas.width, main_canvas.height);
		}
	});
}

let cleanup_bitmap_view = () => { };
function view_bitmap() {
	cleanup_bitmap_view();

	const bitmap_view_div = document.createElement("div");
	bitmap_view_div.classList.add("bitmap-view", "inset-deep");
	document.body.appendChild(bitmap_view_div);
	$(bitmap_view_div).css({
		display: "flex",
		alignItems: "center",
		justifyContent: "center",
		position: "fixed",
		top: "0",
		left: "0",
		width: "100%",
		height: "100%",
		zIndex: "9999",
		background: "var(--Background)",
	});
	if (bitmap_view_div.requestFullscreen) {
		bitmap_view_div.requestFullscreen();
	} else if (bitmap_view_div.webkitRequestFullscreen) {
		bitmap_view_div.webkitRequestFullscreen();
	}

	let blob_url;
	let got_fullscreen = false;
	let iid = setInterval(() => {
		// In Chrome, if the page is already fullscreen, and you requestFullscreen,
		// hitting Esc will change document.fullscreenElement without triggering the fullscreenchange event!
		// It doesn't trigger a keydown either.
		if (document.fullscreenElement === bitmap_view_div || document.webkitFullscreenElement === bitmap_view_div) {
			got_fullscreen = true;
		} else if (got_fullscreen) {
			cleanup_bitmap_view();
		}
	}, 100);
	cleanup_bitmap_view = () => {
		document.removeEventListener("fullscreenchange", onFullscreenChange);
		document.removeEventListener("webkitfullscreenchange", onFullscreenChange);
		document.removeEventListener("keydown", onKeyDown);
		document.removeEventListener("mousedown", onMouseDown);
		// If you have e.g. the Help window open,
		// and right click to close the View Bitmap, with the mouse over the window,
		// this needs a delay to cancel the context menu.
		setTimeout(() => {
			document.removeEventListener("contextmenu", onContextMenu);
		}, 100);
		URL.revokeObjectURL(blob_url);
		clearInterval(iid);
		if (document.fullscreenElement === bitmap_view_div || document.webkitFullscreenElement === bitmap_view_div) {
			if (document.exitFullscreen) {
				document.exitFullscreen(); // avoid warning in Firefox
			} else if (document.msExitFullscreen) {
				document.msExitFullscreen();
			} else if (document.mozCancelFullScreen) {
				document.mozCancelFullScreen();
			} else if (document.webkitExitFullscreen) {
				document.webkitExitFullscreen();
			}
		}
		bitmap_view_div.remove();
		cleanup_bitmap_view = () => { };
	};
	document.addEventListener("fullscreenchange", onFullscreenChange, { once: true });
	document.addEventListener("webkitfullscreenchange", onFullscreenChange, { once: true });
	document.addEventListener("keydown", onKeyDown);
	document.addEventListener("mousedown", onMouseDown);
	document.addEventListener("contextmenu", onContextMenu);

	function onFullscreenChange() {
		if (document.fullscreenElement !== bitmap_view_div && document.webkitFullscreenElement !== bitmap_view_div) {
			cleanup_bitmap_view();
		}
	}
	let repeating_f = false;
	function onKeyDown(event) {
		// console.log(event.key, event.repeat);
		repeating_f = repeating_f || event.repeat && (event.key === "f" || event.key === "F");
		if (event.repeat) { return; }
		if (repeating_f && (event.key === "f" || event.key === "F")) {
			repeating_f = false;
			return; // Chrome sends an F keydown with repeat=false if you release Ctrl before F, while repeating.
			// This is a slightly overkill, and slightly overzealous workaround (can ignore one normal F before handling F as exit)
		}
		// Prevent also toggling View Bitmap on while toggling off, with Ctrl+F+F.
		// That is, if you hold Ctrl and press F twice, the second F should close View Bitmap and not reopen it immediately.
		// This relies on the keydown handler handling event.defaultPrevented (or isDefaultPrevented() if it's using jQuery)
		event.preventDefault();
		// Note: in mspaint, Esc is the only key that DOESN'T close the bitmap view,
		// but it also doesn't do anything else — other than changing the cursor. Stupid.
		cleanup_bitmap_view();
	}
	function onMouseDown(_event) {
		// Note: in mspaint, only left click exits View Bitmap mode.
		// Right click can show a useless context menu.
		cleanup_bitmap_view();
	}
	function onContextMenu(event) {
		event.preventDefault();
		cleanup_bitmap_view(); // not needed
	}

	// @TODO: include selection in the bitmap
	// I believe mspaint uses a similar code path to the Thumbnail,
	// considering that if you right click on the image in View Bitmap mode,
	// it shows the silly "Thumbnail" context menu item.
	// (It also shows the selection, in a meaningless place, similar to the Thumbnail's bugs)
	main_canvas.toBlob((blob) => {
		blob_url = URL.createObjectURL(blob);
		const img = document.createElement("img");
		img.src = blob_url;
		bitmap_view_div.appendChild(img);
	}, "image/png");
}
/**
 * @param {ToolID} id
 * @returns {Tool} tool object
 */
function get_tool_by_id(id) {
	for (let i = 0; i < tools.length; i++) {
		if (tools[i].id == id) {
			return tools[i];
		}
	}
	// for (let i = 0; i < extra_tools.length; i++) {
	// 	if (extra_tools[i].id == id) {
	// 		return extra_tools[i];
	// 	}
	// }
}

// hacky but whatever
// this whole "multiple tools" thing is hacky for now
/**
 * @param {Tool[]} tools
 */
function select_tools(tools) {
	for (let i = 0; i < tools.length; i++) {
		select_tool(tools[i], i > 0);
	}
	update_helper_layer();
}

/**
 * @param {Tool} tool
 * @param {boolean} [toggle]
 */
function select_tool(tool, toggle) {
	deselect();

	if (!(selected_tools.length === 1 && selected_tool.deselect)) {
		return_to_tools = [...selected_tools];
	}
	if (toggle) {
		const index = selected_tools.indexOf(tool);
		if (index === -1) {
			selected_tools.push(tool);
			selected_tools.sort((a, b) => {
				if (tools.indexOf(a) < tools.indexOf(b)) {
					return -1;
				}
				if (tools.indexOf(a) > tools.indexOf(b)) {
					return +1;
				}
				return 0;
			});
		} else {
			selected_tools.splice(index, 1);
		}
		if (selected_tools.length > 0) {
			selected_tool = selected_tools[selected_tools.length - 1];
		} else {
			selected_tool = default_tool;
			selected_tools = [selected_tool];
		}
	} else {
		selected_tool = tool;
		selected_tools = [tool];
	}

	if (tool.preload) {
		tool.preload();
	}

	$toolbox.update_selected_tool();
	OnCanvasTextBox.update_fontbox();
}

/**
 * @param {CanvasRenderingContext2D} ctx
 * @returns {boolean} whether the canvas has any translucent pixels (with a stupid margin of error)
 */
function has_any_transparency(ctx) {
	// @TODO Optimization: Assume JPEGs and some other file types are opaque.
	// Raster file formats that SUPPORT transparency include GIF, PNG, BMP and TIFF
	// (Yes, even BMPs support transparency!)
	const id = ctx.getImageData(0, 0, main_canvas.width, main_canvas.height);
	for (let i = 0, l = id.data.length; i < l; i += 4) {
		// I've seen firefox give [ 254, 254, 254, 254 ] for get_rgba_from_color("#fff")
		// or other values
		if (id.data[i + 3] < 253) {
			return true;
		}
	}
	return false;
}

/**
 * @param {CanvasRenderingContext2D} ctx
 * @returns {MonochromeInfo}
 */
function detect_monochrome(ctx) {
	// Note: Brave browser, and DuckDuckGo Privacy Essentials browser extension
	// implement a privacy technique known as "farbling", which breaks this code.
	// (I've implemented workarounds in many places, but not here yet.)
	// This function currently returns the set of one or two colors if applicable,
	// and things outside would need to be changed to handle a "near-monochrome" state.

	const id = ctx.getImageData(0, 0, ctx.canvas.width, ctx.canvas.height);
	const pixelArray = new Uint32Array(id.data.buffer); // to access as whole pixels (for greater efficiency & simplicity)
	// Note: values in pixelArray may be different on big endian vs little endian machines.
	// Use id.data, which is guaranteed to be in RGBA order, for getting color information.
	// Only use the Uint32Array for comparing pixel equality (faster than comparing each color component).
	const colorUint32s = [];
	const colorRGBAs = [];
	let anyTransparency = false;
	for (let i = 0, len = pixelArray.length; i < len; i += 1) {
		// @TODO: should this threshold not mirror has_any_transparency?
		// seems to have different notions of "any transparency"
		// has_any_transparency is "has any pixels not fully opaque"
		// detect_monochrome's anyTransparency means "has any pixels fully transparent"
		if (id.data[i * 4 + 3] > 1) {
			if (!colorUint32s.includes(pixelArray[i])) {
				if (colorUint32s.length < 2) {
					colorUint32s.push(pixelArray[i]);
					colorRGBAs.push(id.data.slice(i * 4, (i + 1) * 4));
				} else {
					return { isMonochrome: false };
				}
			}
		} else {
			anyTransparency = true;
		}
	}
	return {
		isMonochrome: true,
		presentNonTransparentRGBAs: colorRGBAs,
		presentNonTransparentUint32s: colorUint32s,
		monochromeWithTransparency: anyTransparency,
	};
}

/**
 * Creates a dithered pattern using two colors.
 * @param {number} lightness - The approximate fraction of pixels that will use the second(?) color.
 * @param {Uint8ClampedArray | number[]} rgba1 - RGBA color values for the first color.
 * @param {Uint8ClampedArray | number[]} rgba2 - RGBA color values for the second color.
 * @returns {CanvasPattern}
 */
function make_monochrome_pattern(lightness, rgba1 = [0, 0, 0, 255], rgba2 = [255, 255, 255, 255]) {

	const dither_threshold_table = Array.from({ length: 64 }, (_undefined, p) => {
		const q = p ^ (p >> 3);
		return (
			((p & 4) >> 2) | ((q & 4) >> 1) |
			((p & 2) << 1) | ((q & 2) << 2) |
			((p & 1) << 4) | ((q & 1) << 5)
		) / 64;
	});

	const pattern_canvas = document.createElement("canvas");
	const pattern_ctx = pattern_canvas.getContext("2d");

	pattern_canvas.width = 8;
	pattern_canvas.height = 8;

	const pattern_image_data = main_ctx.createImageData(pattern_canvas.width, pattern_canvas.height);

	for (let x = 0; x < pattern_canvas.width; x += 1) {
		for (let y = 0; y < pattern_canvas.height; y += 1) {
			const map_value = dither_threshold_table[(x & 7) + ((y & 7) << 3)];
			const px_white = lightness > map_value;
			const index = ((y * pattern_image_data.width) + x) * 4;
			pattern_image_data.data[index + 0] = px_white ? rgba2[0] : rgba1[0];
			pattern_image_data.data[index + 1] = px_white ? rgba2[1] : rgba1[1];
			pattern_image_data.data[index + 2] = px_white ? rgba2[2] : rgba1[2];
			pattern_image_data.data[index + 3] = (px_white ? rgba2[3] : rgba1[3]) ?? 255; // handling also 3-length arrays (RGB)
		}
	}

	pattern_ctx.putImageData(pattern_image_data, 0, 0);

	return main_ctx.createPattern(pattern_canvas, "repeat");
}

/**
 * @param {Uint8ClampedArray | number[]} rgba1
 * @param {Uint8ClampedArray | number[]} rgba2
 * @returns {CanvasPattern[]}
 */
function make_monochrome_palette(rgba1 = [0, 0, 0, 255], rgba2 = [255, 255, 255, 255]) {
	const palette = [];
	const n_colors_per_row = 14;
	const n_colors = n_colors_per_row * 2;
	for (let i = 0; i < n_colors_per_row; i++) {
		let lightness = i / n_colors;
		palette.push(make_monochrome_pattern(lightness, rgba1, rgba2));
	}
	for (let i = 0; i < n_colors_per_row; i++) {
		let lightness = 1 - i / n_colors;
		palette.push(make_monochrome_pattern(lightness, rgba1, rgba2));
	}

	return palette;
}

function make_opaque() {
	undoable({
		name: "Make Opaque",
	}, () => {
		main_ctx.save();
		main_ctx.globalCompositeOperation = "destination-atop";

		main_ctx.fillStyle = selected_colors.background;
		main_ctx.fillRect(0, 0, main_canvas.width, main_canvas.height);

		// in case the selected background color is transparent/translucent
		main_ctx.fillStyle = "white";
		main_ctx.fillRect(0, 0, main_canvas.width, main_canvas.height);

		main_ctx.restore();
	});
}

/**
 * Resizes the canvas without saving the dimensions to local storage.
 *
 * @param {number} unclamped_width - The new width of the canvas. Will be clamped to a minimum of 1.
 * @param {number} unclamped_height - The new height of the canvas. Will be clamped to a minimum of 1.
 * @param {{name?: string}} [undoable_meta={}] - overrides certain properties of ActionMetadata
 */
function resize_canvas_without_saving_dimensions(unclamped_width, unclamped_height, undoable_meta = {}) {
	const new_width = Math.max(1, unclamped_width);
	const new_height = Math.max(1, unclamped_height);
	if (main_canvas.width !== new_width || main_canvas.height !== new_height) {
		undoable({
			name: undoable_meta.name || "Resize Canvas",
		}, () => {
			try {
				const image_data = main_ctx.getImageData(0, 0, new_width, new_height);
				main_canvas.width = new_width;
				main_canvas.height = new_height;
				main_ctx.disable_image_smoothing();

				if (!transparency) {
					main_ctx.fillStyle = selected_colors.background;
					main_ctx.fillRect(0, 0, main_canvas.width, main_canvas.height);
				}

				const temp_canvas = make_canvas(image_data);
				main_ctx.drawImage(temp_canvas, 0, 0);
			} catch (exception) {
				if (exception.name === "NS_ERROR_FAILURE") {
					// or localize("There is not enough memory or resources to complete operation.")
					show_error_message(localize("Insufficient memory to perform operation."), exception);
				} else {
					show_error_message(localize("An unknown error has occurred."), exception);
				}
				// @TODO: undo and clean up undoable
				// maybe even keep Attributes dialog open if that's what's triggering the resize
				return;
			}

			$canvas_area.trigger("resize");
		});
	}
}

/**
 * Resizes the canvas and saves the dimensions to local storage as the new default.
 *
 * @param {number} unclamped_width - The new width of the canvas. Will be clamped to a minimum of 1.
 * @param {number} unclamped_height - The new height of the canvas. Will be clamped to a minimum of 1.
 * @param {{name?: string}} [undoable_meta={}] - overrides certain properties of ActionMetadata
 */
function resize_canvas_and_save_dimensions(unclamped_width, unclamped_height, undoable_meta = {}) {
	resize_canvas_without_saving_dimensions(unclamped_width, unclamped_height, undoable_meta);
	localStore.set({
		width: main_canvas.width.toString(),
		height: main_canvas.height.toString(),
	}, (_error) => {
		// oh well
	});
}

/**
 * What the Attributes dialog's OK does.
 * @param {{ width: number, height: number, colors: string, transparency: string }} attributes
 */
function apply_image_attributes({ width, height, colors: colors_option, transparency: transparency_option }) {
	const was_monochrome = monochrome;
	let monochrome_info;

	transparency = (transparency_option == "transparent");
	monochrome = (colors_option == "monochrome");

	if (monochrome != was_monochrome) {
		if (selection) {
			// want to detect monochrome based on selection + canvas
			// simplest way to do that is to meld them together
			meld_selection_into_canvas();
		}
		monochrome_info = detect_monochrome(main_ctx);

		if (monochrome) {
			if (monochrome_info.isMonochrome && monochrome_info.presentNonTransparentRGBAs.length === 2) {
				palette = make_monochrome_palette(...monochrome_info.presentNonTransparentRGBAs);
			} else {
				palette = monochrome_palette;
			}
		} else {
			palette = polychrome_palette;
		}
		selected_colors.foreground = palette[0];
		selected_colors.background = palette[14]; // first in second row
		selected_colors.ternary = "";
		$colorbox.rebuild_palette();
		$G.trigger("option-changed");
	}

	resize_canvas_and_save_dimensions(~~width, ~~height);

	if (!transparency && has_any_transparency(main_ctx)) {
		make_opaque();
	}

	// 1. Must be after canvas resize to avoid weird undoable interaction and such.
	// 2. Check that monochrome option changed, same as above.
	//   a) for monochrome_info variable to be available
	//   b) Consider the case where color is introduced to the canvas while in monochrome mode.
	//      We only want to show this dialog if it would also change the palette (above), never leave you on an outdated palette.
	//   c) And it's nice to be able to change other options without worrying about it trying to convert the document to monochrome.
	if (monochrome != was_monochrome) {
		if (monochrome && !monochrome_info.isMonochrome) {
			show_convert_to_black_and_white();
		}
	}
}

// TODO: maybe don't tack properties onto functions so much!?

/**
 * Writes an image file to a blob, in the given format.
 * @param {HTMLCanvasElement} canvas - The canvas to export as an image file. Must have a 2d context.
 * @param {string} mime_type - The MIME type of the image file.
 * @param {(Blob)=> void} blob_callback - This function is called with the blob, or may never be called if there is an error.
 */
function write_image_file(canvas, mime_type, blob_callback) {
	const ctx = canvas.getContext("2d");
	const bmp_match = mime_type.match(/^image\/(?:x-)?bmp\s*(?:-(\d+)bpp)?/);
	if (bmp_match) {
		const file_content = encodeBMP(ctx.getImageData(0, 0, canvas.width, canvas.height), parseInt(bmp_match[1] || "24", 10));
		const blob = new Blob([file_content]);
		sanity_check_blob(blob, () => {
			blob_callback(blob);
		});
	} else if (mime_type === "image/png") {
		// UPNG.js gives better compressed PNGs than the built-in browser PNG encoder
		// In fact you can use it as a minifier! http://upng.photopea.com/
		const image_data = ctx.getImageData(0, 0, canvas.width, canvas.height);
		const array_buffer = UPNG.encode([image_data.data.buffer], image_data.width, image_data.height);
		const blob = new Blob([array_buffer]);
		sanity_check_blob(blob, () => {
			blob_callback(blob);
		});
	} else if (mime_type === "image/tiff") {
		const image_data = ctx.getImageData(0, 0, canvas.width, canvas.height);
		const metadata = {
			t305: ["jspaint (UTIF.js)"],
		};
		const array_buffer = UTIF.encodeImage(image_data.data.buffer, image_data.width, image_data.height, metadata);
		const blob = new Blob([array_buffer]);
		sanity_check_blob(blob, () => {
			blob_callback(blob);
		});
	} else {
		canvas.toBlob((blob) => {
			// Note: could check blob.type (mime type) instead
			const png_magic_bytes = [0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A];
			sanity_check_blob(blob, () => {
				blob_callback(blob);
			}, png_magic_bytes, mime_type === "image/png");
		}, mime_type);
	}
}

/**
 * @param {Blob} blob
 * @param {(error: Error|null, result?: ImageInfo) => void} callback
 */
function read_image_file(blob, callback) {
	// @TODO: handle SVG (might need to keep track of source URL, for relative resources)
	// @TODO: read palette from GIF files

	let file_format;
	let palette;
	let monochrome = false;

	blob.arrayBuffer().then((arrayBuffer) => {
		// Helpers:
		// "GIF".split("").map(c=>"0x"+c.charCodeAt(0).toString("16")).join(", ")
		// [0x47, 0x49, 0x46].map(c=>String.fromCharCode(c)).join("")
		const magics = {
			png: [0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A],
			bmp: [0x42, 0x4D], // "BM" in ASCII
			jpeg: [0xFF, 0xD8, 0xFF],
			gif: [0x47, 0x49, 0x46, 0x38], // "GIF8" in ASCII, fully either "GIF87a" or "GIF89a"
			webp: [0x57, 0x45, 0x42, 0x50], // "WEBP" in ASCII
			tiff_be: [0x4D, 0x4D, 0x0, 0x2A],
			tiff_le: [0x49, 0x49, 0x2A, 0x0],
			ico: [0x00, 0x00, 0x01, 0x00],
			cur: [0x00, 0x00, 0x02, 0x00],
			icns: [0x69, 0x63, 0x6e, 0x73], // "icns" in ASCII
		};
		const file_bytes = new Uint8Array(arrayBuffer);
		let detected_type_id;
		for (const [type_id, magic_bytes] of Object.entries(magics)) {
			const magic_found = magic_bytes.every((byte, index) => byte === file_bytes[index]);
			if (magic_found) {
				detected_type_id = type_id;
			}
		}
		if (detected_type_id === "bmp") {
			const { colorTable, bitsPerPixel, imageData } = decodeBMP(arrayBuffer);
			file_format = bitsPerPixel === 24 ? "image/bmp" : `image/bmp;bpp=${bitsPerPixel}`;
			if (colorTable.length >= 2) {
				if (colorTable.length === 2) {
					palette = make_monochrome_palette(...colorTable.map((color) => [color.r, color.g, color.b, 255]));
					monochrome = true;
				} else {
					palette = colorTable.map((color) => `rgb(${color.r}, ${color.g}, ${color.b})`);
					monochrome = false;
				}
			}
			// if (bitsPerPixel !== 32 && bitsPerPixel !== 16) {
			// 	for (let i = 3; i < imageData.data.length; i += 4) {
			// 		imageData.data[i] = 255;
			// 	}
			// }
			callback(null, { file_format, monochrome, palette, image_data: imageData, source_blob: blob });
		} else if (detected_type_id === "png") {
			const decoded = UPNG.decode(arrayBuffer);
			const rgba = UPNG.toRGBA8(decoded)[0];
			const { width, height, tabs, ctype } = decoded;
			// If it's a palettized PNG, load the palette for the Colors box.
			// Note: PLTE (palette) chunk must be present for palettized PNGs,
			// but can also be present as a recommended set of colors in true-color mode.
			// tRNs (transparency) chunk can provide alpha data associated with each color in the PLTE chunk.
			// It may contain as many transparency entries as there are palette entries, or as few as one.
			// tRNS chunk can also be used to specify a single color to be considered fully transparent in true-color mode.
			if (tabs.PLTE && tabs.PLTE.length >= 3 * 2 && ctype === 3 /* palettized */) {
				if (tabs.PLTE.length === 3 * 2) {
					palette = make_monochrome_palette(
						[...tabs.PLTE.slice(0, 3), tabs.tRNS?.[0] ?? 255],
						[...tabs.PLTE.slice(3, 6), tabs.tRNS?.[1] ?? 255]
					);
					monochrome = true;
				} else {
					palette = new Array(tabs.PLTE.length / 3);
					for (let i = 0; i < palette.length; i++) {
						if (tabs.tRNS && tabs.tRNS.length >= i + 1) {
							palette[i] = `rgba(${tabs.PLTE[i * 3 + 0]}, ${tabs.PLTE[i * 3 + 1]}, ${tabs.PLTE[i * 3 + 2]}, ${tabs.tRNS[i] / 255})`;
						} else {
							palette[i] = `rgb(${tabs.PLTE[i * 3 + 0]}, ${tabs.PLTE[i * 3 + 1]}, ${tabs.PLTE[i * 3 + 2]})`;
						}
					}
					monochrome = false;
				}
			}
			file_format = "image/png";
			const image_data = new ImageData(new Uint8ClampedArray(rgba), width, height);
			callback(null, { file_format, monochrome, palette, image_data, source_blob: blob });
		} else if (detected_type_id === "tiff_be" || detected_type_id === "tiff_le") {
			// IFDs = image file directories
			// VSNs = ???
			// This code is based on UTIF.bufferToURI
			var ifds = UTIF.decode(arrayBuffer);
			//console.log(ifds);
			var vsns = ifds, ma = 0, page = vsns[0];
			if (ifds[0].subIFD) {
				vsns = vsns.concat(ifds[0].subIFD);
			}
			for (var i = 0; i < vsns.length; i++) {
				var img = vsns[i];
				if (img["t258"] == null || img["t258"].length < 3) continue;
				var ar = img["t256"] * img["t257"];
				if (ar > ma) { ma = ar; page = img; }
			}
			UTIF.decodeImage(arrayBuffer, page, ifds);
			var rgba = UTIF.toRGBA8(page);

			var image_data = new ImageData(new Uint8ClampedArray(rgba.buffer), page.width, page.height);

			file_format = "image/tiff";
			callback(null, { file_format, monochrome, palette, image_data, source_blob: blob });
		} else {
			monochrome = false;
			file_format = {
				// bmp: "image/bmp",
				png: "image/png",
				webp: "image/webp",
				jpeg: "image/jpeg",
				gif: "image/gif",
				tiff_be: "image/tiff",
				tiff_le: "image/tiff", // can also be image/x-canon-cr2 etc.
				ico: "image/x-icon",
				cur: "image/x-win-bitmap",
				icns: "image/icns",
			}[detected_type_id] || blob.type;

			const blob_uri = URL.createObjectURL(blob);
			const img = new Image();
			// img.crossOrigin = "Anonymous";
			const handle_decode_fail = () => {
				URL.revokeObjectURL(blob_uri);
				blob.text().then((file_text) => {
					const error = new Error("failed to decode blob as an image");
					// @ts-ignore
					error.code = file_text.match(/^\s*<!doctype\s+html/i) ? "html-not-image" : "decoding-failure";
					callback(error);
				}, (_err) => {
					const error = new Error("failed to decode blob as image or text");
					// @ts-ignore
					error.code = "decoding-failure";
					callback(error);
				});
			};
			img.onload = () => {
				URL.revokeObjectURL(blob_uri);
				if (!img.complete || typeof img.naturalWidth == "undefined" || img.naturalWidth === 0) {
					handle_decode_fail();
					return;
				}
				callback(null, { file_format, monochrome, palette, image: img, source_blob: blob });
			};
			img.onerror = handle_decode_fail;
			img.src = blob_uri;
		}
	}, (error) => {
		callback(error);
	});
}

/**
 * Updates the canvas to reflect reductions in color when saving to certain file formats.
 * @param {Blob} blob - The saved file blob.
 */
function update_from_saved_file(blob) {
	read_image_file(blob, (error, info) => {
		if (error) {
			show_error_message("The file has been saved, however... " + localize("Paint cannot read this file."), error);
			return;
		}
		apply_file_format_and_palette_info(info);
		const format = image_formats.find(({ mimeType }) => mimeType === info.file_format);
		undoable({
			name: `${localize("Save As")} ${format ? format.name : info.file_format}`,
			assume_saved: true, // prevent setting saved to false
		}, () => {
			main_ctx.copy(info.image || info.image_data);
		});
	});
}

function save_selection_to_file() {
	if (selection && selection.canvas) {
		systemHooks.showSaveFileDialog({
			dialogTitle: localize("Save As"),
			defaultFileName: "selection.png",
			defaultFileFormatID: "image/png",
			formats: image_formats,
			getBlob: (new_file_type) => {
				return new Promise((resolve) => {
					write_image_file(selection.canvas, new_file_type, (blob) => {
						resolve(blob);
					});
				});
			},
		});
	}
}

/**
 * @param {Blob} blob
 * @param {() => void} okay_callback
 * @param {number[]} [magic_number_bytes]
 * @param {boolean} [magic_wanted]
 */
function sanity_check_blob(blob, okay_callback, magic_number_bytes, magic_wanted = true) {
	if (blob.size > 0) {
		if (magic_number_bytes) {
			blob.arrayBuffer().then((arrayBuffer) => {
				const file_bytes = new Uint8Array(arrayBuffer);
				const magic_found = magic_number_bytes.every((byte, index) => byte === file_bytes[index]);
				// console.log(file_bytes, magic_number_bytes, magic_found, magic_wanted);
				if (magic_found === magic_wanted) {
					okay_callback();
				} else {
					showMessageBox({
						message: "Writing images in this file format is not supported.",
						iconID: "error",
					});
				}
			}, (error) => {
				show_error_message(localize("An unknown error has occurred."), error);
			});
		} else {
			okay_callback();
		}
	} else {
		show_error_message(localize("Failed to save document."));
	}
}

/**
 * @param {boolean} from_current_document
 */

export {
	apply_file_format_and_palette_info, are_you_sure, cancel, choose_file_to_paste, cleanup_bitmap_view, clear, delete_selection, deselect, detect_monochrome,
	edit_copy, edit_cut, edit_paste, file_new, file_open, file_print, file_save,
	file_save_as, getSelectionText, get_history_ancestors, get_tool_by_id, get_uris, go_to_history_node, has_any_transparency, image_attributes, image_flip_and_rotate, image_invert_colors, image_stretch_and_skew, load_image_from_uri, make_history_node, make_monochrome_palette, make_monochrome_pattern, make_opaque, make_or_update_undoable, meld_selection_into_canvas,
	meld_textbox_into_canvas, open_from_file, open_from_image_info, paste, paste_image_from_file, please_enter_a_number, read_image_file, redo, render_canvas_view, reset_canvas_and_history, reset_file, reset_selected_colors, resize_canvas_and_save_dimensions, resize_canvas_without_saving_dimensions, sanity_check_blob, save_selection_to_file, select_all, select_tool, select_tools, set_magnification, show_about_paint, show_convert_to_black_and_white, show_custom_zoom_window, show_error_message, show_file_format_errors, show_resource_load_error_message, toggle_grid,
	try_exec_command, undo, undoable, update_canvas_rect, update_disable_aa, update_from_saved_file, update_helper_layer,
	update_helper_layer_immediately, update_magnified_canvas_size, update_title, view_bitmap, write_image_file
};
// Temporary globals until all dependent code is converted to ES Modules
window.make_history_node = make_history_node; // used by app-state.js
window.open_from_file = open_from_file; // used by cassiel-integration.js
window.are_you_sure = are_you_sure; // used by cassiel-integration.js
window.show_error_message = show_error_message; // used by cassiel-integration.js
window.get_tool_by_id = get_tool_by_id; // used by app-state.js
window.make_monochrome_palette = make_monochrome_palette; // used by app-state.js

// #region Dialogs: the desktop's form dialogs (Cassiel's controls).

const plain = (label) => AccessKeys.toText(localize(label));

async function image_attributes() {
	const result = await window.cassiel.dialog.form({
		title: plain("Attributes"),
		fields: [
			{ type: "info", label: plain("Resolution:"), value: "72 x 72 dots per inch" },
			{ type: "number", name: "width", label: plain("&Width:"), value: main_canvas.width, min: 1, unit: plain("&Pixels") },
			{ type: "number", name: "height", label: plain("&Height:"), value: main_canvas.height, min: 1, unit: plain("&Pixels") },
			{ type: "radio", name: "colors", group: plain("Colors"), value: monochrome ? "monochrome" : "polychrome", options: [
				{ value: "monochrome", label: plain("&Black and white") },
				{ value: "polychrome", label: plain("Co&lors") },
			] },
			{ type: "radio", name: "transparency", group: plain("Transparency"), value: transparency ? "transparent" : "opaque", options: [
				{ value: "transparent", label: plain("Transparent") },
				{ value: "opaque", label: plain("Opaque") },
			] },
		],
		buttons: [
			{ label: plain("OK"), value: "ok", default: true },
			{ label: plain("Cancel"), cancel: true },
			{ label: plain("&Default"), set: { width: default_canvas_width, height: default_canvas_height } },
		],
	});
	if (!result) return;
	const { width, height, colors, transparency: transparency_option } = result.values;
	if (!(width > 0) || !(height > 0)) return please_enter_a_number();
	apply_image_attributes({ width: Number(width), height: Number(height), colors, transparency: transparency_option });
}

async function image_flip_and_rotate() {
	const result = await window.cassiel.dialog.form({
		title: plain("Flip and Rotate"),
		fields: [
			{ type: "radio", name: "action", group: plain("Flip or rotate"), value: "flip-horizontal", options: [
				{ value: "flip-horizontal", label: plain("&Flip horizontal") },
				{ value: "flip-vertical", label: plain("Flip &vertical") },
				{ value: "90", label: `${plain("&Rotate by angle")} 90°` },
				{ value: "180", label: `${plain("&Rotate by angle")} 180°` },
				{ value: "270", label: `${plain("&Rotate by angle")} 270°` },
				{ value: "arbitrary", label: `${plain("&Rotate by angle")}…` },
			] },
			{ type: "number", name: "angle", label: plain("Degrees"), value: 45, min: -360, max: 360, unit: "°", group: plain("Flip or rotate"), enabledWhen: ["action", "arbitrary"] },
		],
	});
	if (!result) return;
	const { action, angle } = result.values;
	if (action === "flip-horizontal") return flip_horizontal();
	if (action === "flip-vertical") return flip_vertical();
	const degrees = Number(action === "arbitrary" ? angle : action);
	if (isNaN(degrees)) return please_enter_a_number();
	rotate(degrees / 360 * TAU);
}

async function image_stretch_and_skew() {
	const result = await window.cassiel.dialog.form({
		title: plain("Stretch and Skew"),
		fields: [
			{ type: "number", name: "stretch_x", label: plain("&Horizontal:"), value: 100, min: 1, max: 5000, unit: "%", group: plain("Stretch") },
			{ type: "number", name: "stretch_y", label: plain("&Vertical:"), value: 100, min: 1, max: 5000, unit: "%", group: plain("Stretch") },
			{ type: "number", name: "skew_x", label: plain("H&orizontal:"), value: 0, min: -90, max: 90, unit: plain("Degrees"), group: plain("Skew") },
			{ type: "number", name: "skew_y", label: plain("V&ertical:"), value: 0, min: -90, max: 90, unit: plain("Degrees"), group: plain("Skew") },
		],
	});
	if (!result) return;
	const v = result.values;
	const [x_scale, y_scale, h_skew, v_skew] = [v.stretch_x / 100, v.stretch_y / 100, v.skew_x / 360 * TAU, v.skew_y / 360 * TAU].map(Number);
	if ([x_scale, y_scale, h_skew, v_skew].some(isNaN)) return please_enter_a_number();
	try {
		stretch_and_skew(x_scale, y_scale, h_skew, v_skew);
	} catch (exception) {
		show_error_message(localize("Insufficient memory to perform operation."), exception);
	}
}

async function show_convert_to_black_and_white() {
	const result = await window.cassiel.dialog.form({
		title: plain("Convert to Black and White"),
		fields: [
			{ type: "number", name: "threshold", label: plain("Threshold:"), value: 50, min: 0, max: 100, unit: "%" },
		],
	});
	if (!result) return;
	const threshold = Number(result.values.threshold) / 100;
	if (isNaN(threshold)) return please_enter_a_number();
	undoable({ name: "Make Monochrome" }, () => {
		threshold_black_and_white(main_ctx, threshold);
	});
}

async function show_custom_zoom_window() {
	const result = await window.cassiel.dialog.form({
		title: plain("Custom Zoom"),
		fields: [
			{ type: "info", label: plain("Current zoom:"), value: `${magnification * 100}%` },
			{ type: "radio", name: "zoom", group: plain("Zoom to"), value: String(magnification), options: [
				{ value: "1", label: "100%" }, { value: "2", label: "200%" }, { value: "4", label: "400%" },
				{ value: "6", label: "600%" }, { value: "8", label: "800%" }, { value: "custom", label: plain("C&ustom") },
			] },
			{ type: "number", name: "percent", label: plain("C&ustom"), value: magnification * 100, min: 10, max: 1000, unit: "%", group: plain("Zoom to"), enabledWhen: ["zoom", "custom"] },
		],
	});
	if (!result) return;
	const { zoom, percent } = result.values;
	const mag = zoom === "custom" ? Number(percent) / 100 : Number(zoom);
	if (isNaN(mag) || mag <= 0) return please_enter_a_number();
	set_magnification(mag);
}
// #endregion
