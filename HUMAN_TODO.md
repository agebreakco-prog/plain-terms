# What the human must do (deadline: Nov 30, 2026, 2:00 PM PST)

Approximate time: 2–3 hours, most of it recording the video.

## 1. Firebase (about 20 min, free Spark plan, no billing)
1. Go to https://console.firebase.google.com, click **Create project** (for example `plain-terms`) and skip Google Analytics.
2. Go to **AI Services → AI Logic → Get started** and choose the **Gemini Developer API**. Do NOT pick the Agent Platform/Vertex option, because it needs billing.
3. Go to **Project settings → Your apps → Add app → Web** (nickname "Plain Terms"). Copy the `firebaseConfig` values.
4. In `products/hybridai/`, run `cp firebase.config.example.json firebase.config.json` and paste in the values. This file is git-ignored, so never commit it.
5. Create a reCAPTCHA v3 key at https://www.google.com/recaptcha/admin with domains `<project>.web.app` and `<project>.firebaseapp.com`. Put the **site key** in `recaptchaSiteKey`.
6. Go to **App Check → Apps → your web app → reCAPTCHA** and paste the **secret key**.
7. Go to **App Check → APIs** and confirm **Firebase AI Logic** shows **Enforced**.

## 2. Build, deploy, load (about 20 min)
```bash
cd products/hybridai
export PATH=/home/mick/money-agent/products/reddit-game/.node/bin:$PATH
npm test && npm run build
npx firebase-tools login
npx firebase-tools use --add                 # select the project
npx firebase-tools deploy --only hosting,remoteconfig
```
- Open `https://<project>.web.app` and run a sample. Check that the chip says **Cloud (Gemini)** or **On-device**, not "Built-in rules".
- In Windows Chrome, open `chrome://extensions`, turn on Developer mode, click **Load unpacked** and select `dist/extension` (from WSL: `\\wsl$\...\products\hybridai\dist\extension`).
- Open the side panel and go to **Settings and diagnostics**. Copy the App Check debug token, then in the console add it under **App Check → Apps → ⋮ → Manage debug tokens**.

## 3. Gemini Nano on your Windows Chrome (about 15 min, mostly download time)
- Set `chrome://flags/#prompt-api-for-gemini-nano-multimodal-input` to **Enabled** and relaunch Chrome.
- Click **Explain** once. The pill shows the download progress. Wait until it says **Gemini Nano ready on this device**.
- If your GPU or RAM is too small, Nano won't be offered. The app still works through the cloud fallback, but the video then can't show on-device runs, so state that in the video.

## 4. Public GitHub repo (about 10 min)
```bash
cd products/hybridai
git init -b main && git add . && git status   # confirm firebase.config.json is NOT listed
git commit -m "Plain Terms: hybrid on-device + cloud plain-language ToS explainer"
gh repo create plain-terms --public --source . --push
```
- On GitHub, open the repo's **About** gear, confirm **Apache-2.0** shows as the license, and add a description and topics.
- Set `"repository": {"url": "https://github.com/<you>/plain-terms"}` in package.json and redeploy so the web footer links to the repo.
- Run `npm run zip` and attach `dist/plain-terms-extension.zip` to a GitHub Release. That gives the judges an extension download link.

## 5. Video (about 60–90 min): YouTube, public, under 3:00, English
- Follow the script at the end of `SUBMISSION.md`. Show **real** on-device and cloud runs, not the `?mock` mode.
- Don't show third-party logos or brands. Use the samples or generic sites, and blur real company names on cookie banners if they appear.
- Don't show the console page with your debug token or API keys.

## 6. Devpost form
- Register at https://firebasehybridaihackathon.devpost.com/ (Join hackathon). Eligibility: you must be of age, and Estonia is OK.
- Paste the story from `SUBMISSION.md`. Fill in the repo URL, the hosting URL, the YouTube URL and the testing instructions.
- Select the platform **Web (Chrome)**.
- Upload screenshots: prefer **real** ones. The `docs/` images say "simulated", so retake them in your browser if possible.
- Click **Submit** (not just save a draft) before **Nov 30, 2:00 PM PST**. After that time, commits to the repo aren't evaluated.
