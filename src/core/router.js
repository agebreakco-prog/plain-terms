// Hybrid routing policy: decides HOW a document is analysed before any model is
// called. The decision is made from facts we can observe (document length,
// network state, Gemini Nano availability, the user's privacy choice) and is
// returned with a plain-English reason that the UI shows to the user.
//
// Mode strings intentionally equal Firebase AI Logic's InferenceMode values so
// this module stays dependency-free and testable in Node.

export const MODE = {
  PREFER_ON_DEVICE: 'prefer_on_device',
  ONLY_ON_DEVICE: 'only_on_device',
  PREFER_IN_CLOUD: 'prefer_in_cloud',
  ONLY_IN_CLOUD: 'only_in_cloud',
};

export const PRIVACY = {
  PRIVATE: 'private', // never leave the device
  BALANCED: 'balanced', // on-device first, cloud only when it clearly helps
  CLOUD: 'cloud', // best quality first, device as backup
};

export const DEFAULT_LIMITS = {
  // Gemini Nano in Chrome has a ~9k token window shared by prompt + output.
  // ~12k characters of document leaves room for instructions and JSON output.
  onDeviceMaxChars: 12000,
  chunkChars: 9000,
  maxChunks: 8,
  // Above this, even the cloud call is truncated (keeps free-tier usage small).
  cloudMaxChars: 120000,
};

const NANO_READY = new Set(['available']);
const NANO_SOON = new Set(['downloadable', 'downloading']);

/**
 * @param {object} p
 * @param {number} p.chars           document length in characters
 * @param {string} p.privacy         one of PRIVACY
 * @param {boolean} p.online         navigator.onLine
 * @param {string} p.nano            LanguageModel.availability() result, or 'unsupported'
 * @param {boolean} p.firebaseReady  Firebase config present and SDK initialised
 * @param {boolean} [p.demo]         force the local demo engine
 * @param {object} [p.limits]        overrides (from Remote Config)
 * @returns {{engine:'firebase'|'demo'|'rules', mode?:string, strategy:'single'|'chunked'|'none', reason:string, chunkChars?:number, fallback?:object}}
 */
export function planAnalysis(p) {
  const limits = { ...DEFAULT_LIMITS, ...(p.limits || {}) };
  const privacy = p.privacy || PRIVACY.BALANCED;
  const nanoReady = NANO_READY.has(p.nano);
  const nanoSoon = NANO_SOON.has(p.nano);
  const long = p.chars > limits.onDeviceMaxChars;
  const cloudAllowed = privacy !== PRIVACY.PRIVATE && p.online !== false;

  if (p.demo || !p.firebaseReady) {
    return {
      engine: 'demo',
      strategy: 'none',
      reason: p.demo
        ? 'Demo mode: built-in rules only, no AI model is called.'
        : 'Firebase is not configured yet, so only the built-in rules run (demo mode).',
    };
  }

  const deviceChunked = {
    engine: 'firebase',
    mode: MODE.ONLY_ON_DEVICE,
    strategy: 'chunked',
    chunkChars: limits.chunkChars,
  };

  if (!cloudAllowed) {
    const why = privacy === PRIVACY.PRIVATE ? 'On-device only is switched on' : 'You are offline';
    if (!nanoReady && !nanoSoon) {
      return {
        engine: 'rules',
        strategy: 'none',
        reason: `${why} and Gemini Nano isn't available on this device, so only the built-in rules ran.`,
      };
    }
    if (long) {
      return { ...deviceChunked, reason: `${why}: long document split into parts and read by Gemini Nano on this device.` };
    }
    return {
      engine: 'firebase',
      mode: MODE.ONLY_ON_DEVICE,
      strategy: 'single',
      reason: `${why}: read by Gemini Nano on this device. Nothing was sent to the cloud.`,
    };
  }

  if (long) {
    return {
      engine: 'firebase',
      mode: MODE.ONLY_IN_CLOUD,
      strategy: 'single',
      reason: `Long document (${Math.round(p.chars / 1000)}k characters) exceeds the on-device window, so it was sent to Gemini in the cloud.`,
      // If the cloud call fails (quota, network), read it on-device in parts.
      fallback: nanoReady || nanoSoon ? { ...deviceChunked, reason: 'Cloud was unreachable, so Gemini Nano read it on this device in parts.' } : null,
    };
  }

  if (privacy === PRIVACY.CLOUD) {
    return {
      engine: 'firebase',
      mode: MODE.PREFER_IN_CLOUD,
      strategy: 'single',
      reason: 'Cloud-first is selected: Gemini in the cloud, with Gemini Nano as backup.',
    };
  }

  return {
    engine: 'firebase',
    mode: MODE.PREFER_ON_DEVICE,
    strategy: 'single',
    reason: nanoReady
      ? 'Short document: read privately by Gemini Nano on this device.'
      : 'Gemini Nano is not ready on this device, so Firebase AI Logic fell back to the cloud.',
  };
}
