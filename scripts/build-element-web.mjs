import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { cp, mkdtemp, mkdir, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import { createWriteStream } from "node:fs";
import path from "node:path";
import { tmpdir } from "node:os";
import { pipeline } from "node:stream/promises";
import { fileURLToPath } from "node:url";

const execFileAsync = promisify(execFile);

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, "..");
const outputDir = path.join(rootDir, "dist");
const configPath = path.join(rootDir, "config", "element-config.json");
const releaseApiUrl = "https://api.github.com/repos/element-hq/element-web/releases/latest";

const cloudflareHeaders = `/
  Cache-Control: no-cache

/index.html
  Cache-Control: no-cache

/config*.json
  Cache-Control: no-cache

/i18n/*
  Cache-Control: no-cache

/home
  Cache-Control: no-cache

/sites/*
  Cache-Control: no-cache
`;

const cloudflareRedirects = `/* /index.html 200
`;

async function main() {
  const tempDir = await mkdtemp(path.join(tmpdir(), "ricelines-element-web-"));
  try {
    const release = await fetchLatestRelease();
    const asset = selectReleaseAsset(release);
    const archivePath = path.join(tempDir, asset.name);
    const extractDir = path.join(tempDir, "extract");

    console.log(`Downloading ${release.tag_name} from ${asset.browser_download_url}`);
    await downloadFile(asset.browser_download_url, archivePath);

    await mkdir(extractDir, { recursive: true });
    await extractArchive(archivePath, extractDir);

    const extractedAppDir = await findExtractedAppDir(extractDir);
    const config = await loadConfig(configPath);

    await rm(outputDir, { recursive: true, force: true });
    await cp(extractedAppDir, outputDir, { recursive: true });

    await writeFile(path.join(outputDir, "config.json"), `${JSON.stringify(config, null, 2)}\n`);
    await writeFile(path.join(outputDir, "_headers"), cloudflareHeaders);
    await writeFile(path.join(outputDir, "_redirects"), cloudflareRedirects);

    console.log(`Built ${release.tag_name} into ${outputDir}`);
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
}

async function fetchLatestRelease() {
  const response = await fetch(releaseApiUrl, {
    headers: {
      Accept: "application/vnd.github+json",
      "User-Agent": "ricelines-element-web-builder"
    }
  });

  if (!response.ok) {
    throw new Error(`Failed to fetch latest release metadata: ${response.status} ${response.statusText}`);
  }

  const release = await response.json();

  if (!release?.tag_name || !Array.isArray(release.assets)) {
    throw new Error("GitHub release metadata did not include the expected fields");
  }

  return release;
}

function selectReleaseAsset(release) {
  const exactAssetName = `element-${release.tag_name}.tar.gz`;
  const exactMatch = release.assets.find((asset) => asset.name === exactAssetName);

  if (exactMatch) {
    return exactMatch;
  }

  const fallbackMatch = release.assets.find((asset) => {
    const name = asset.name.toLowerCase();
    return name.endsWith(".tar.gz") && name.startsWith("element-") && !name.includes("source");
  });

  if (fallbackMatch) {
    return fallbackMatch;
  }

  throw new Error(`Could not find a release tarball in ${release.tag_name}`);
}

async function downloadFile(url, destinationPath) {
  const response = await fetch(url, {
    headers: {
      Accept: "application/octet-stream",
      "User-Agent": "ricelines-element-web-builder"
    }
  });

  if (!response.ok || !response.body) {
    throw new Error(`Failed to download release archive: ${response.status} ${response.statusText}`);
  }

  await pipeline(response.body, createWriteStream(destinationPath));
}

async function extractArchive(archivePath, destinationDir) {
  try {
    await execFileAsync("tar", ["-xzf", archivePath, "-C", destinationDir]);
  } catch (error) {
    const detail = error.stderr?.trim() || error.message;
    throw new Error(`Failed to extract ${archivePath}: ${detail}`);
  }
}

async function findExtractedAppDir(extractDir) {
  const entries = await readdir(extractDir, { withFileTypes: true });
  const visibleEntries = entries.filter((entry) => !entry.name.startsWith("."));

  if (await containsIndexHtml(extractDir)) {
    return extractDir;
  }

  if (visibleEntries.length === 1 && visibleEntries[0].isDirectory()) {
    const candidateDir = path.join(extractDir, visibleEntries[0].name);
    if (await containsIndexHtml(candidateDir)) {
      return candidateDir;
    }
  }

  throw new Error("Downloaded archive did not unpack into a deployable Element web directory");
}

async function containsIndexHtml(dirPath) {
  try {
    const indexPath = path.join(dirPath, "index.html");
    const indexStat = await stat(indexPath);
    return indexStat.isFile();
  } catch {
    return false;
  }
}

async function loadConfig(filePath) {
  const fileContents = await readFile(filePath, "utf8");

  try {
    return JSON.parse(fileContents);
  } catch (error) {
    throw new Error(`Invalid JSON in ${filePath}: ${error.message}`);
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
