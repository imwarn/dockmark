# Dockmark - Self-hosted personal bookmark, workspace, and browser command launcher

TypeScript ^7.0.2 + React ^19.2.8 + Vite ^8.2.2 + Cloudflare Workers & D1 (Wrangler 4.131.1, @cloudflare/vite-plugin ^1.54.7) + WXT ^0.21.4

<directory>
apps/ - Deployable web app, Cloudflare Worker API, and browser extensions (2 subdirectories: web/, extension/)
packages/ - Shared domain contracts, settings normalization, i18n, Pinyin/command search, and URL policy (1 subdirectory: core/)
scripts/ - Release packaging, Cloudflare deploy/migration helpers, and Chromium smoke suites (14 scripts)
docs/ - Architecture, API, security, roadmap, and Firefox validation specifications (1 subdirectory: brand/)
</directory>

<config>
package.json - npm workspace root scripts for dev, build, typecheck, extension packaging, D1 migrations, and smoke tests
tsconfig.base.json - Strict ES2022 bundler TypeScript configuration (strict, exactOptionalPropertyTypes, verbatimModuleSyntax, noUncheckedIndexedAccess)
wrangler.jsonc - Cloudflare Workers entry (apps/web/worker/router.ts), SPA asset serving, and D1 database binding (DB)
.editorconfig - Cross-editor indentation, charset, and newline formatting rules
</config>

[PROTOCOL]: Update this header on change, then check GEMINI.md
