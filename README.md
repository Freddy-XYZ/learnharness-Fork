<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="docs/assets/lh_banner_dark.png">
    <source media="(prefers-color-scheme: light)" srcset="docs/assets/lh_banner_light.png">
    <img src="docs/assets/lh_banner_light.png" alt="LearnHarness" width="640">
  </picture>
</p>

<p align="center"><strong>An agent harness for learning.</strong></p>

<p align="center">
  <a href="https://learnharness.ai">Download</a> ·
  <a href="#how-it-works">How it works</a> ·
  <a href="docs/development.md">Documentation</a> ·
  <a href="https://github.com/amosblomqvist/learnharness/issues">Issues</a> ·
  <a href="https://discord.gg/5tCHHQEB2e">Discord</a>
</p>

LearnHarness uses AI agents to plan and teach lessons from your current understanding to your goal. It builds a detailed picture of what you understand and how you reason. That picture is updated as you learn.

Instead of just giving you an explanation, it uses your answers and thinking to decide what you need next. Teaching builds understanding one reasoning step at a time. Practice makes it usable. A persistent knowledge graph carries it across sessions.

![LearnHarness teaching session](docs/assets/teaching-session.png)

## How it works

1. **Measure.** Before teaching, the agent finds where your understanding ends on each part the lesson depends on. Your answers, confidence, and thinking show it where to start.
2. **Plan.** It works out a dependency map from that starting point to your goal. You can see the plan, and the lesson adapts when your understanding turns out different.
3. **Teach.** Each step builds on something you already understand. You predict, get an explanation, and check your understanding. Confusions are repaired before anything is built on them. The aim is for the goal to feel obviously true, not merely familiar.
4. **Practice.** Separate sessions pose varied problems that require the right knowledge to come to mind without being named first. Problems and hints adapt to your reasoning.

**Think out loud.** The thinking fields let you explain your reasoning, uncertainties, and reactions in your own words. This is how the agent gets a detailed picture rather than just a record of right and wrong answers. You can type or use dictation.

The agent can also research questions in the background, create visual explanations, and build interactive demonstrations.

## Knowledge that carries forward

What you are taught accumulates as propositions and reasoning chains: individual claims and the premises that lead to them. The graph shows this structure, with links back to the source sessions. You can also import notes.

Future teaching sessions can read the graph instead of starting from scratch. Practice sessions can draw their material from it. It stores the ideas and their connections, not ratings of your ability.

![LearnHarness knowledge graph](docs/assets/knowledge-graph.png)

## Learning tools

> **Fork only:** these tools and the [Spotify player](#music-with-spotify) exist only in this fork. They are not in the official downloads. To use them, clone this repository and run it from source (see [Run this fork](#run-this-fork)).

- **Confidence calibration.** A chip in the session header compares your confidence with your check results. High-confidence misses and low-confidence hits are listed as weak spots, and one click starts a repair session for them. Predictions made before teaching do not count against you.
- **Spaced review.** Practice results are tracked per proposition in the graph. Each clean solve without hints extends the next review (1 → 3 → 7 → 14 → 30 days). A hint, a skipped problem, or a retest flag resets it. Graph nodes show their review status, and **Review due** in the composer loads the due and retest propositions into a practice session.
- **Feynman mode.** Choose **Teach back** on a graph node or at the end of a lesson and explain the idea in plain words, as if to a curious 12-year-old. The agent asks about jargon and missing causal steps, then scores clarity, jargon, and the causal chain.
- **Lesson wrap-up.** When the last step of the plan is checked, a summary card shows the covered steps and your calibration, with shortcuts to practice, teach back, or repair weak spots.
- **Pronunciation trainer.** In language lessons the agent can ask you to say a word or sentence. You hear it first through your browser's text-to-speech, then you say it into the microphone. Each word is marked green (exact), yellow (close or accented), or red (missed). This uses the same Deepgram key as dictation.
- **Visual-first teaching.** The teacher plans a diagram, figure, or interactive demo for each step. Demos include step-by-step animations and parameter sliders, and they are built while you answer the prediction question.

## Download and get started

> **This is a fork.** The downloads and releases below are the official LearnHarness builds. They do not include this fork's features ([learning tools](#learning-tools), [Spotify](#music-with-spotify)). To get them, clone this repository instead.

### Run this fork

```bash
git clone https://github.com/Freddy-XYZ/learnharness-Fork.git
cd learnharness-Fork
npm install
npm run dev        # http://localhost:3000
```

### Official builds

**[Download from learnharness.ai](https://learnharness.ai)** · [GitHub Releases](https://github.com/amosblomqvist/learnharness/releases)

- **macOS (Apple Silicon):** signed and notarized DMG. Drag the app to Applications.
- **Windows (x64):** run the installer. It is currently unsigned; Windows may show an “unknown publisher” or SmartScreen warning.
- **Linux (x64):** make the AppImage executable and open it, or install the Debian/Ubuntu `.deb`.

Choose your models, then start a session with what you want to understand. You can use provider API keys, supported subscription connections in the desktop app, an installed [Claude Code CLI](docs/claude-code.md), or a [custom OpenAI-compatible endpoint](docs/custom-providers.md), including a local model server. Optional dictation and web search use separate service keys.

Advanced users can set a [prompt-cache retention preference](docs/compaction-accounting.md#prompt-cache-retention) for each model slot under **Settings → Agent → Models → Show advanced settings**. Leaving it at **Pi default** preserves existing provider behavior; longer retention can increase cache-write costs.

All three platforms support in-app updates.

**Dictation:** Create a [Deepgram API key](https://console.deepgram.com/) with the **Member role or higher** ([required for token minting](https://developers.deepgram.com/reference/auth/tokens/grant)) and add it under **Settings → Providers → Dictation**. Choose the language below the key; **Multilingual** supports automatic recognition and mixed-language speech. A `403 Insufficient permissions` error during token minting can indicate an insufficient key role.

## Music with Spotify

The sidebar has a Spotify player for study music: play/pause, skip, seek, volume, your playlists, and track search. Playback requires **Spotify Premium**.

> **Desktop app limitation:** the packaged desktop app starts its server on a random port each launch. Spotify requires an exact redirect URI, so connecting from the packaged app does not work yet. Run LearnHarness with `npm run dev` (or `npm run desktop:dev`) to use Spotify.

1. **Create a Spotify app.** Open the [Spotify Developer Dashboard](https://developer.spotify.com/dashboard), choose **Create app**, and select **Web API** and **Web Playback SDK**.
2. **Add the redirect URI** exactly as written:
   ```
   http://127.0.0.1:3000/api/spotify/callback
   ```
   Use `127.0.0.1`, not `localhost`. Spotify rejects `localhost` redirect URIs, and LearnHarness rewrites `localhost` to `127.0.0.1` itself. If you run on a different port, use that port.
3. **Allow your account.** Apps in Spotify's development mode only work for listed users. Add the Spotify account you will log in with under **User Management**.
4. **Save the Client ID.** Copy the app's **Client ID** (not the secret; LearnHarness uses PKCE) into **Settings → Providers → Music (Spotify)**.
5. **Connect.** Click **Connect Spotify** in the same section and approve access in the popup. It closes itself, and the status shows `connected · <your name>`.

**Playback device.** In the browser, LearnHarness registers its own Spotify device named **LearnHarness Player** and plays through it. If that is unavailable, it controls whichever Spotify device is active. On macOS with the Spotify app installed, it can also control the desktop app directly. If you see *"Kein aktives Spotify-Gerät gefunden"*, open Spotify on any device briefly, or use LearnHarness in the browser.

Tokens are stored locally in `spotify-auth.json` in the data directory (owner-only permissions). **Disconnect** in Settings removes them.

**Security note.** In the browser, the in-app player loads Spotify's Web Playback SDK from `sdk.scdn.co` into the LearnHarness page. That script runs with the page's full access to the local LearnHarness API, so you trust Spotify's CDN as much as LearnHarness itself. If you do not want that, connect only from the desktop app, or skip the Spotify connection. The desktop app never loads the SDK: Electron has no Widevine support, so the SDK could not play there anyway. Desktop playback uses Spotify Connect devices or the macOS Spotify app.

## Your keys, your data

- **Your keys and models.** No LearnHarness subscription or markup. Billing depends on your provider, CLI configuration, subscription, or local setup. The live cost meter estimates known API costs, not subscription, CLI, or custom-endpoint charges.
- **Local storage.** Your chats, graph, settings, and API keys live on your machine. Learning records are plain files you can inspect.
- **External services.** Models run through your configured providers. Model requests send the context needed for the task; web research and dictation also contact external services. Local storage does not mean offline processing.
- **Inspectable behavior.** System prompts are visible and editable. The app is open source under the AGPL-3.0 license.

## Development and support

```bash
npm install
npm run dev        # http://localhost:3000
npm test           # deterministic, no LLM, no network
```

See the [development guide](docs/development.md) for setup and checks, [architecture](docs/architecture.md) for the shipped runtime, [keyboard reference](docs/keyboard.md) for shortcuts, and [desktop release guide](docs/desktop-release.md) for packaging and updates.

Questions, bug reports, and feature requests: [GitHub Issues](https://github.com/amosblomqvist/learnharness/issues).

## License

[AGPL-3.0](LICENSE)

The app is free and open forever. If we ever charge for anything, it will be for convenience — managed keys, hosting — never for features you can run locally.
