# FilterGram

Instagram on the web, without the Reels. A userscript for Safari on iPhone, plus a small static site that explains how to install it.

## How it works

The script runs on the real `instagram.com` inside the user's own browser, so logins never pass through any server of ours. (A site that proxies Instagram would have to handle people's credentials; we deliberately don't do that.)

| Rule (all toggleable via the in-page **FG** button) | Behaviour |
|---|---|
| Hide Reels tab | Nav link to `/reels/` and profile Reels tabs |
| Hide feed Reels | Home-feed `<article>`s that link to a reel |
| Block Reels feed | `/reels/`, `/reels/audio/…`, `/user/reels/` redirect away |
| Lock single reels | `/reel/ID/` still opens (e.g. from a DM) but wheel/touch/keys are blocked, and if the URL moves to another reel it bounces back |
| Hide Explore | Nav link and `/explore/` (hashtag/search pages still work) |
| Hide suggested posts | Feed posts labelled "Suggested for you" (English only) |

DMs are never filtered, so reels sent to you still play.

## Layout

```
site/
  index.html          install page (static)
  filtergram.user.js  the userscript, served from the same site
  _headers            Cloudflare Pages headers (JS content type)
test/run.mjs          Playwright tests against mock instagram.com pages
```

## Deploy (Cloudflare Pages)

Create a Pages project from this repo with **build command: none** and **output directory: `site`**.

Once the domain is known, add these to the userscript header so the Userscripts app can auto-update it:

```
// @downloadURL  https://<your-domain>/filtergram.user.js
// @updateURL    https://<your-domain>/filtergram.user.js
```

Bump `@version` on each release.

## Develop

```
npm install
npx playwright install chromium   # or set CHROMIUM_PATH to an existing Chromium
npm test
```

The tests load the real script into mock pages. They check the logic, not Instagram's live markup, which is obfuscated and changes often. Selectors rely on link `href`s and `<article>`, and **should be re-checked against a real logged-in account** after changes on Instagram's side.

## Not affiliated with Instagram or Meta.
