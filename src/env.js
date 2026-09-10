'use strict';
// wake-veil 沙盒环境注入层
// 调用方在 require('./shim') 之后先 require('./env')，
// 把 ShimBuffer 挂到 globalThis.Buffer，把 process 挂到 globalThis.process
const { ShimBuffer, process, ShimAbortController, ShimAbortSignal } = require('./shim');

if (typeof globalThis.Buffer === 'undefined' || !globalThis.Buffer.alloc) {
  globalThis.Buffer = ShimBuffer;
}
if (typeof globalThis.process === 'undefined' || typeof globalThis.process.pid !== 'number') {
  globalThis.process = process;
}
if (typeof globalThis.AbortController === 'undefined') {
  globalThis.AbortController = ShimAbortController;
  globalThis.AbortSignal = ShimAbortSignal;
}
// 保守起见暴露一个模块级引用，源文件可直接解构
module.exports = { ShimBuffer, process };