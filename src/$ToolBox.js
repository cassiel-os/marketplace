// @ts-check
/* global $canvas, $left, $status_text, localize, main_canvas, return_to_tools, selected_tool, selected_tools */
import { $Component } from "./$Component.js";
import { select_tool, select_tools } from "./functions.js";
import { E, make_css_cursor } from "./helpers.js";

/**
 * @param {Tool[]} tools
 * @param {boolean=} is_extras
 * @returns {JQuery<HTMLDivElement> & I$ToolBox & I$Component}
 */
function $ToolBox(tools, is_extras) {
	const $tools = $(E("div")).addClass("tools");
	const $tool_options = $(E("div")).addClass("tool-options");

	let showing_tooltips = false;
	$tools.on("pointerleave", () => {
		showing_tooltips = false;
		$status_text.default();
	});

	const $buttons = $($.map(tools, (tool, i) => {
		const $b = $(E("div")).addClass("tool");
		$b.appendTo($tools);
		tool.$button = $b;

		$b.attr("data-tooltip", tool.name);

		$(E("span")).addClass("tool-icon").appendTo($b).css({
			display: "block",
			position: "absolute",
			left: 4,
			top: 4,
			width: 16,
			height: 16,
			"--icon-index": i.toString(),
		});

		$b.on("click", (e) => {
			if (e.shiftKey || e.ctrlKey) {
				select_tool(tool, true);
				return;
			}
			if (selected_tool === tool && tool.deselect) {
				select_tools(return_to_tools);
			} else {
				select_tool(tool);
			}
		});

		$b.on("pointerenter", () => {
			const show_tooltip = () => {
				showing_tooltips = true;
				$status_text.text(tool.description);
			};
			if (showing_tooltips) {
				show_tooltip();
			} else {
				const tid = setTimeout(show_tooltip, 300);
				$b.on("pointerleave", () => {
					clearTimeout(tid);
				});
			}
		});

		return $b[0];
	}));

	/**
	 * @typedef {Object} I$ToolBox
	 * @prop {() => void} update_selected_tool
	 */

	const $c = /** @type {JQuery<HTMLDivElement> & I$Component & I$ToolBox} **/ ($Component(
		is_extras ? "tools-component extra-tools-component" : "tools-component",
		"tall",
		$tools.add($tool_options)
	));
	$c.appendTo($left);
	$c.update_selected_tool = () => {
		$buttons.removeClass("selected");
		selected_tools.forEach((selected_tool) => {
			selected_tool.$button.addClass("selected");
		});
		$tool_options.children().detach();
		$tool_options.append(selected_tool.$options);
		$tool_options.children().trigger("update");
		$canvas.css({
			cursor: make_css_cursor(...selected_tool.cursor),
		});
	};
	$c.update_selected_tool();

	if (is_extras) {
		$c.height(80);
	}

	return $c;
}

export { $ToolBox };

