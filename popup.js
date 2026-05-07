// BTYouTube Popup Script

const toggleSpotlight = document.getElementById('toggle-spotlight');
const toggleUI = document.getElementById('toggle-ui');

// Load saved settings
chrome.storage.sync.get(['spotlightEnabled', 'uiEnabled'], (result) => {
  toggleSpotlight.checked = result.spotlightEnabled !== false;
  toggleUI.checked = result.uiEnabled !== false;
});

// Save on change
toggleSpotlight.addEventListener('change', () => {
  chrome.storage.sync.set({ spotlightEnabled: toggleSpotlight.checked });
  sendToTab({ type: 'BTY_TOGGLE_SPOTLIGHT', enabled: toggleSpotlight.checked });
});

toggleUI.addEventListener('change', () => {
  chrome.storage.sync.set({ uiEnabled: toggleUI.checked });
  sendToTab({ type: 'BTY_TOGGLE_UI', enabled: toggleUI.checked });
});

function sendToTab(message) {
  chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
    if (tabs[0]?.id) {
      chrome.tabs.sendMessage(tabs[0].id, message).catch(() => {});
    }
  });
}
