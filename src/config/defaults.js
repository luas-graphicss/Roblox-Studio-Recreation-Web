export const SETTINGS_KEY = "settings";

export const SUPPORTED_THEMES = Object.freeze(["dark", "light"]);
export const SUPPORTED_LANGUAGES = Object.freeze(["pt-BR", "en-US"]);
export const CAMERA_SPEED_RANGE = Object.freeze({ min: 0.1, max: 10 });


export const MIN_PANEL_SIZE = 100;                         
export const MAX_PANEL_SIZE = 20000;                                               


export const LAYOUT_REQUIRED_SIZE_FIELDS = Object.freeze([
  "rightWidth",
  "explorerHeight",
  "outputHeight",
]);
export const LAYOUT_OPTIONAL_SIZE_FIELDS = Object.freeze([
  "analysisHeight",                             
  "debuggerHeight",                      
  "findHeight",                          
  "assistantWidth",                       
  "apiBrowserWidth",                         
]);
export const LAYOUT_REQUIRED_PANEL_FIELDS = Object.freeze(["explorer", "properties", "output"]);
export const LAYOUT_OPTIONAL_PANEL_FIELDS = Object.freeze([
  "analysis",
  "debugger",
  "find",
  "assistant",
  "apiBrowser",
]);




export const DEFAULT_LAYOUT = Object.freeze({
  rightWidth: 300,
  explorerHeight: 280,
  outputHeight: 180,
  analysisHeight: 160,
  debuggerHeight: 220,
  findHeight: 200,
  assistantWidth: 340,
  apiBrowserWidth: 420,
  panels: Object.freeze({
    explorer: true,
    properties: true,
    output: true,
    analysis: false,
    debugger: false,
    find: false,
    assistant: false,
    apiBrowser: false,
  }),
});

export const DEFAULT_SETTINGS = Object.freeze({
  theme: "dark",                    
  language: "pt-BR",                     
  autosave: true,           
  autosaveIntervalMin: 5,                                                                
  gridVisible: true,                                             
  cameraSpeed: 1,                                  
  layout: DEFAULT_LAYOUT,                                          


  moveSnapEnabled: false,           
  rotateSnapEnabled: false,           
  moveSnap: 1,                      
  rotateSnap: 45,                      
  editorFontSize: 14,                                             
  editorTabSize: 2,                                                         
  editorWordWrap: true,                                        
  editorMinimap: true,                                 

  physicsShowWireframe: false,
  physicsShowVelocities: false,
  physicsShowContacts: false,
  physicsShowCenterOfMass: false,
  tooltipsEnabled: true,
  renderQuality: "auto",
  gridSize: 4,
  showAxisIndicator: true,
  editorLineNumbers: true,
  editorTheme: "auto",
  cameraSmoothing: true,
  cameraInvertY: false,
  cameraSensitivity: 1,
  physicsShowJoints: false,
  physicsThrottle: 100,
  keybindings: Object.freeze({}),
  tcAutoFollow: false,
  tcNotifications: true,
  tcUserColor: "#4c8bf5",
  robuxDefaultBalance: 1000,
  persistRobuxBalance: false,

  loadingScreenMinSec: 1,
  editorCodeAssist: true,
  aiEnabled: false,
  aiProvider: "openai",
  aiEndpoint: "",
  aiModel: "",
  aiMaxTokens: 1024,
  aiTemperature: 0.7,
  aiSystemPrompt: "",
  aiRateLimit: 10,
  aiSendContext: true,
});

export const AI_PROVIDER_IDS = Object.freeze(["openai", "anthropic", "ollama", "custom"]);

export const AI_MAX_TOKENS_RANGE = Object.freeze({ min: 64, max: 8192 });

export const AI_RATE_LIMIT_RANGE = Object.freeze({ min: 1, max: 120 });

export const ROBUX_BALANCE_RANGE = Object.freeze({ min: 0, max: 999999 });

export const RENDER_QUALITIES = Object.freeze(["auto", "high", "medium", "low"]);

export const EDITOR_THEMES = Object.freeze(["auto", "dark", "light"]);

export const GRID_SIZE_RANGE = Object.freeze({ min: 1, max: 64 });

export const CAMERA_SENSITIVITY_RANGE = Object.freeze({ min: 0.1, max: 5 });

export const PHYSICS_THROTTLE_RANGE = Object.freeze({ min: 10, max: 100 });

export const MAX_CUSTOM_KEYBINDINGS_STORED = 200;


export const SNAP_RANGE = Object.freeze({ min: 0.01, max: 1024 });


export const EDITOR_FONT_RANGE = Object.freeze({ min: 8, max: 40 });      
export const EDITOR_TAB_RANGE = Object.freeze({ min: 1, max: 8 });                   
export const AUTOSAVE_INTERVAL_RANGE = Object.freeze({ min: 1, max: 60 });                      
export const LOADING_SCREEN_SEC_RANGE = Object.freeze({ min: 0, max: 10 });                       
export const AI_TEMPERATURE_RANGE = Object.freeze({ min: 0, max: 1 });
