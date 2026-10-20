import { parseIesText, iesProfileToCell } from "../lighting/iesCookieCore.js";

self.onmessage = (event) => {
  const request = event.data || {};
  try {
    const profile = parseIesText(request.text);
    if (!profile.ok) {
      self.postMessage({ id: request.id, ok: false, error: profile.error });
      return;
    }
    const cell = iesProfileToCell(profile);
    self.postMessage(
      {
        id: request.id,
        ok: true,
        cell: cell.buffer,
        meta: { nV: profile.nV, nH: profile.nH, maxCandela: profile.maxCandela, photometricType: profile.photometricType },
      },
      [cell.buffer],
    );
  } catch (error) {
    self.postMessage({ id: request.id, ok: false, error: String((error && error.message) || error) });
  }
};
