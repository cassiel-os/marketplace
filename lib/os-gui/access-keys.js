// AccessKeys, from OS-GUI.js's MenuBar.js (1j01/os-gui, MIT): labels with an access key
// ("&File"). Paint's menus are drawn by Cassiel; its windows and dialogs still use this.
((exports) => {

/**
 * @template {keyof HTMLElementTagNameMap} K
 * @param {K} tagName
 * @param {Record<string, string>} [attrs]
 * @returns {HTMLElementTagNameMap[K]}
 */
function E(tagName, attrs) {
	const el = document.createElement(tagName);
	if (attrs) {
		for (const key in attrs) {
			if (key === "class") {
				el.className = attrs[key];
			} else {
				el.setAttribute(key, attrs[key]);
			}
		}
	}
	return el;
}

let uid_counter = 0;

/** @type {AccessKeys} */
const AccessKeys = {
	escape: function (label) {
		// Escapes all ampersands in the label, so that they are not treated as access keys.
		// Useful for dynamic menus like a list of history entries, where page titles shouldn't be spuriously interpreted as having access keys.
		// Double ampersands are still escaped ("&&" becomes "&&&&"), so that "&&" isn't spuriously interpreted as "&".
		return label.replace(/&/g, "&&");
	},
	unescape: function (label) {
		// Un-escapes all double ampersands in the label.
		// For rendering, use toHTML() or toFragment() instead.
		return label.replace(/&&/g, "&");
	},
	indexOf: function (label) {
		// Returns the index of the ampersand that defines an access key, or -1 if not present.

		// return label.search(/(?<!&)&(?!&|\s)/); // not enough browser support for negative lookbehind assertions

		// The space here handles beginning-of-string matching and counteracts the offset for the [^&] so it acts like a negative lookbehind
		return ` ${label}`.search(/[^&]&[^&\s]/);
	},
	has: function (label) {
		// Returns true if the label has an access key.
		return this.indexOf(label) >= 0;
	},
	get: function (label) {
		// Returns the access key for the label, or null if none.
		// Used by MenuBar and MenuPopup to trigger the menu item with the access key.
		// Can be used for handling access keys in other UI, for example in form labels.
		const index = this.indexOf(label);
		if (index >= 0) {
			return label.charAt(index + 1).toUpperCase();
		}
		return null;
	},
	remove: function (label) {
		// Removes the access key from the label.
		// Like toText() but with a special case to remove parentheticals like " (&N)".
		const parentheticalRegex = /\s?\(&[^&]\)/;
		if (parentheticalRegex.test(label)) {
			return this.unescape(label.replace(parentheticalRegex, ""));
		}
		return this.toText(label);
	},
	toText: function (label) {
		// Removes the access key indicator from the label.
		// This is like toHTML() but for plain text.
		// Note: while often access keys are part of a word, like "&New",
		// in translations they are often indicated separately, like "새로 만들기 (&N)",
		// since the access key stays the same, but the letter is no longer part of the word (or even the alphabet).
		// This doesn't remove strings like " (&N)", it will just remove the "&" and leave "새로 만들기 (N)".
		const index = this.indexOf(label);
		if (index >= 0) {
			return this.unescape(label.substring(0, index)) + this.unescape(label.substring(index + 1));
		}
		return this.unescape(label);
		// old version, not un-escaping:
		// return label.replace(/\s?\(&.\)/, "").replace(/([^&]|^)&([^&\s])/, "$1$2");
	},
	toHTML: function (label) {
		// Returns the label with the access key underlined (or with whatever .menu-hotkey styling), HTML-escaped.
		const fragment = this.toFragment(label);
		const dummy = document.createElement("div");
		dummy.appendChild(fragment);
		return dummy.innerHTML;

		// old version, not escaping HTML:
		// return label.replace(/([^&]|^)&([^&\s])/, "$1<span class='menu-hotkey'>$2</span>").replace(/&&/g, "&");

		// alternative version, building an HTML string:
		// const index = this.indexOf(label);
		// if (index >= 0) {
		// 	return escapeHTML(this.unescape(label.substring(0, index))) + "<u>" + escapeHTML(label.charAt(index + 1)) + "</u>" + escapeHTML(this.unescape(label.substring(index + 2)));
		// } else {
		// 	return escapeHTML(this.unescape(label));
		// }
	},
	toFragment: function (label) {
		// Returns a DocumentFragment of the label with the access key underlined (or with whatever .menu-hotkey styling)
		const fragment = document.createDocumentFragment();
		const index = this.indexOf(label);
		if (index >= 0) {
			fragment.appendChild(document.createTextNode(this.unescape(label.substring(0, index))));
			// TODO: change class to .access-key, because they can appear outside menus, and "hotkey" is too generic
			// also, I could use the <u> tag, since that gives the default styling (but then it'd have to be reset if you don't want it...)
			const span = E("span", { class: "menu-hotkey" });
			span.appendChild(document.createTextNode(label.charAt(index + 1)));
			fragment.appendChild(span);
			fragment.appendChild(document.createTextNode(this.unescape(label.substring(index + 2))));
		} else {
			fragment.appendChild(document.createTextNode(this.unescape(label)));
		}
		return fragment;
	},
};

// @TODO: support dynamic menus (e.g. a list of history entries, contextually shown options, or a contextually named "Undo <action>" label; Explorer has all these things)

exports.AccessKeys = AccessKeys;

// @ts-ignore
})(typeof module !== "undefined" ? module.exports : window);
