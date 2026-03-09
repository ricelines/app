import { execFile } from "node:child_process";
import { createWriteStream } from "node:fs";
import { cp, mkdir, mkdtemp, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { pipeline } from "node:stream/promises";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";

const execFileAsync = promisify(execFile);

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, "..");
const outputDir = path.join(rootDir, "dist");
const assetsDir = path.join(rootDir, "assets");
const configPath = path.join(rootDir, "config", "element-config.json");
const releaseApiUrl = "https://api.github.com/repos/element-hq/element-web/releases/latest";
const brandedAssetFiles = [
  "ricelines-lockup.png",
  "ricelines-lockup.webp",
  "ricelines-emblem-icon-180.png",
  "ricelines-emblem-icon-512.png"
];

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

const faviconLines = [
  '    <link rel="apple-touch-icon" sizes="180x180" href="assets/ricelines-emblem-icon-180.png">',
  '    <link rel="manifest" href="manifest.json">',
  '    <meta name="referrer" content="no-referrer">',
  '    <link rel="icon" href="favicon.ico" sizes="any">'
];

async function main() {
  const config = await loadJson(configPath);
  const tempDir = await mkdtemp(path.join(tmpdir(), "ricelines-element-web-"));

  try {
    const sourceDir = await prepareBaseDist(tempDir);

    if (sourceDir !== outputDir) {
      await rm(outputDir, { recursive: true, force: true });
      await cp(sourceDir, outputDir, { recursive: true });
    }

    await rm(path.join(outputDir, "assets"), { recursive: true, force: true });
    await mkdir(path.join(outputDir, "assets"), { recursive: true });
    for (const assetFile of brandedAssetFiles) {
      await cp(path.join(assetsDir, assetFile), path.join(outputDir, "assets", assetFile), { force: true });
    }
    await cp(path.join(assetsDir, "favicon.ico"), path.join(outputDir, "favicon.ico"), { force: true });

    await writeFile(path.join(outputDir, "config.json"), `${JSON.stringify(config, null, 2)}\n`);
    await writeFile(path.join(outputDir, "index.html"), await brandIndexHtml(config.brand));
    await writeFile(path.join(outputDir, "manifest.json"), await brandManifest(config.brand));
    await writeFile(path.join(outputDir, "_headers"), cloudflareHeaders);
    await writeFile(path.join(outputDir, "_redirects"), cloudflareRedirects);

    console.log(`Prepared branded Element bundle in ${outputDir}`);
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
}

async function prepareBaseDist(tempDir) {
  if (await containsIndexHtml(outputDir)) {
    return outputDir;
  }

  const release = await fetchLatestRelease();
  const asset = selectReleaseAsset(release);
  const archivePath = path.join(tempDir, asset.name);
  const extractDir = path.join(tempDir, "extract");

  console.log(`Downloading ${release.tag_name} from ${asset.browser_download_url}`);
  await downloadFile(asset.browser_download_url, archivePath);

  await mkdir(extractDir, { recursive: true });
  await extractArchive(archivePath, extractDir);

  return findExtractedAppDir(extractDir);
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
    const indexStat = await stat(path.join(dirPath, "index.html"));
    return indexStat.isFile();
  } catch {
    return false;
  }
}

async function brandIndexHtml(brand) {
  const filePath = path.join(outputDir, "index.html");
  const fileContents = await readFile(filePath, "utf8");
  const lines = fileContents.split("\n");
  const brandedLines = [];
  let insertedBrandHeadBlock = false;

  for (const line of lines) {
    if (line.includes("<title>")) {
      brandedLines.push(`    <title>${brand}</title>`);
      brandedLines.push(...faviconLines);
      brandedLines.push(`    <meta name="apple-mobile-web-app-title" content="${brand}">`);
      brandedLines.push(`    <meta name="application-name" content="${brand}">`);
      brandedLines.push('    <meta property="og:image" content="assets/ricelines-lockup.png" />');
      insertedBrandHeadBlock = true;
      continue;
    }

    if (
      line.includes('<link rel="apple-touch-icon"') ||
      line.includes('<link rel="manifest"') ||
      line.includes('<meta name="referrer"') ||
      line.includes('<link rel="icon"') ||
      line.includes('apple-mobile-web-app-title') ||
      line.includes('application-name') ||
      line.includes('property="og:image"')
    ) {
      continue;
    }

    brandedLines.push(line);
  }

  if (!insertedBrandHeadBlock) {
    throw new Error(`Could not find <title> in ${filePath}`);
  }

  return `${brandedLines.join("\n")}\n`;
}

async function brandManifest(brand) {
  const filePath = path.join(outputDir, "manifest.json");
  const manifest = await loadJson(filePath);

  manifest.name = brand;
  manifest.short_name = brand;
  manifest.icons = [
    {
      src: "assets/ricelines-emblem-icon-512.png",
      sizes: "512x512",
      type: "image/png"
    }
  ];

  return `${JSON.stringify(manifest, null, 4)}\n`;
}

async function loadJson(filePath) {
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
