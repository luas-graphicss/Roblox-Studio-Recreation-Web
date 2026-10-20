import { inspectResource } from "./resourceAudit.js";

export function createExecutionRecorder(
  adapter,
  {
    capturePixels = true,
    capacity = 4096,
    clock = () => performance.now(),
  } = {},
) {
  if (
    !adapter ||
    !Number.isInteger(capacity) ||
    capacity < 1 ||
    typeof capturePixels !== "boolean" ||
    typeof clock !== "function"
  )
    throw new TypeError("Invalid execution recorder configuration");
  const records = [];
  let activeRecord = null;
  let droppedRecords = 0;
  let sampling = capturePixels;
  const instrumentedAdapter = Object.freeze({
    ...adapter,
    draw(...args) {
      const result = adapter.draw(...args);
      if (activeRecord) activeRecord.draws++;
      return result;
    },
  });

  function wrapPhase(phase) {
    return Object.freeze({
      ...phase,
      install(services) {
        const register = services.graph.register;
        return phase.install(
          Object.freeze({
            ...services,
            rendererAdapter: instrumentedAdapter,
            graph: Object.freeze({
              register(pass) {
                return register({
                  ...pass,
                  execute(context) {
                    if (activeRecord)
                      throw new Error(
                        "Nested pass execution cannot be audited safely",
                      );
                    const record = {
                      id: pass.id,
                      owner: pass.owner,
                      stage: pass.stage,
                      frameId: context.frame.frameId,
                      viewId: context.frame.viewId,
                      generation: context.frame.generation,
                      transformsColor: pass.transformsColor === true,
                      reads: [...pass.reads],
                      writes: [],
                      draws: 0,
                      status: "running",
                      cpuSubmissionMs: null,
                      diagnosticReadback: sampling,
                    };
                    const publishedResources = new Map();
                    const started = clock();
                    activeRecord = record;
                    try {
                      const result = pass.execute(
                        Object.freeze({
                          ...context,
                          rendererAdapter: instrumentedAdapter,
                          publish(name, resource) {
                            context.publish(name, resource);
                            publishedResources.set(name, resource);
                            try {
                              record.writes.push(
                                inspectResource(
                                  resource,
                                  context.frame,
                                  name,
                                  adapter,
                                  sampling && Boolean(resource.texture),
                                ),
                              );
                            } catch (error) {
                              record.writes.push({
                                name,
                                status: "readback-failed",
                                pixelProof: false,
                                message: error.message,
                              });
                              throw error;
                            }
                          },
                        }),
                      );
                      if (result && typeof result.then === "function")
                        throw new Error(
                          "Audited passes must submit synchronously",
                        );
                      if (
                        pass.writes.some(
                          (name) =>
                            !record.writes.some((write) => write.name === name),
                        )
                      )
                        throw new Error(
                          "Audited pass omitted a declared output",
                        );
                      if (
                        pass.transformsColor &&
                        (!result?.color?.texture ||
                          result.color.texture === context.color?.texture ||
                          ![...publishedResources.values()].includes(
                            result.color,
                          ))
                      )
                        throw new Error(
                          "Audited color transform must return its distinct published texture",
                        );
                      if (!pass.transformsColor && result?.color)
                        throw new Error(
                          "Audited pass returned an undeclared color transform",
                        );
                      record.status = "executed";
                      return result;
                    } catch (error) {
                      record.status = "failed";
                      record.error = error.message;
                      throw error;
                    } finally {
                      record.cpuElapsedMs = clock() - started;
                      record.cpuSubmissionMs = sampling
                        ? null
                        : record.cpuElapsedMs;
                      record.timingScope = sampling
                        ? "submission-with-diagnostic-readback"
                        : "CPU submission only";
                      activeRecord = null;
                      if (records.length === capacity) {
                        records.shift();
                        droppedRecords++;
                      }
                      records.push(record);
                    }
                  },
                });
              },
            }),
          }),
        );
      },
    });
  }

  return Object.freeze({
    adapter: instrumentedAdapter,
    wrapPhase,
    snapshot: () => structuredClone(records),
    clear() {
      if (activeRecord) throw new Error("Cannot clear an executing recorder");
      records.length = 0;
      droppedRecords = 0;
    },
    setPixelSampling(enabled) {
      if (typeof enabled !== "boolean" || activeRecord)
        throw new TypeError(
          "Pixel sampling changes require an idle recorder and boolean",
        );
      sampling = enabled;
    },
    stats: () => ({
      records: records.length,
      droppedRecords,
      capturePixels: sampling,
    }),
  });
}
