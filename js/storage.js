// Storage wrappers for chrome.storage.local and chrome.storage.sync
// Promise-based APIs with default settings

export const DEFAULT_SETTINGS = {
  autoSuspendEnabled: false,
  suspendAfterMinutes: 30,
  protectMedia: true,
  protectPinned: true,
  protectActive: true,
  protectLocalUrls: true,
  warnFormData: false,
  suspendOnMinimize: false,
  theme: 'system',
  autoRestore: false,
  badgeCountEnabled: false,
  changeTabIconWhenSuspended: false
};

function wrapStorageArea(storage) {
  return {
    get(key) {
      return new Promise((resolve) => {
        try {
          storage.get(key, (result) => {
            if (chrome.runtime.lastError) {
              console.error('Storage get error:', chrome.runtime.lastError.message);
              resolve(undefined);
            } else {
              resolve(result[key]);
            }
          });
        } catch (err) {
          console.error('Storage get exception:', err);
          resolve(undefined);
        }
      });
    },

    set(key, value) {
      return new Promise((resolve) => {
        try {
          storage.set({ [key]: value }, () => {
            if (chrome.runtime.lastError) {
              console.error('Storage set error:', chrome.runtime.lastError.message);
            }
            resolve();
          });
        } catch (err) {
          console.error('Storage set exception:', err);
          resolve();
        }
      });
    },

    setMultiple(items) {
      return new Promise((resolve) => {
        try {
          storage.set(items, () => {
            if (chrome.runtime.lastError) {
              console.error('Storage setMultiple error:', chrome.runtime.lastError.message);
            }
            resolve();
          });
        } catch (err) {
          console.error('Storage setMultiple exception:', err);
          resolve();
        }
      });
    },

    remove(key) {
      return new Promise((resolve) => {
        try {
          storage.remove(key, () => {
            if (chrome.runtime.lastError) {
              console.error('Storage remove error:', chrome.runtime.lastError.message);
            }
            resolve();
          });
        } catch (err) {
          console.error('Storage remove exception:', err);
          resolve();
        }
      });
    },

    getAll() {
      return new Promise((resolve) => {
        try {
          storage.get(null, (result) => {
            if (chrome.runtime.lastError) {
              console.error('Storage getAll error:', chrome.runtime.lastError.message);
              resolve({});
            } else {
              resolve(result);
            }
          });
        } catch (err) {
          console.error('Storage getAll exception:', err);
          resolve({});
        }
      });
    }
  };
}

const local = wrapStorageArea(chrome.storage.local);
const sync = wrapStorageArea(chrome.storage.sync);

export const localGet = (key) => local.get(key);
export const localSet = (key, value) => local.set(key, value);
export const localRemove = (key) => local.remove(key);
export const localGetAll = () => local.getAll();

export const syncGet = (key) => sync.get(key);
export const syncSet = (key, value) => sync.set(key, value);
export const syncRemove = (key) => sync.remove(key);
export const syncSetMultiple = (items) => sync.setMultiple(items);
export const syncGetAll = () => sync.getAll();

export async function getSettings() {
  try {
    const stored = await sync.getAll();
    const settings = {};
    for (const key of Object.keys(DEFAULT_SETTINGS)) {
      settings[key] = stored[key] !== undefined ? stored[key] : DEFAULT_SETTINGS[key];
    }
    return settings;
  } catch (err) {
    console.error('getSettings error:', err);
    return { ...DEFAULT_SETTINGS };
  }
}

export async function setSettings(settings) {
  try {
    await sync.setMultiple(settings);
  } catch (err) {
    console.error('setSettings error:', err);
  }
}
