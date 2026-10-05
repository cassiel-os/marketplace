// Paint on Cassiel: opening, saving, dialogs, the window title, unsaved-work checks
// and the wallpaper go through the Cassiel SDK (/sdk/cassiel.js), so Paint uses the
// desktop's own file dialogs and message boxes, and reads and writes the person's
// files. Loaded before the app's code: jspaint picks these hooks up as it starts.
/* global cassiel, open_from_file, get_format_from_extension, are_you_sure, saved, show_error_message */
(() => {
	const sdk = window.cassiel;
	// Paint's modules sit next to this script (a classic script's relative imports
	// resolve against the page, not the script).
	const here = document.currentScript.src;

	const MIME = { png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", gif: "image/gif", bmp: "image/bmp", webp: "image/webp", tif: "image/tiff", tiff: "image/tiff", ico: "image/x-icon", svg: "image/svg+xml" };
	const extension = (name) => (name.includes(".") ? name.split(".").pop().toLowerCase() : "");

	const toBase64 = (blob) => new Promise((resolve, reject) => {
		const reader = new FileReader();
		reader.onload = () => resolve(String(reader.result).split(",")[1] ?? "");
		reader.onerror = () => reject(reader.error);
		reader.readAsDataURL(blob);
	});
	const read = async (path) => {
		const { data } = await sdk.files.readBytes(path);
		const binary = atob(data);
		const bytes = new Uint8Array(binary.length);
		for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
		const name = path.split("/").pop();
		return new File([bytes], name, { type: MIME[extension(name)] ?? "application/octet-stream" });
	};
	// Cassiel's dialogs list types by extension; jspaint's formats carry them.
	const typesOf = (formats) => formats.map((format) => ({ label: format.name, extensions: format.extensions }));
	// A cancelled dialog: jspaint treats a promise that never settles as "nothing happened".
	const never = () => new Promise(() => { });

	window.systemHooks = {
		showSaveFileDialog: async ({ formats, defaultFileName, defaultFileFormatID, getBlob, savedCallbackUnreliable, dialogTitle }) => {
			// The current format first, so it is the one selected.
			const ordered = [...formats].sort((a, b) => Number(b.formatID === defaultFileFormatID) - Number(a.formatID === defaultFileFormatID));
			const picked = await sdk.dialog.saveFile({ title: dialogTitle, name: defaultFileName, types: typesOf(ordered) });
			if (!picked) return;
			const format = get_format_from_extension(formats, picked.name) || ordered[0];
			const blob = await getBlob(format.formatID);
			try {
				await sdk.files.writeBytes(picked.path, await toBase64(blob));
			} catch (error) {
				return show_error_message(`Couldn't save ${picked.name}.`, error);
			}
			savedCallbackUnreliable?.({ newFileName: picked.name, newFileFormatID: format.formatID, newFileHandle: picked.path, newBlob: blob });
		},
		showOpenFileDialog: async ({ formats }) => {
			const picked = await sdk.dialog.openFile({ types: typesOf(formats) });
			if (!picked) return never();
			return { file: await read(picked.path), fileHandle: picked.path };
		},
		writeBlobToHandle: async (path, blob) => {
			try {
				await sdk.files.writeBytes(path, await toBase64(blob));
				return true;
			} catch (error) {
				show_error_message("Couldn't save the picture.", error);
				return false;
			}
		},
		readBlobFromHandle: (path) => read(path),
		setWallpaperTiled: (canvas) => setWallpaper(canvas, "tile"),
		setWallpaperCentered: (canvas) => setWallpaper(canvas, "center"),
	};
	const setWallpaper = (canvas, position) =>
		canvas.toBlob(async (blob) => {
			try {
				await sdk.desktop.setWallpaper(await toBase64(blob), position);
			} catch (error) {
				show_error_message("Couldn't set the wallpaper.", error);
			}
		}, "image/png");

	// The window's title follows the picture's, and closing with unsaved changes asks
	// first (jspaint calls these as its title or saved state change).
	window.setRepresentedFilename = () => sdk.setTitle(document.title);
	let guarding = false;
	window.setDocumentEdited = (edited) => {
		sdk.setTitle(document.title);
		if (edited === guarding) return;
		guarding = edited;
		sdk.onBeforeClose(edited ? () => new Promise((resolve) => are_you_sure(() => resolve(true), () => resolve(false))) : null);
	};

	// What Cassiel (the assistant) can do in Paint while it is open. Each returns a
	// short sentence the assistant reads back.
	/* global main_canvas, file_name */
	const register = async () => {
		// Paint's functions are module exports (main_canvas and file_name are globals). The
		// package bundles the modules and hands them over as window.paintModules (importing
		// the files again would make a second Paint, with its own state). The import is for
		// running from the sources, unbundled; the package has no src/functions.js.
		const module = (name) => window.paintModules?.[name] ?? import(new URL(name, here).href);
		const { file_new, file_save, image_invert_colors, clear, resize_canvas_and_save_dimensions } = await module("functions.js");
		const { flip_horizontal, flip_vertical, rotate } = await module("image-manipulation.js");
		const size = () => `${main_canvas.width} × ${main_canvas.height}`;
		sdk.actions.register("new_image", {
			description: "Starts a new blank picture (asks to save the current one if it changed); optionally its size in pixels.",
			params: { width: "pixels (optional)", height: "pixels (optional)" },
			run: async ({ width, height }) => {
				file_new();
				if (width && height) resize_canvas_and_save_dimensions(Number(width), Number(height));
				return `new picture, ${size()}`;
			},
		});
		sdk.actions.register("resize_canvas", {
			description: "Changes the picture's size in pixels (cropping or extending it).",
			params: { width: "pixels", height: "pixels" },
			run: async ({ width, height }) => {
				resize_canvas_and_save_dimensions(Number(width), Number(height));
				return `picture is now ${size()}`;
			},
		});
		sdk.actions.register("save", {
			description: "Saves the picture (asks where the first time).",
			run: async () => (file_save(), `saving ${file_name}`),
		});
		sdk.actions.register("invert_colors", { description: "Inverts the picture's colors.", run: async () => (image_invert_colors(), "colors inverted") });
		sdk.actions.register("clear", { description: "Clears the picture to the background color.", run: async () => (clear(), "picture cleared") });
		sdk.actions.register("flip", {
			description: "Flips the picture.",
			params: { direction: "horizontal or vertical" },
			run: async ({ direction }) => (direction === "vertical" ? flip_vertical() : flip_horizontal(), `flipped ${direction === "vertical" ? "vertically" : "horizontally"}`),
		});
		sdk.actions.register("rotate", {
			description: "Rotates the picture.",
			params: { degrees: "90, 180 or 270" },
			run: async ({ degrees }) => (rotate((Number(degrees) * Math.PI) / 180), `rotated ${degrees}°`),
		});
		sdk.actions.register("set_wallpaper", {
			description: "Puts the picture on the desktop as its wallpaper.",
			params: { position: "center or tile" },
			run: async ({ position }) => (setWallpaper(main_canvas, position === "tile" ? "tile" : "center"), "wallpaper set"),
		});
	};
	const registerSafely = () => register().catch((error) => console.error("Paint: couldn't offer its actions to Cassiel", error));
	if (document.readyState === "complete") registerSafely();
	else addEventListener("load", registerSafely, { once: true });

	// The file Paint was opened with is opened by app.js (initial_system_file_handle).
})();
