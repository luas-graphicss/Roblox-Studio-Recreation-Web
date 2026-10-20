export const APP_NAME = "Roblox Studio Web";
export const APP_VERSION = "1.2.0";
export const BUILD_DATE = "2026-09-01";
export const CREDITS = "Recreation project \u2014 not affiliated with Roblox Corporation";

export const LUAU_ENGINE = Object.freeze({
  name: "RSW Luau Interpreter (built-in)",
  version: APP_VERSION,
});

export const PHYSICS_ENGINE = Object.freeze({
  name: "RSW Physics (built-in)",
  version: APP_VERSION,
});

const MIT_TEXT =
  "Permission is hereby granted, free of charge, to any person obtaining a copy of this software and " +
  "associated documentation files (the \"Software\"), to deal in the Software without restriction, " +
  "including without limitation the rights to use, copy, modify, merge, publish, distribute, sublicense, " +
  "and/or sell copies of the Software, and to permit persons to whom the Software is furnished to do so, " +
  "subject to the following conditions:\n\nThe above copyright notice and this permission notice shall be " +
  "included in all copies or substantial portions of the Software.\n\nTHE SOFTWARE IS PROVIDED \"AS IS\", " +
  "WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF " +
  "MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR " +
  "COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, " +
  "TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS " +
  "IN THE SOFTWARE.";

export const LIBRARIES = Object.freeze([
  Object.freeze({
    name: "Three.js",
    version: "0.161.0",
    role: "3D rendering engine (WebGL)",
    license: "MIT License",
    copyright: "Copyright (c) 2010-2026 three.js authors",
    text: MIT_TEXT,
  }),
  Object.freeze({
    name: "Monaco Editor",
    version: "bundled",
    role: "Script editor component",
    license: "MIT License",
    copyright: "Copyright (c) Microsoft Corporation",
    text: MIT_TEXT,
  }),
  Object.freeze({
    name: "RSW Luau Interpreter",
    version: APP_VERSION,
    role: "Luau scripting engine (built-in module)",
    license: "Project license",
    copyright: "Part of the Roblox Studio Web recreation project.",
    text: "Built-in module developed for this recreation project. Provided as-is, for educational purposes only.",
  }),
  Object.freeze({
    name: "RSW Physics",
    version: APP_VERSION,
    role: "Physics simulation engine (built-in module)",
    license: "Project license",
    copyright: "Part of the Roblox Studio Web recreation project.",
    text: "Built-in module developed for this recreation project. Provided as-is, for educational purposes only.",
  }),
]);
