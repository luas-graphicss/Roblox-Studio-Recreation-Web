export function withShaderFailureGuard(adapter, operation) {
  const debug = adapter.renderer?.debug;
  const previousHandler = debug?.onShaderError;
  const previousCheck = debug?.checkShaderErrors;
  const failures = [];
  if (debug) {
    debug.checkShaderErrors = true;
    debug.onShaderError = (context, program, vertex, fragment) => {
      failures.push({
        program: context.getProgramInfoLog(program),
        vertex: context.getShaderInfoLog(vertex),
        fragment: context.getShaderInfoLog(fragment)
      });
    };
  }
  try {
    if (adapter.context?.isContextLost?.())
      throw new Error("Shader operation attempted on a lost context");
    const result = operation();
    if (result && typeof result.then === "function")
      throw new TypeError("Shader operations must be synchronous");
    if (failures.length) throw new Error(`Shader compilation failed: ${JSON.stringify(failures)}`);
    return result;
  } finally {
    if (debug) {
      debug.onShaderError = previousHandler;
      debug.checkShaderErrors = previousCheck;
    }
  }
}
