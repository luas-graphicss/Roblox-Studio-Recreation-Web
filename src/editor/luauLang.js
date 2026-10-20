export const LUAU_LANGUAGE_ID = "luau";


export const luauKeywords = [
  "and", "break", "continue", "do", "else", "elseif", "end", "false",
  "for", "function", "if", "in", "local", "nil", "not", "or", "repeat",
  "return", "then", "true", "until", "while", "export", "type",
];


export const builtinTypes = [
  "string", "number", "boolean", "table", "function", "thread",
  "userdata", "any", "never", "unknown", "void",
];


export const robloxGlobals = [
  "game", "workspace", "script", "print", "warn", "error", "tostring",
  "tonumber", "typeof", "type", "ipairs", "pairs", "next", "select",
  "unpack", "table", "string", "math", "os", "task", "wait", "tick",
  "time", "delay", "spawn", "Instance", "Vector3", "Vector2", "CFrame",
  "Color3", "BrickColor", "UDim2", "UDim", "TweenInfo", "Enum", "Axes",
  "Faces", "NumberRange", "NumberSequence", "ColorSequence", "Ray",
  "Region3", "RaycastParams", "OverlapParams",

  "RemoteEvent", "RemoteFunction", "BindableEvent", "BindableFunction",
  "FireServer", "FireClient", "FireAllClients", "InvokeServer", "InvokeClient",
  "OnServerEvent", "OnClientEvent", "OnServerInvoke", "OnClientInvoke",
  "OnInvoke", "Event", "Fire", "Invoke", "Connect",
];



export const remoteApiCompletions = [
  { label: "RemoteEvent", kind: "class", detail: "Instance — comunicação Client<->Server" },
  { label: "RemoteFunction", kind: "class", detail: "Instance — chamada com retorno Client<->Server" },
  { label: "BindableEvent", kind: "class", detail: "Instance — evento no mesmo contexto" },
  { label: "BindableFunction", kind: "class", detail: "Instance — função no mesmo contexto" },
  { label: "FireServer", kind: "method", detail: "RemoteEvent:FireServer(...) — só no Client" },
  { label: "FireClient", kind: "method", detail: "RemoteEvent:FireClient(player, ...) — só no Server" },
  { label: "FireAllClients", kind: "method", detail: "RemoteEvent:FireAllClients(...) — só no Server" },
  { label: "InvokeServer", kind: "method", detail: "RemoteFunction:InvokeServer(...) — só no Client" },
  { label: "InvokeClient", kind: "method", detail: "RemoteFunction:InvokeClient(player, ...) — só no Server" },
  { label: "OnServerEvent", kind: "event", detail: "RemoteEvent.OnServerEvent:Connect(fn(player, ...))" },
  { label: "OnClientEvent", kind: "event", detail: "RemoteEvent.OnClientEvent:Connect(fn(...))" },
  { label: "OnServerInvoke", kind: "property", detail: "RemoteFunction.OnServerInvoke = fn(player, ...)" },
  { label: "OnClientInvoke", kind: "property", detail: "RemoteFunction.OnClientInvoke = fn(...)" },
  { label: "Event", kind: "event", detail: "BindableEvent.Event:Connect(fn(...))" },
  { label: "Fire", kind: "method", detail: "BindableEvent:Fire(...)" },
  { label: "Invoke", kind: "method", detail: "BindableFunction:Invoke(...)" },
  { label: "OnInvoke", kind: "property", detail: "BindableFunction.OnInvoke = fn(...)" },
];


export const luauOperators = [
  "+", "-", "*", "/", "//", "%", "^", "#", "..", "~",
  "==", "~=", "<", ">", "<=", ">=", "=",
];


export const luauLanguageConfig = {
  comments: {
    lineComment: "--",
    blockComment: ["--[[", "]]"],
  },
  brackets: [
    ["{", "}"],
    ["[", "]"],
    ["(", ")"],
  ],
  autoClosingPairs: [
    { open: "{", close: "}" },
    { open: "[", close: "]" },
    { open: "(", close: ")" },
    { open: '"', close: '"', notIn: ["string"] },
    { open: "'", close: "'", notIn: ["string"] },
  ],
  surroundingPairs: [
    { open: "{", close: "}" },
    { open: "[", close: "]" },
    { open: "(", close: ")" },
    { open: '"', close: '"' },
    { open: "'", close: "'" },
  ],

  indentationRules: {
    increaseIndentPattern:
      /^((?!(--)).)*(\b(else|elseif|repeat)\b\s*$|\b(then|do)\b\s*$|[{(\[]\s*$|\bfunction\b[^()]*\([^)]*\)\s*(:.*)?$)/,
    decreaseIndentPattern: /^\s*(\b(end|else|elseif|until)\b|[}\)\]]).*$/,
  },

  folding: {
    markers: {
      start: /^\s*--\s*#?region\b/,
      end: /^\s*--\s*#?endregion\b/,
    },
  },
};


export const luauMonarchTokens = {
  defaultToken: "",
  tokenPostfix: ".luau",
  ignoreCase: false,

  keywords: luauKeywords,
  builtinTypes: builtinTypes,
  globals: robloxGlobals,
  operators: luauOperators,


  symbols: /[=><!~?:&|+\-*\/\^%#.]+/,
  escapes: /\\(?:[abfnrtv\\"'0-9]|x[0-9A-Fa-f]{2}|u\{[0-9A-Fa-f]+\}|z)/,

  tokenizer: {
    root: [

      [/--\[(=*)\[/, { token: "comment", next: "@longcomment.$1" }],


      [/--!(?:strict|nonstrict|nocheck)\b.*$/, "keyword.directive"],

      [/--.*$/, "comment"],


      [/\[(=*)\[/, { token: "string", next: "@longstring.$1" }],


      [/[a-zA-Z_]\w*/, {
        cases: {
          "@keywords": "keyword",
          "@builtinTypes": "type",
          "@globals": "variable.predefined",
          "@default": "identifier",
        },
      }],


      { include: "@numbers" },


      [/"/, { token: "string.quote", next: "@string_double" }],
      [/'/, { token: "string.quote", next: "@string_single" }],


      [/@symbols/, {
        cases: {
          "@operators": "operator",
          "@default": "",
        },
      }],


      [/[{}()\[\]]/, "@brackets"],
      [/[;,]/, "delimiter"],


      [/[ \t\r\n]+/, "white"],
    ],

    numbers: [
      [/0[xX][0-9a-fA-F_]+/, "number.hex"],
      [/0[bB][01_]+/, "number.binary"],
      [/\d+\.\d*([eE][\-+]?\d+)?/, "number.float"],
      [/\.\d+([eE][\-+]?\d+)?/, "number.float"],
      [/\d+([eE][\-+]?\d+)?/, "number"],
    ],

    string_double: [
      [/[^\\"]+/, "string"],
      [/@escapes/, "string.escape"],
      [/\\./, "string.escape.invalid"],
      [/"/, { token: "string.quote", next: "@pop" }],
    ],

    string_single: [
      [/[^\\']+/, "string"],
      [/@escapes/, "string.escape"],
      [/\\./, "string.escape.invalid"],
      [/'/, { token: "string.quote", next: "@pop" }],
    ],


    longcomment: [
      [/[^\]]+/, "comment"],
      [/\]([=]*)\]/, {
        cases: {
          "$1==$S2": { token: "comment", next: "@pop" },
          "@default": "comment",
        },
      }],
      [/./, "comment"],
    ],

    longstring: [
      [/[^\]]+/, "string"],
      [/\]([=]*)\]/, {
        cases: {
          "$1==$S2": { token: "string", next: "@pop" },
          "@default": "string",
        },
      }],
      [/./, "string"],
    ],
  },
};


export function registerLuau(monaco) {
  if (!monaco || !monaco.languages) return false;
  const existing = monaco.languages.getLanguages
    ? monaco.languages.getLanguages().some((l) => l.id === LUAU_LANGUAGE_ID)
    : false;
  if (!existing) {
    monaco.languages.register({
      id: LUAU_LANGUAGE_ID,
      extensions: [".luau", ".lua"],
      aliases: ["Luau", "luau", "Lua"],
    });
  }
  monaco.languages.setMonarchTokensProvider(LUAU_LANGUAGE_ID, luauMonarchTokens);
  monaco.languages.setLanguageConfiguration(LUAU_LANGUAGE_ID, luauLanguageConfig);



  return true;
}
