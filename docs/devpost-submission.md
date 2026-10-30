# Devpost submission draft: Persona Reality Check (Qloo hackathon)


## Project name
Persona Reality Check

## Tagline
Paste the target customer from your business plan. An agent checks it against Qloo's taste data and tells you whether these people really exist.

## Try it
- Live demo: https://persona-reality-check.onrender.com. Press one of the three examples, or paste a persona from any plan (English or Japanese).
- Code: https://github.com/KEIOKUTANI/persona-reality-check

## Testing instructions (for judges)
No login needed. Open https://persona-reality-check.onrender.com (the free server sleeps when idle, so the first load can take up to a minute), press one of the three example buttons, or paste any "target customer" paragraph in English or Japanese and press "Check this persona". "What the agent did" at the bottom of each result lists every Qloo call behind the numbers.

## Inspiration
I help small businesses and chambers of commerce in Japan adopt AI. Every startup plan and grant application has a "target customer" paragraph, and many of them describe people who barely exist: "men aged 45-54 who ride Harley-Davidson, listen to BTS and collect Sanrio." In Qloo's data, Harley-Davidson's audience does over-index at 45-54, but BTS fans skew 25-29 and Sanrio fans 24 and under, and the three audiences barely overlap. Advisors can sense it but can't prove it, so plans go ahead with the wrong customer in mind.

## What it does
Paste the persona paragraph. The agent extracts age, gender, location, interests and the brands the plan assumes, then uses Qloo to check four things: whether the interests share an audience, whether that audience matches the claimed age and gender, whether the assumed brands fit this persona in this location, and who the real audience is. It returns a score, red/amber/green findings, an age chart with the plan's claim marked, and a short reviewer memo with one concrete fix.

## How we built it
- Qloo `/search` to resolve names, and `/v2/insights` for demographics (`urn:demographics`), cross-affinity (`signal.interests.entities` + `filter.results.entities`), persona-conditioned affinity (`signal.demographics.age/gender`, `signal.location.query`) and open recommendations.
- Reading the plan and writing the memo is done by keyword rules (English and Japanese) and a template in the public demo. An LLM can be plugged in for both through any OpenAI-compatible API, but it is optional and off in the demo. All numbers come from Qloo either way.
- Plain Node.js, no dependencies. The key stays on the server. An offline test runs the live code path against a mock Qloo server.

## Challenges
- Turning affinities into findings a non-analyst trusts: every flag cites the Qloo number behind it, and the agent's steps are shown.
- Keeping the claims honest: Qloo describes aggregate patterns, so the app says "this combination is rare", never "this person doesn't exist".

## What we learned
The most useful taste question for a small business isn't "what should I recommend?" but "is the customer I'm planning for real?"

## What's next
- A Japanese UI and a PDF report for chamber-of-commerce advisors.
- Checking every persona in a batch of grant applications.
- Suggesting a corrected persona and re-checking it.

## Known limitations
- Qloo describes aggregate taste patterns; a low score means "this combination is rare in Qloo's data", never a claim about any individual.
- General hobbies (e.g. "Golf") resolve to Qloo tags, which have no audience demographics, so they are reported as "could not be checked" rather than scored.
- Thresholds were calibrated on six personas (table in the README); they are a first pass.

## Built with
qloo, node.js, javascript, html, css, render
