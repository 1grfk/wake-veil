"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.registerToolPkg = registerToolPkg;
function registerToolPkg() {
  try {
    var uiModule = require("./ui/index.ui.js");
    ToolPkg.registerToolboxUiModule({
      id: "brother_ledger",
      runtime: "compose_dsl",
      screen: uiModule.default || uiModule,
      params: {},
      title: { zh: "哥哥的消费本", en: "Brother's Ledger" },
    });
  } catch (e) {}
  return true;
}