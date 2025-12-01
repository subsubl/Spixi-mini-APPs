async function instantiate(module, imports = {}) {
  const adaptedImports = {
    env: Object.assign(Object.create(globalThis), imports.env || {}, {
      abort(message, fileName, lineNumber, columnNumber) {
        // ~lib/builtins/abort(~lib/string/String | null?, ~lib/string/String | null?, u32?, u32?) => void
        message = __liftString(message >>> 0);
        fileName = __liftString(fileName >>> 0);
        lineNumber = lineNumber >>> 0;
        columnNumber = columnNumber >>> 0;
        (() => {
          // @external.js
          throw Error(`${message} in ${fileName}:${lineNumber}:${columnNumber}`);
        })();
      },
    }),
  };
  const { exports } = await WebAssembly.instantiate(module, adaptedImports);
  const memory = exports.memory || imports.env.memory;
  const adaptedExports = Object.setPrototypeOf({
    ball: {
      // assembly/index/ball: assembly/index/Ball
      valueOf() { return this.value; },
      get value() {
        return __liftRecord4(exports.ball.value >>> 0);
      }
    },
    localPaddle: {
      // assembly/index/localPaddle: assembly/index/Paddle
      valueOf() { return this.value; },
      get value() {
        return __liftRecord5(exports.localPaddle.value >>> 0);
      }
    },
    remotePaddle: {
      // assembly/index/remotePaddle: assembly/index/Paddle
      valueOf() { return this.value; },
      get value() {
        return __liftRecord5(exports.remotePaddle.value >>> 0);
      }
    },
  }, exports);
  function __liftRecord4(pointer) {
    // assembly/index/Ball
    // Hint: Opt-out from lifting as a record by providing an empty constructor
    if (!pointer) return null;
    return {
      x: __getF64(pointer + 0),
      y: __getF64(pointer + 8),
      vx: __getF64(pointer + 16),
      vy: __getF64(pointer + 24),
    };
  }
  function __liftRecord5(pointer) {
    // assembly/index/Paddle
    // Hint: Opt-out from lifting as a record by providing an empty constructor
    if (!pointer) return null;
    return {
      y: __getF64(pointer + 0),
      lives: __getI32(pointer + 8),
    };
  }
  function __liftString(pointer) {
    if (!pointer) return null;
    const
      end = pointer + new Uint32Array(memory.buffer)[pointer - 4 >>> 2] >>> 1,
      memoryU16 = new Uint16Array(memory.buffer);
    let
      start = pointer >>> 1,
      string = "";
    while (end - start > 1024) string += String.fromCharCode(...memoryU16.subarray(start, start += 1024));
    return string + String.fromCharCode(...memoryU16.subarray(start, end));
  }
  let __dataview = new DataView(memory.buffer);
  function __getI32(pointer) {
    try {
      return __dataview.getInt32(pointer, true);
    } catch {
      __dataview = new DataView(memory.buffer);
      return __dataview.getInt32(pointer, true);
    }
  }
  function __getF64(pointer) {
    try {
      return __dataview.getFloat64(pointer, true);
    } catch {
      __dataview = new DataView(memory.buffer);
      return __dataview.getFloat64(pointer, true);
    }
  }
  return adaptedExports;
}
export const {
  memory,
  ball,
  localPaddle,
  remotePaddle,
  init,
  update,
  setPaddleY,
  setRemotePaddleY,
  setBallState,
} = await (async url => instantiate(
  await (async () => {
    const isNodeOrBun = typeof process != "undefined" && process.versions != null && (process.versions.node != null || process.versions.bun != null);
    if (isNodeOrBun) { return globalThis.WebAssembly.compile(await (await import("node:fs/promises")).readFile(url)); }
    else { return await globalThis.WebAssembly.compileStreaming(globalThis.fetch(url)); }
  })(), {
  }
))(new URL("pong.wasm", import.meta.url));
