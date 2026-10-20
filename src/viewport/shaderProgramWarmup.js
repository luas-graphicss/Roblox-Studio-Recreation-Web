function isLiveProgram(program) {
  return program && (typeof program === 'object' || typeof program === 'function') &&
    (!('program' in program) || program.program != null);
}

export function createShaderProgramWarmup({ readPrograms = () => [] } = {}) {
  const preparedPrograms = new WeakSet();

  function step() {
    let waitingForLink = false;
    for (const program of readPrograms()) {
      if (!isLiveProgram(program) || preparedPrograms.has(program)) continue;
      if (program.isReady?.() === false) {
        waitingForLink = true;
        continue;
      }
      program.getUniforms?.();
      program.getAttributes?.();
      if (program.diagnostics?.runnable === false) {
        throw new Error(`Shader program "${program.name || program.id || 'unnamed'}" could not be prepared.`);
      }
      preparedPrograms.add(program);
      return false;
    }
    return !waitingForLink;
  }

  function getProgress() {
    let total = 0;
    let completed = 0;
    for (const program of readPrograms()) {
      if (!isLiveProgram(program)) continue;
      total += 1;
      if (preparedPrograms.has(program)) completed += 1;
    }
    return total === 0 ? 1 : completed / total;
  }

  return Object.freeze({ step, getProgress });
}
