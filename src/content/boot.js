/* Classic content script. The module is loaded with import() so Chrome
   does not parse a static import outside a module. */
(() => {
  const url = chrome.runtime.getURL('src/content/injected.js');
  import(url).catch((error) => {
    console.error('Content script failed to load', error);
  });
})();
