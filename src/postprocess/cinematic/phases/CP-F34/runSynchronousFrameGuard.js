import { requireSynchronous } from "./adapterValidation.js";

export function runSynchronousFrameGuard(guard, operation) {
  let invocationAllowed = true;
  let invocationCount = 0;
  let operationResult;
  let guardViolation = null;
  let guardResult;
  try {
    guardResult = requireSynchronous(guard(() => {
      if (!invocationAllowed || invocationCount !== 0) {
        guardViolation = new Error("Host must invoke the frame exactly once inside its synchronous state guard");
        throw guardViolation;
      }
      invocationCount += 1;
      operationResult = requireSynchronous(operation(), "Protected frame operation");
      return operationResult;
    }), "Host state guard");
  } finally {
    invocationAllowed = false;
  }
  if (guardViolation) throw guardViolation;
  if (invocationCount !== 1) throw new Error("Host state guard did not invoke the frame");
  if (guardResult !== operationResult) throw new Error("Host state guard changed the frame presentation result");
  return guardResult;
}
