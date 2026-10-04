// @ts-check
// Message boxes are the desktop's dialogs (cassiel.dialog.message): Paint asks with its
// usual showMessageBox({ title, message, buttons, iconID }) and gets back the value of
// the button clicked.

/**
 * @param {{ title?: string, message?: string, buttons?: { label: string, value: any, default?: boolean, cancel?: boolean }[], iconID?: string }} options
 * @returns {Promise<any>}
 */
function showMessageBox({ title = "Paint", message, buttons = [{ label: "OK", value: "ok", default: true }], iconID = "warning" }) {
	return window.cassiel.dialog.message({ title, text: message, icon: iconID === "nuke" ? "warning" : iconID, buttons });
}

export { showMessageBox };
// Temporary global until all dependent code is converted to ES Modules
window.showMessageBox = showMessageBox;
