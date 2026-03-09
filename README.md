# Ricelines App

This repository builds a static Cloudflare Pages deploy of the latest stable `element-web` release at build time.

## How it works

`pnpm build` runs `scripts/build-element-web.mjs`, which:

1. Fetches the latest stable release metadata from `element-hq/element-web`.
2. Downloads the release tarball.
3. Extracts the release into `dist/`.
4. Replaces `dist/config.json` with the checked-in Ricelines config from `config/element-config.json`.
5. Writes Cloudflare Pages routing and cache metadata into `dist/_redirects` and `dist/_headers`.

No `element-web` build artifacts are checked into this repository. `dist/` is always generated.

## Cloudflare Pages

Use these project settings:

- Build command: `pnpm build`
- Build output directory: `dist`

The build requires outbound network access because it downloads the latest `element-web` release during the Pages build.
