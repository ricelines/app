# Ricelines App

This repository keeps the Ricelines config and branding assets alongside an `element-web` build flow.

## How it works

`pnpm build` runs `scripts/build-element-web.mjs`, which:

1. Reuses an existing local `dist/` bundle when one is already present.
2. Otherwise downloads the latest stable `element-web` release into `dist/`.
3. Copies the checked-in branding assets from `assets/` into `dist/assets/`.
4. Replaces `dist/config.json` with the checked-in Ricelines config from `config/element-config.json`.
5. Rewrites `dist/index.html`, `dist/manifest.json`, `dist/_redirects`, and `dist/_headers` so the Ricelines branding remains authoritative.

## Cloudflare Pages

Use these project settings:

- Build command: `pnpm build`
- Build output directory: `dist`

The build requires outbound network access when `dist/` is not already present in the checkout.
