# Devpost submission: Plain Terms

**Project name:** Plain Terms
**Tagline:** Fine print, in plain words. On-device first, cloud when it helps.
**Platform category:** Web (Chrome): Chrome extension plus web app
**Built with:** Firebase AI Logic (hybrid inference), Gemini Nano (Chrome Prompt API), Gemini Developer API, Firebase App Check, Firebase Remote Config, Firebase Hosting, JavaScript, Chrome Extensions MV3, esbuild
**Links:** repo `<GITHUB_URL>` · try it `https://plain-terms.web.app` · video `<YOUTUBE_URL>` · extension: build from the repo (`npm run build`, then Load unpacked `dist/extension`)

---

## Inspiration

Every day we click "I agree" on documents we will never read. They are long and written to be skipped, and the lines that matter are buried in section 14: *your data may be sold*, *you'll be billed until you cancel*, *you waive your right to sue*. Cookie banners are worse. They are designed to make "Accept all" the easiest choice.

This felt like the right problem for hybrid AI. The text is often private context: the page you're on, the service you're about to sign up for. A small on-device model can explain a cookie banner or a short ToS privately, instantly and at no cost. A 15-page privacy policy, though, is beyond what a small local model can read in one pass, and that is where the cloud earns its place.

## What it does

Plain Terms is a Chrome side-panel extension and a web app. Choose **This page**, **Cookie banner** (detected automatically) or **Selection**, or right-click any selected text, and you get:

- a one-sentence **TL;DR** of what you're agreeing to
- up to six **plain-language points**, written at roughly a 12-year-old reading level
- a **concern score** (0–100) and **risk cards** for data sale, auto-renewal, forced arbitration, perpetual content licences, tracking cookies, sensitive data, data retention, unilateral changes, fees and more. Each card quotes the exact clause.
- a line that says **where the AI ran and why**, for example *"Short document: read privately by Gemini Nano on this device. Nothing was sent to the cloud."* or *"Long document (31k characters) exceeds the on-device window, so it was sent to Gemini in the cloud."*

- **Ask the fine print:** ask a question in everyday words (*"Can I cancel any time?"*, *"Do they sell my data?"*) and get a yes/no/depends answer with the exact supporting quote.
- a practical **"What you can do"** step on every risk card (opt-outs, arbitration opt-out windows, renewal reminders), and a **Copy summary** button.

You choose where the AI may run: **On-device only**, **Balanced** (the default) or **Cloud first**.

## How we built it

**Firebase AI Logic hybrid inference is the core.** `src/firebase/client.js` creates `GenerativeModel`s with `getGenerativeModel(ai, { mode, inCloudParams, onDeviceParams })`. It calls `initializeDeviceModel()` on the user's click, to respect the Prompt API's user-activation rule and start the Nano download. It reads `response.inferenceSource` after every call. Our own routing policy (`src/core/router.js`) sits on top of the SDK's four modes:

- **Short text, Balanced → `PREFER_ON_DEVICE`.** Gemini Nano reads it locally, and the SDK falls back to the cloud when Nano isn't available.
- **Long text → `ONLY_IN_CLOUD`.** If the cloud call fails (network or quota), we switch to **on-device map-reduce**: Nano reads the policy in chunks with `ONLY_ON_DEVICE`, and a short reduce prompt merges the parts.
- **On-device only, or offline → `ONLY_ON_DEVICE`** (chunked when long). If Nano is missing, the built-in rules answer alone.
- **Cloud first → `PREFER_IN_CLOUD`**, with Nano as the backup.
- **Questions → retrieval, then `PREFER_ON_DEVICE`.** A local retriever (keyword overlap with a legal-synonym map: "sue" finds *arbitration*, *class action*, *jury*) picks the few passages that matter, about 1–3k characters. Because that context is tiny, a question about a 40-page privacy policy is answered **privately by Gemini Nano**, even though the whole policy would never fit in Nano's window. The quote in the answer is grounded like every other finding.

The routing thresholds and the cloud model name are **Remote Config** parameters, so we can tune the "on-device window" without shipping a new extension. **App Check** protects the Gemini API: reCAPTCHA v3 on the hosted web app, and the debug provider in the extension. MV3 forbids remote scripts, so each install generates its own debug token and shows it in the settings panel.

Both paths share one **JSON schema**. It goes to Gemini Nano as the Prompt API `responseConstraint` and to the cloud as `responseJsonSchema`, so the UI renders on-device and cloud answers identically.

We didn't want the app to make things up about contracts, so every result is **grounded**. A deterministic clause detector runs in microseconds next to the model. Every quote the AI returns is checked against the source text, using exact match or 80% 4-word-shingle overlap, and hallucinated findings are dropped. Model and rule findings are merged and labelled *"AI and rules agree"*, *"Found by AI, quote verified"* or *"Found by built-in rules"*.

The core (router, engine, detector, grounding, chunking) has no browser dependencies and is covered by **41 `node:test` tests**, including simulated cloud failures, invalid model JSON, private mode and offline mode. The UI is plain JavaScript, bundled with esbuild into an MV3 side panel and a Firebase Hosting site.

## Challenges we ran into

- **The on-device context window.** Gemini Nano can't read a full privacy policy in one call. We made the window a Remote Config value and built chunked map-reduce for when the cloud isn't allowed or isn't reachable.
- **Small models and exact quotes.** On-device answers sometimes paraphrase while claiming to quote. Fuzzy-grounding every quote against the source fixed both hallucinations and false alarms.
- **App Check inside an extension.** MV3 doesn't allow reCAPTCHA's remote script. We used the debug provider with a per-install token shown in the UI, and kept reCAPTCHA v3 for the hosted web app.
- **Being honest about routing.** "Prefer on-device" doesn't guarantee on-device. We report the SDK's actual `inferenceSource`, not the mode we asked for.
- **Never a dead end.** Every failure path (no Nano, no network, quota, malformed JSON) degrades to something useful and says what happened.

## Accomplishments that we're proud of

- A complete product: page, cookie-banner and selection sources, a right-click entry, and dark mode.
- Private by default. In Balanced mode, a cookie banner or a short ToS never leaves the device when Nano is available.
- Every flagged clause links back to real text in the document.
- It works for everyone: Nano machines, machines without Nano, offline, and without any Firebase setup (demo mode).

## What we learned

Hybrid AI is a product decision as much as a technical one. Users care about *where* their text goes, and showing a one-line reason ("why on-device", "why cloud") builds more trust than any privacy policy, which is ironic for this app. We also learned that a tiny rule engine next to a small model is a strong combination: the rules give precision and an instant answer, and the model gives nuance and plain language.

## What's next for Plain Terms

- **Android.** The same routing policy with Gemini Nano via Firebase AI Logic on Android, for in-app sign-up screens.
- **Change alerts.** Store a fingerprint of the terms you accepted (Firestore, opt-in) and warn you when they change.
- **More languages** for the prompts and rules, starting with German, French and Spanish.
- **A one-click "Reject non-essential" helper** that finds the reject button on cookie banners.

## Built during the submission period

This is a new project, created from scratch during the #BuildHybridAI submission period (November 2026). It contains no pre-existing code beyond open-source dependencies (the Firebase JS SDK and esbuild, under their own licenses). All sample documents are original and describe fictional companies.

## AI disclosure

Designed and coded with substantial help from an AI coding assistant; the entrant set the direction, reviewed it and tested it.

---

## Testing instructions (paste into the Devpost "testing" field)

1. **Web app (no install):** open `https://plain-terms.web.app`, click a sample (try "Fitness privacy policy (long)") and press **Explain in plain terms**. Switch between On-device only, Balanced and Cloud first to see the routing change. On Chrome 139+ with Gemini Nano, short texts run on-device. Anywhere else, Firebase AI Logic falls back to the cloud.
2. **Extension:** clone `https://github.com/agebreakco-prog/plain-terms`, run `npm install && npm run build`, open `chrome://extensions`, turn on Developer mode, click **Load unpacked** and select the `dist/extension` folder. Open any site with a cookie banner, click the Plain Terms icon, choose **Cookie banner** and click **Explain**. *Cloud fallback in the extension uses an App Check debug token. Without a registered token, the extension still runs on-device (Gemini Nano) and with the built-in rules.*
3. **Ask the fine print:** after any result, click a suggested question such as "Do they sell or share my data?". The line under the answer says how many passages were used and where the model ran.
4. **No setup at all:** `https://plain-terms.web.app?mock=auto&nano=available&sample=terms&run=1` runs the full pipeline with a simulated model, clearly labelled "simulated".
5. **Code:** `npm install && npm test` (41 tests). Firebase AI Logic is called in `src/firebase/client.js`, and the routing policy is in `src/core/router.js`.

## Video script (under 3 minutes)

1. **0:00–0:15 Hook.** A real cookie banner with "Accept all" highlighted. Voice-over: *"Nobody reads this. Plain Terms does, and it doesn't need to send it anywhere."*
2. **0:15–0:50 On-device.** Open the side panel, choose Cookie banner, click Explain. Show the green **On-device (Gemini Nano)** chip and the reason line. Optionally turn on airplane mode first to prove it works offline.
3. **0:50–1:30 Cloud fallback.** Open a long privacy policy and choose This page. The **Cloud (Gemini)** chip appears with the reason *"Long document… sent to Gemini in the cloud"*. Scroll through the risk cards and point at the verified quotes.
4. **1:30–2:00 Privacy control.** Switch to **On-device only** and rerun the long policy. Progress shows "Gemini Nano is reading part 2 of 3…" and the result is on-device only.
5. **2:00–2:25 Selection.** Right-click selected text and choose "Explain in plain terms".
6. **2:25–2:50 Under the hood.** Show `router.js` (the routing table), `client.js` (`getGenerativeModel` with `mode`, `inferenceSource`), the Remote Config parameters and App Check. Close on the tagline.
