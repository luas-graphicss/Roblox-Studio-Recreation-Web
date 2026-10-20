export const ROBLOX_DARK_ID = "roblox-dark";
export const ROBLOX_LIGHT_ID = "roblox-light";


function rules(c) {
  return [
    { token: "keyword", foreground: c.keyword },
    { token: "type", foreground: c.type },
    { token: "variable.predefined", foreground: c.global },
    { token: "string", foreground: c.string },
    { token: "string.quote", foreground: c.string },
    { token: "string.escape", foreground: c.escape },
    { token: "string.escape.invalid", foreground: c.escapeInvalid },
    { token: "number", foreground: c.number },
    { token: "number.hex", foreground: c.number },
    { token: "number.binary", foreground: c.number },
    { token: "number.float", foreground: c.number },
    { token: "comment", foreground: c.comment, fontStyle: "italic" },
    { token: "operator", foreground: c.operator },
    { token: "delimiter", foreground: c.operator },
    { token: "identifier", foreground: c.text },
  ];
}

export const ROBLOX_DARK = {
  base: "vs-dark",
  inherit: true,
  rules: rules({
    keyword: "569CD6",
    type: "4EC9B0",
    global: "DCDCAA",
    string: "CE9178",
    escape: "D7BA7D",
    escapeInvalid: "F44747",
    number: "B5CEA8",
    comment: "6A9955",
    operator: "D4D4D4",
    text: "D4D4D4",
  }),
  colors: {
    "editor.background": "#1E1E1E",
    "editor.foreground": "#D4D4D4",
    "editorLineNumber.foreground": "#858585",
    "editorLineNumber.activeForeground": "#C6C6C6",
    "editor.lineHighlightBackground": "#2D2D2D",
    "editor.selectionBackground": "#264F78",
    "editorCursor.foreground": "#AEAFAD",
    "editorIndentGuide.background": "#404040",
    "editorWhitespace.foreground": "#3B3B3B",
  },
};

export const ROBLOX_LIGHT = {
  base: "vs",
  inherit: true,
  rules: rules({
    keyword: "0000CC",
    type: "267F99",
    global: "795E26",
    string: "A31515",
    escape: "B58900",
    escapeInvalid: "CD3131",
    number: "098658",
    comment: "008000",
    operator: "000000",
    text: "000000",
  }),
  colors: {
    "editor.background": "#FFFFFF",
    "editor.foreground": "#000000",
    "editorLineNumber.foreground": "#999999",
    "editorLineNumber.activeForeground": "#333333",
    "editor.lineHighlightBackground": "#F0F0F0",
    "editor.selectionBackground": "#ADD6FF",
    "editorCursor.foreground": "#000000",
    "editorIndentGuide.background": "#D3D3D3",
  },
};


export function themeIdFor(appTheme) {
  return appTheme === "light" ? ROBLOX_LIGHT_ID : ROBLOX_DARK_ID;
}


export function registerThemes(monaco) {
  if (!monaco || !monaco.editor) return false;
  monaco.editor.defineTheme(ROBLOX_DARK_ID, ROBLOX_DARK);
  monaco.editor.defineTheme(ROBLOX_LIGHT_ID, ROBLOX_LIGHT);
  return true;
}
