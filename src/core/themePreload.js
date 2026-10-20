(function applyPersistedThemeBeforePaint() {
  var SETTINGS_STORAGE_KEY = "rsw.settings";
  var DEFAULT_THEME = "dark";

  function readPersistedTheme() {
    var rawSettings = localStorage.getItem(SETTINGS_STORAGE_KEY);
    if (!rawSettings) return DEFAULT_THEME;
    var parsedSettings = JSON.parse(rawSettings);
    if (!parsedSettings) return DEFAULT_THEME;
    if (parsedSettings.theme === "dark" || parsedSettings.theme === "light") {
      return parsedSettings.theme;
    }
    return DEFAULT_THEME;
  }

  function applyTheme(themeName) {
    document.documentElement.setAttribute("data-theme", themeName);


    document.documentElement.style.colorScheme = themeName;
  }

  try {
    applyTheme(readPersistedTheme());
  } catch (error) {

    applyTheme(DEFAULT_THEME);
  }
})();
