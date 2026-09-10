"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.registerToolPkg = registerToolPkg;
function registerToolPkg() {
  try {
    var uiModule = require("./ui/index.ui.js");
    ToolPkg.registerToolboxUiModule({
      id: "wake_veil_settings",
      runtime: "compose_dsl",
      screen: uiModule.default || uiModule,
      params: {},
      title: { zh: "唤醒次数调节", en: "Wake Veil Settings" },
    });
  } catch (e) {}
  return true;
}
