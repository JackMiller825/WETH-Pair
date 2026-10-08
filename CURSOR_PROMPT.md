# Paste this entire file into Cursor Agent

Finish the supplied **Spud Panic / $SPUDP** website in one implementation pass. The working static site, final copy, original images and research are already in this folder. Use the actual bundled assets and the completed source. Make routine implementation decisions from this brief and finish without additional prompts.

## Goal

An excellent, fast, responsive independent Ethereum meme landing page with a **bold pop-art food-poster** style. It features a worried potato in red oven mitts, a blue sweat drop and steam curls. Tagline: “Maximum starch. Minimum composure.” Hero: “The feed is hot. The spud is not OK.” The joke is emotional feed overload. It does not imply endorsement by Shayne Coplan or Polymarket, nor promise returns.

## Fast path and files

Read AGENTS.md, RESEARCH_AND_DESIGN.md and ASSET_MANIFEST.json. Preserve this complete dependency-free HTML/CSS/JavaScript foundation. Use index.html, styles.css, app.js and site-config.json. Do not re-scaffold the project, install a framework, add a backend, search for new artwork, create a CMS, integrate wallets, fetch live charts or request an API key. Research is completed for this handoff; do not let another research phase delay the website.

Node.js 18+ is the only runtime requirement for the included local tools. `npm run dev` serves the website at port 5173 by default. `npm run build` produces dist/ for static hosting. `npm run preview` serves dist/. No `npm install` is necessary. Retain all build commands and finish with a successful static build.

## Actual bundled assets

| File | Use |
|---|---|
| assets/logo.webp | Brand icon and character poster, 768×768 |
| assets/logo.png | Transparent mascot download |
| assets/banner.webp | Hero banner, exactly 1500×500 (3:1) |
| assets/banner.png | Shareable social/banner download, exactly 3:1 |
| assets/meme-01.webp | Checking-the-feed meme, 1024×1024 |
| assets/meme-02.webp | Before/after group-chat meme, 1024×1024 |
| assets/meme-01.png, assets/meme-02.png | Actual gallery download targets |
| assets/favicon.png | Favicon |

Do not regenerate images or use remote assets. Keep the steam, sweat, eyes and red oven mitts consistent. Do not crop banner lettering or square meme captions. Preserve PNG alpha transparency. IMAGE_PROMPTS.json documents generation; the files themselves are already supplied. Use live HTML for headings, navigation, facts and buttons.

## Design requirements

Butter yellow #ffe55b, tomato red #f33b35, cobalt blue #235cff, warm off-white #fff8e6, near-black #151515. Oversized bold uppercase Arial headings with tight but readable tracking, thick black rules, squared buttons with small offset shadows, strong asymmetric character art, a checkerboard strip and a paper-receipt facts panel. No medieval serif, forest/ranger treatment, neon gradients, glass cards or generic dashboard.

Desktop: compact sticky top nav, centered live headline, full 3:1 banner with black outline and offset shadow, short supporting line and gallery CTA. Follow with a blue mascot poster beside the character story, a red gallery section, a cobalt community area and a yellow token section containing a receipt. Mobile: stack all columns, preserve the complete banner ratio, use the accessible Menu control, keep downloads and copy controls comfortably tappable. Do not use a forced device orientation or make users zoom to read facts.

Keep one clear primary action: viewing/downloading memes. Buying is secondary and pending until launch information exists. Use 2–3-pixel ink borders, restrained CSS texture and existing real artwork. No extra animations or asset-heavy effects. Decorative “100% starch / 0% chill” is an obvious character joke, never a metric about the token.

## Exact copy and section order

Use the completed text already present in index.html. Required order and copy:

1. Hero (#home): “THE FEED IS HOT. THE SPUD IS NOT OK.” Tagline: “Maximum starch. Minimum composure.” The supplied banner. Supporting text: “A potato with absolutely no poker face.” Primary CTA: “ENTER THE PANIC ROOM.” Secondary: “MEET THE SPUD.”
2. Character/story (#lore): “EVERY FEED HAS A MOMENT. HE IS THAT MOMENT.” Intro: “You opened the timeline for one calm look. The timeline had other plans.” Explain one sweaty potato, two red mitts, too many tabs and refreshing the feed. Preserve the independence statement naming Coplan, Polymarket and other potato tokens.
3. Meme gallery (#memes): “FRESHLY BAKED. READY FOR THE FEED.” Two actual downloadable images. Meme 01 reads “JUST CHECKING THE FEED. / EMOTIONALLY ROASTED.” Meme 02 reads “BEFORE THE GROUP CHAT. / AFTER THE GROUP CHAT.” Include the rotating reaction card and “ANOTHER REACTION” button.
4. Community (#join): “IF YOU KNOW THAT FACE, YOU KNOW THE JOKE.” Invite everyday captions and sharing. X and Telegram stay Coming soon until supplied. Do not invent channels or handles.
5. Token/receipt (#token): “A POTATO. A TICKER. NO MYSTERY.” Show $SPUDP, Ethereum mainnet, pending supply/tax/liquidity/ownership, full contract or Contract coming soon, copy, Etherscan, buy and DEX links. State that no verified launch details have yet been supplied. FAQs cover no Coplan/Polymarket backing, no connection to an existing potato token, no promised returns and pending trading.
6. Footer: tagline, original-project/no-affiliation statement, concise speculative-risk note, logo and 3:1 banner downloads.

## Single config and accurate pending states

site-config.json controls the launch values. Keep chainId 1. Contract address, site URL, all social/trading links and tokenomics are intentionally null. Do not infer tokenomics from artwork or competing projects. Do not fabricate audit status, locked liquidity, renounced ownership, tax rates, total supply, holder counts, partnerships, prices or exchange listings.

Never import the old Ethereum Hot Potato address or any other competitor's contract. SPUDP is a separate proposed identity. No celebrity likeness or quotation should act as its endorsement. Do not attach a “100x” reward promise, urgency countdown, presale or prediction-market feature to this site.

app.js must preserve honest pending behavior: contract copying disabled until a nonzero full 42-character Ethereum address is supplied; buying enabled only with that address and an HTTPS buy URL; explorer derived from the address on etherscan.io; external links active only when real HTTPS URLs are supplied. Show the full address with safe wrapping at 320 pixels. Copy exactly the full address. Pending anchors have no fake href. Use no wallet connection or simulated trade.

## Working interactions and accessibility

Section anchors must work and headings must remain visible under the sticky bar. The mobile menu updates aria-expanded, closes after navigation and on Escape, and is keyboard accessible. The reaction button rotates local captions and announces changes through aria-live. All download links point at the actual PNG files. Use supplied alt text, one h1, ordered headings, a skip link, visible focus, readable color contrast and reduced-motion handling.

Use local/system fonts and local WebP assets. Set image dimensions, prioritize the hero banner and lazy-load lower images. Keep every image's aspect ratio. Avoid horizontal overflow, clipped text, giant mobile empty spaces and unnecessary motion.

## Complete and verify

Run `npm run build` successfully. Verify 1440, 768, 390 and 320-pixel widths; image loading; anchors; mobile menu; reaction rotation; PNG downloads; pending states; full-address wrap/copy behavior; and browser console errors. If you test a synthetic 42-character contract, keep it in temporary local test state and restore the null source config. Never deliver a fake live address.

The existing QA report and screenshots record checks already performed. Update them only for checks actually run after changes. Return the finished site with a concise build result. Missing real launch values already have visible pending states and do not require another owner prompt to finish the site. Do not deploy a token or publish the website as part of this handoff.
