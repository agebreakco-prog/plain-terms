// Firebase wiring: App, App Check, AI Logic (hybrid inference) and Remote Config.
// This is the only module that talks to Firebase; the core engine receives
// `runModel` from here and stays testable without a browser.

import { initializeApp } from 'firebase/app';
import { initializeAppCheck, ReCaptchaEnterpriseProvider, CustomProvider } from 'firebase/app-check';
import { getAI, getGenerativeModel, GoogleAIBackend, InferenceMode, InferenceSource } from 'firebase/ai';
import { getRemoteConfig, fetchAndActivate, getValue } from 'firebase/remote-config';
import { DEFAULT_LIMITS } from '../core/router.js';

export const DEFAULT_CLOUD_MODEL = 'gemini-3.5-flash-lite';

const TEXT_EN = [{ type: 'text', languages: ['en'] }];
const DEVICE_CREATE_OPTIONS = { expectedInputs: TEXT_EN, expectedOutputs: TEXT_EN };

/** True when the config has the minimum fields Firebase needs. */
export function isConfigured(cfg) {
  return Boolean(cfg && cfg.apiKey && cfg.projectId && cfg.appId);
}

/** Ask Chrome whether Gemini Nano (Prompt API) can run here. */
export async function nanoStatus() {
  const LM = globalThis.LanguageModel;
  if (!LM || typeof LM.availability !== 'function') return 'unsupported';
  try {
    // availability() can stall (e.g. headless or a busy component updater); never block the UI on it.
    const timeout = new Promise((r) => setTimeout(() => r('unavailable'), 3000));
    return await Promise.race([LM.availability(DEVICE_CREATE_OPTIONS), timeout]);
  } catch {
    return 'unavailable';
  }
}

/**
 * @param {object} cfg Firebase web config plus optional `recaptchaSiteKey`.
 * @param {object} opts
 * @param {string} [opts.debugToken] App Check debug token. When set (extension
 *   builds, localhost), the debug provider is used instead of reCAPTCHA.
 */
export function createHybridClient(cfg, { debugToken } = {}) {
  if (!isConfigured(cfg)) return null;
  const { recaptchaSiteKey, ...firebaseConfig } = cfg;
  const app = initializeApp(firebaseConfig);

  // App Check is required by Firebase AI Logic. Web builds served from the
  // registered domain use reCAPTCHA v3; extension/local builds use the debug
  // provider with a per-install token the user registers once in the console.
  const useDebug = Boolean(debugToken) || !recaptchaSiteKey;
  if (useDebug) {
    globalThis.FIREBASE_APPCHECK_DEBUG_TOKEN = debugToken || true;
  }
  const provider = useDebug
    ? new CustomProvider({ getToken: () => Promise.reject(new Error('App Check debug mode: no attestation provider')) })
    : new ReCaptchaEnterpriseProvider(recaptchaSiteKey);
  initializeAppCheck(app, { provider, isTokenAutoRefreshEnabled: true });

  const ai = getAI(app, { backend: new GoogleAIBackend() });
  let cloudModel = DEFAULT_CLOUD_MODEL;
  const models = new Map();

  function model(mode, schema) {
    const key = `${mode}|${cloudModel}|${schema ? JSON.stringify(schema).length : 0}`;
    if (!models.has(key)) {
      models.set(
        key,
        getGenerativeModel(ai, {
          mode,
          inCloudParams: {
            model: cloudModel,
            generationConfig: schema
              ? { responseMimeType: 'application/json', responseJsonSchema: schema, temperature: 0.2 }
              : { temperature: 0.2 },
          },
          onDeviceParams: {
            createOptions: { ...DEVICE_CREATE_OPTIONS },
            promptOptions: schema ? { responseConstraint: schema } : undefined,
          },
        }),
      );
    }
    return models.get(key);
  }

  return {
    app,
    InferenceMode,

    /**
     * Start (or confirm) the Gemini Nano download. Must be called from a user
     * gesture such as a button click, per the Prompt API's activation rule.
     */
    warmUp(onProgress) {
      return model(InferenceMode.PREFER_ON_DEVICE).initializeDeviceModel(onProgress);
    },

    /** The single entry point the engine uses for every inference call. */
    async runModel({ mode, prompt, schema }) {
      // Cloud calls get a hard timeout so a bad network or App Check problem
      // degrades to the next plan instead of spinning forever. On-device calls
      // get longer: Gemini Nano on a slow GPU can take a while per chunk.
      const limit = mode === InferenceMode.ONLY_ON_DEVICE ? 180000 : 30000;
      let timer;
      const result = await Promise.race([
        model(mode, schema).generateContent(prompt),
        new Promise((_, reject) => {
          timer = setTimeout(() => reject(new Error(`no answer within ${limit / 1000}s`)), limit);
        }),
      ]).finally(() => clearTimeout(timer));
      const response = result.response;
      const source =
        response.inferenceSource ??
        (mode === InferenceMode.ONLY_ON_DEVICE ? InferenceSource.ON_DEVICE : InferenceSource.IN_CLOUD);
      return { text: response.text(), source };
    },

    /** Fetch tunable limits from Remote Config, falling back to defaults fast. */
    async loadRemoteLimits(timeoutMs = 2500) {
      const rc = getRemoteConfig(app);
      rc.settings.minimumFetchIntervalMillis = 60 * 60 * 1000;
      rc.defaultConfig = {
        on_device_max_chars: DEFAULT_LIMITS.onDeviceMaxChars,
        chunk_chars: DEFAULT_LIMITS.chunkChars,
        max_chunks: DEFAULT_LIMITS.maxChunks,
        cloud_max_chars: DEFAULT_LIMITS.cloudMaxChars,
        cloud_model: DEFAULT_CLOUD_MODEL,
      };
      try {
        await Promise.race([fetchAndActivate(rc), new Promise((r) => setTimeout(r, timeoutMs))]);
      } catch {
        /* offline or not set up: defaults apply */
      }
      const num = (k) => getValue(rc, k).asNumber() || rc.defaultConfig[k];
      cloudModel = getValue(rc, 'cloud_model').asString() || DEFAULT_CLOUD_MODEL;
      return {
        onDeviceMaxChars: num('on_device_max_chars'),
        chunkChars: num('chunk_chars'),
        maxChunks: num('max_chunks'),
        cloudMaxChars: num('cloud_max_chars'),
        cloudModel,
        fromRemote: getValue(rc, 'on_device_max_chars').getSource() === 'remote',
      };
    },
  };
}
