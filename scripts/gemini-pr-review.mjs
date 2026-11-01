#!/usr/bin/env node
/**
 * Automated Pull Request Code & Security Review using Google Gemini (gemini-3.8-flash).
 * Runs in GitHub Actions on pull_request events.
 */

import { fileURLToPath } from "node:url";
import path from "node:path";
import { GoogleGenAI } from "@google/genai";

const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const GITHUB_TOKEN = process.env.GITHUB_TOKEN;
const REPO_NAME = process.env.REPO_NAME;
const PR_NUMBER = process.env.PR_NUMBER;

const COMMENT_MARKER = "<!-- gemini-pr-review -->";

async function main() {
  if (!GEMINI_API_KEY) {
    console.log(
      "ℹ️  GEMINI_API_KEY is not configured in repository secrets. Skipping Gemini PR review.\n" +
      "   To enable, add a GEMINI_API_KEY secret in Settings -> Secrets and variables -> Actions."
    );
    process.exit(0);
  }

  if (!GITHUB_TOKEN || !REPO_NAME || !PR_NUMBER) {
    console.error("❌ Missing required environment variables (GITHUB_TOKEN, REPO_NAME, PR_NUMBER).");
    process.exit(1);
  }

  console.log(`🔍 Fetching diff for PR #${PR_NUMBER} in ${REPO_NAME}...`);
  const diffResponse = await fetch(
    `https://api.github.com/repos/${REPO_NAME}/pulls/${PR_NUMBER}`,
    {
      headers: {
        Authorization: `Bearer ${GITHUB_TOKEN}`,
        Accept: "application/vnd.github.v3.diff",
        "User-Agent": "learnharness-gemini-review",
      },
    }
  );

  if (!diffResponse.ok) {
    console.error(`❌ Failed to fetch PR diff: ${diffResponse.status} ${diffResponse.statusText}`);
    process.exit(1);
  }

  const rawDiff = await diffResponse.text();
  if (!rawDiff || rawDiff.trim().length === 0) {
    console.log("ℹ️ PR diff is empty. Nothing to review.");
    process.exit(0);
  }

  // Filter out large lockfile churn from the diff
  const filteredDiff = filterDiff(rawDiff);
  if (!filteredDiff || filteredDiff.trim().length === 0) {
    console.log("ℹ️ Only lockfile or noise changes found. Nothing to review.");
    process.exit(0);
  }

  // Truncate if diff is exceptionally large (e.g. > 120,000 characters)
  const MAX_DIFF_LENGTH = 120000;
  let truncatedNotice = "";
  let diffForPrompt = filteredDiff;
  if (filteredDiff.length > MAX_DIFF_LENGTH) {
    diffForPrompt = filteredDiff.slice(0, MAX_DIFF_LENGTH);
    truncatedNotice = `\n\n*(Hinweis: Der PR-Diff war sehr umfangreich und wurde für das Review auf die ersten ${MAX_DIFF_LENGTH} Zeichen gekürzt.)*`;
  }

  console.log("🤖 Running review with Gemini 3.8 Flash...");
  const ai = new GoogleGenAI({ apiKey: GEMINI_API_KEY });

  const systemInstruction = `Du bist ein erfahrener Principal Security Engineer und Code Reviewer für das Projekt LearnHarness 2.0.
LearnHarness ist ein adaptives KI-Lernharness (Electron Desktop App + Next.js Server + lokales Agenten-Ökosystem mit Werkzeugen).

Deine Aufgabe:
Führe ein präzises, konstruktives und sicherheitsfokussiertes Code-Review des übergebenen Pull-Request-Diffs durch.

Achte besonders auf:
1. Security & Isolation:
   - File Tools: Vermeidung von Credential-Leaks (SSH Keys, .env, .npmrc, Cloud-Tokens, Shell-Histories).
   - SSRF & Netzwerk: Schutz lokaler Ports, DNS-Rebinding, Cloud-Metadata (169.254.169.254).
   - Electron Shell: Richtige WebPreferences (sandbox: true, contextIsolation: true, nodeIntegration: false), Navigation-Guards (will-navigate, externalURLAllowed).
   - Cross-Origin / Messaging: Saubere Origin-Prüfungen bei postMessage und Event-Handlern.
   - Prompt Injection: Trennung von Systembefehlen und Fremddaten (Notizen, Webseiten, PDFs).
2. Code-Qualität & Bugs:
   - TypeScript-Typensicherheit, API-Brüche, unhandled Promise Rejections / Exceptions.
   - Resource Leaks (offene Listener, unbereinigte Sockets oder Prozesse).
3. Testabdeckung:
   - Wurden für sicherheitsrelevante Logik oder neue Funktionen Tests beigefügt?

Antworte auf Deutsch in gut strukturiertem GitHub-Markdown im folgenden Format:

## 🤖 Gemini PR Review
*(Analysiert mit \`gemini-3.8-flash\`)*

### 📋 Zusammenfassung
[Kurze, prägnante Zusammenfassung der Änderungen und ihres Zwecks]

### 🛡️ Sicherheitsanalyse
[Bewertung der Sicherheitsaspekte: Wurden Risiken erkannt? Sind die Härtungsmaßnahmen wirksam?]

### 🔍 Detaillierte Befunde & Code-Qualität
[Konstruktive Punkte zu konkreten Dateien/Zeilen. Wenn alles sauber ist, lobend erwähnen.]

### ✅ Fazit & Empfehlung
[Klares Fazit: z. B. Freigabe empfohlen oder Handlungsbedarf vor dem Merge]`;

  let response;
  try {
    response = await ai.models.generateContent({
      model: "gemini-3.8-flash",
      contents: `Hier ist der Git-Diff des Pull Requests zur Überprüfung:\n\n\`\`\`diff\n${diffForPrompt}\n\`\`\``,
      config: {
        systemInstruction,
      },
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes("prepayment credits are depleted") || (err && (err.status === 402 || err.code === 402))) {
      console.warn(
        "\n⚠️  Gemini API Billing Hinweis (HTTP 402):\n" +
        "   Die Prepayment-Credits für den verwendeten API-Key sind aufgebraucht.\n" +
        "   Tipp: Wenn du ein reines Free-Tier-Projekt in AI Studio (ohne Google Cloud Billing) nutzt,\n" +
        "   ist die API dauerhaft kostenlos. Erstelle auf https://aistudio.google.com/apikey einen\n" +
        "   neuen Key mit 'Create API key in new project' und aktualisiere das GitHub Secret GEMINI_API_KEY.\n"
      );
      process.exit(0);
    }
    if (msg.includes("RESOURCE_EXHAUSTED") || (err && (err.status === 429 || err.code === 429))) {
      console.warn(
        "\n⚠️  Gemini API Rate-Limit erreicht (HTTP 429).\n" +
        "   Das temporäre Anfragelimit wurde erreicht. Der Review wird beim nächsten Push wiederholt.\n"
      );
      process.exit(0);
    }
    throw err;
  }

  const reviewText = response.text;
  if (!reviewText) {
    console.error("❌ Gemini returned an empty response.");
    process.exit(1);
  }

  const commentBody = `${COMMENT_MARKER}\n${reviewText}${truncatedNotice}`;

  console.log("💬 Checking existing review comments on PR...");
  const commentsResponse = await fetch(
    `https://api.github.com/repos/${REPO_NAME}/issues/${PR_NUMBER}/comments`,
    {
      headers: {
        Authorization: `Bearer ${GITHUB_TOKEN}`,
        Accept: "application/vnd.github.v3+json",
        "User-Agent": "learnharness-gemini-review",
      },
    }
  );

  let existingCommentId = null;
  if (commentsResponse.ok) {
    const comments = await commentsResponse.json();
    const existing = comments.find((c) => c.body && c.body.includes(COMMENT_MARKER));
    if (existing) existingCommentId = existing.id;
  }

  if (existingCommentId) {
    console.log(`📝 Updating existing review comment #${existingCommentId}...`);
    const updateRes = await fetch(
      `https://api.github.com/repos/${REPO_NAME}/issues/comments/${existingCommentId}`,
      {
        method: "PATCH",
        headers: {
          Authorization: `Bearer ${GITHUB_TOKEN}`,
          Accept: "application/vnd.github.v3+json",
          "Content-Type": "application/json",
          "User-Agent": "learnharness-gemini-review",
        },
        body: JSON.stringify({ body: commentBody }),
      }
    );
    if (!updateRes.ok) {
      console.error(`❌ Failed to update comment: ${updateRes.status} ${updateRes.statusText}`);
      process.exit(1);
    }
    console.log("✅ Review comment updated successfully.");
  } else {
    console.log("📝 Creating new review comment on PR...");
    const createRes = await fetch(
      `https://api.github.com/repos/${REPO_NAME}/issues/${PR_NUMBER}/comments`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${GITHUB_TOKEN}`,
          Accept: "application/vnd.github.v3+json",
          "Content-Type": "application/json",
          "User-Agent": "learnharness-gemini-review",
        },
        body: JSON.stringify({ body: commentBody }),
      }
    );
    if (!createRes.ok) {
      console.error(`❌ Failed to create comment: ${createRes.status} ${createRes.statusText}`);
      process.exit(1);
    }
    console.log("✅ Review comment posted successfully.");
  }
}

/**
 * Filter out lockfiles and noise from the diff
 */
export function filterDiff(diff) {
  const fileChunks = diff.split(/^diff --git /m);
  const kept = [];
  for (const chunk of fileChunks) {
    if (!chunk.trim()) continue;
    const firstLine = chunk.split("\n")[0] || "";
    // Filter lockfiles
    if (
      firstLine.includes("package-lock.json") ||
      firstLine.includes("yarn.lock") ||
      firstLine.includes("pnpm-lock.yaml")
    ) {
      continue;
    }
    kept.push("diff --git " + chunk);
  }
  return kept.join("\n");
}

const isMainModule = Boolean(
  process.argv[1] &&
    path.resolve(fileURLToPath(import.meta.url)) === path.resolve(process.argv[1])
);

if (isMainModule) {
  main().catch((err) => {
    console.error("❌ Unexpected error during Gemini review:", err);
    process.exit(1);
  });
}
