// Memory tracking: chrome.processes with fallback estimation
// Chrome Extension Manifest V3 APIs only

/**
 * Extract domain from a URL string.
 * @param {string} url
 * @returns {string}
 */
function getDomain(url) {
  try {
    if (!url) return 'unknown';
    const u = new URL(url);
    return u.hostname || 'unknown';
  } catch {
    return 'unknown';
  }
}

/**
 * Format bytes into a human-readable string.
 * @param {number} bytes
 * @returns {string}
 */
export function formatBytes(bytes) {
  if (bytes === 0 || bytes == null || Number.isNaN(bytes)) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  const k = 1024;
  const i = Math.max(0, Math.min(units.length - 1, Math.floor(Math.log(bytes) / Math.log(k))));
  const value = bytes / Math.pow(k, i);
  // Show 1 decimal for MB and above, integers for B/KB
  const formatted = i >= 2 ? value.toFixed(1) : Math.round(value).toString();
  return `${formatted} ${units[i]}`;
}

/**
 * Estimate memory usage based on tab count.
 * @param {number} tabCount
 * @returns {number} estimated bytes
 */
export function estimateMemory(tabCount) {
  const avgBytesPerTab = 75 * 1024 * 1024; // 75 MB
  const count = Math.max(0, Number(tabCount) || 0);
  return count * avgBytesPerTab;
}

/**
 * Get memory info using chrome.processes, falling back to estimation.
 * Returns object: { totalRam, tabs: [{tabId, domain, memory}], estimated }
 * @returns {Promise<{totalRam: number, tabs: Array<{tabId: number, domain: string, memory: number}>, estimated: boolean}>}
 */
export async function getMemoryInfo() {
  // Try chrome.processes first
  if (typeof chrome !== 'undefined' && chrome.processes && chrome.processes.getProcessInfo) {
    try {
      const processes = await new Promise((resolve, reject) => {
        chrome.processes.getProcessInfo([], ['memory'], (result) => {
          if (chrome.runtime.lastError) {
            reject(new Error(chrome.runtime.lastError.message));
          } else {
            resolve(result || []);
          }
        });
      });

      const tabMap = new Map();
      let totalRam = 0;

      for (const proc of processes) {
        if (proc && proc.tabs && Array.isArray(proc.tabs)) {
          const procMemory = proc.memory?.privateMemory || proc.memory?.jsMemory || 0;
          // Distribute process memory across its tabs evenly
          const perTabMemory = Math.floor(procMemory / proc.tabs.length);
          for (const tabId of proc.tabs) {
            const existing = tabMap.get(tabId) || 0;
            tabMap.set(tabId, existing + perTabMemory);
            totalRam += perTabMemory;
          }
        }
      }

      // Fetch tab info to pair with memory data
      const tabs = await new Promise((resolve, reject) => {
        chrome.tabs.query({}, (result) => {
          if (chrome.runtime.lastError) {
            reject(new Error(chrome.runtime.lastError.message));
          } else {
            resolve(result || []);
          }
        });
      });

      const tabMemoryList = tabs.map((tab) => {
        const memory = tabMap.get(tab.id) || 0;
        return {
          tabId: tab.id,
          domain: getDomain(tab.url),
          memory
        };
      });

      // Recalculate totalRam from tab list to ensure consistency
      totalRam = tabMemoryList.reduce((sum, t) => sum + t.memory, 0);

      return {
        totalRam,
        tabs: tabMemoryList,
        estimated: false
      };
    } catch (err) {
      console.warn('chrome.processes.getProcessInfo failed, falling back to estimation:', err.message);
    }
  }

  // Fallback: estimate based on tab count
  const tabs = await new Promise((resolve, reject) => {
    chrome.tabs.query({}, (result) => {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message));
      } else {
        resolve(result || []);
      }
    });
  });

  const totalRam = estimateMemory(tabs.length);
  const tabMemoryList = tabs.map((tab) => ({
    tabId: tab.id,
    domain: getDomain(tab.url),
    memory: Math.floor(totalRam / Math.max(1, tabs.length))
  }));

  return {
    totalRam,
    tabs: tabMemoryList,
    estimated: true
  };
}

/**
 * Calculate saved memory today from suspension history.
 * @returns {Promise<number>}
 */
export async function getSavedMemoryToday() {
  try {
    const history = await new Promise((resolve) => {
      chrome.storage.local.get('suspensionHistory', (result) => {
        resolve(result.suspensionHistory || []);
      });
    });

    const now = new Date();
    const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
    const endOfDay = startOfDay + 24 * 60 * 60 * 1000;

    const todayEntries = history.filter((entry) => {
      return entry.action === 'suspend' && entry.timestamp >= startOfDay && entry.timestamp < endOfDay;
    });

    const estimate = 75 * 1024 * 1024; // 75 MB per tab
    return todayEntries.length * estimate;
  } catch (err) {
    console.error('getSavedMemoryToday error:', err);
    return 0;
  }
}
