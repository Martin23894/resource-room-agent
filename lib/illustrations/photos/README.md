# Photo curation guide

This directory holds the 50 stock photos used as decorative photography on
PPTX `concept`, `example`, and `warmUp` slides. Photos are referenced
deterministically by `lib/illustrations/photos.js` — the same Lesson
always picks the same photos for the same slots — so curation only needs
to happen once per refresh.

**The picker handles missing files gracefully** — slides render with a
"ghost frame" placeholder where a photo would land, so the deck still
works end-to-end before any photo lands here. Drop in the JPGs as you
source them.

## Directory layout

50 photos split across 6 subject categories. Create the subdirectories
and drop the JPGs in with sequential `NN.jpg` names:

```
photos/
  mathematics/   01.jpg  02.jpg  03.jpg  04.jpg  05.jpg  06.jpg  07.jpg  08.jpg
  sciences/      01.jpg  02.jpg  03.jpg  04.jpg  05.jpg  06.jpg  07.jpg  08.jpg  09.jpg
  geography/     01.jpg  02.jpg  03.jpg  04.jpg  05.jpg  06.jpg  07.jpg  08.jpg
  languages/     01.jpg  02.jpg  03.jpg  04.jpg  05.jpg  06.jpg  07.jpg  08.jpg  09.jpg
  history/       01.jpg  02.jpg  03.jpg  04.jpg  05.jpg  06.jpg  07.jpg  08.jpg
  lifeskills/    01.jpg  02.jpg  03.jpg  04.jpg  05.jpg  06.jpg  07.jpg  08.jpg
```

The `lifeskills` bucket also serves Life Orientation and EMS — those
subjects map there in `lib/illustrations/photos.js → categoryFor()`.

If you change the slot counts, also update `PHOTO_CATEGORIES` in
`lib/illustrations/photos.js` so the picker knows how far to index.

## Licensing — only use photos with explicit free-commercial licenses

The lesson DOCX/PPTX is downloaded by the teacher and may end up
anywhere. Every photo here must be safe for that distribution.

**Recommended sources** (all free for commercial use, no attribution
required, modify freely):

- **Unsplash** — <https://unsplash.com> · Unsplash License
- **Pexels** — <https://pexels.com> · Pexels License
- **Pixabay** — <https://pixabay.com> · Pixabay Content License

**Do NOT use:**

- Google Image search results
- Flickr photos under restrictive Creative Commons (CC-BY-NC, CC-BY-SA, etc.)
- Anything from a stock site that requires attribution or charges per use
  (Getty, Shutterstock, Adobe Stock — unless we have a paid licence)
- AI-generated photos (commercial-use IP is still grey for most tools)

Save the source URL + license confirmation alongside each photo (you
can keep a `_credits.txt` file in this directory — gitignored — for
your own records).

## Sizing & format

- **Format:** JPG (smaller than PNG for photographic content)
- **Resolution:** ~1200×800 px (3:2) is the target. Anything between
  1000×667 and 1600×1067 is fine. Photos are cropped to a 3.3"×4.6"
  PPTX box on widescreen slides — providing more pixels than that just
  bloats the file.
- **File size:** aim for ~150–300 KB each. The whole library should fit
  inside ~10 MB total. Use `convert` / `magick` / online JPG compressor
  if photos run heavy.
- **Aspect:** prefer **portrait or square** orientation — the photo box
  on the slide is taller than wide. Wide landscape photos crop awkwardly.

## Content guidelines

- **Kid-appropriate.** No adult or distressing content. Photos featuring
  children should look natural, not posed-stock-photo cringe.
- **Representation.** South African classrooms are diverse — pick
  photos that reflect that across the library. Search Unsplash for
  `african children`, `south africa school`, `cape town`, `diverse
  classroom` for SA-leaning shots.
- **Avoid the obvious clichés.** A search for "Mathematics" returns mostly
  chalkboards covered in equations. Those photos are fine for variety
  but don't make the whole maths bucket chalkboard-only — mix in
  hands-on shots (counting blocks, money, measuring), abstract
  geometry, books with rulers, etc.
- **Subject relevance** — photos should evoke the subject, not literally
  illustrate the lesson topic (the model picks topics dynamically; the
  photo is decorative).

## Per-category search prompts

Suggested search terms to seed your curation (mix-and-match across
sources):

| Category | Search terms |
|---|---|
| `mathematics` | `numbers`, `counting`, `geometry`, `measuring tape`, `kids math`, `chalkboard equation`, `abacus`, `puzzle pieces`, `building blocks` |
| `sciences` | `science kid`, `magnifying glass`, `plants kids`, `microscope`, `nature outdoors`, `biology classroom`, `experiment`, `solar system`, `weather` |
| `geography` | `map`, `globe`, `cape town`, `africa landscape`, `compass`, `mountains`, `rivers`, `aerial view land`, `desert savanna` |
| `languages` | `child reading`, `library books`, `pencil writing`, `reading aloud`, `storytelling`, `book pages open`, `kids writing`, `journaling` |
| `history` | `old map`, `ancient artifacts`, `historic building`, `museum`, `cape dutch architecture`, `vintage objects`, `parchment`, `old photographs sepia` |
| `lifeskills` | `kids playing outside`, `team sports kids`, `family meal`, `helping hands`, `community garden`, `friends laughing`, `first aid kit`, `healthy food` |

## Faster curation: `scripts/seed-photos.js`

Rather than searching by hand for 50 photos, run the seed-photos helper.
It calls a stock-photo API to fetch ~15 candidates per category (~90
total), downloads each as a JPG into `_candidates/<category>/`, and
writes a `_credits.json` sibling so every candidate is traceable back to
its photographer and source URL.

The script supports **two providers**, auto-detected from which API-key
env var is set:

| Provider | Free-tier rate limit | Approval gate | Notes |
|---|---|---|---|
| **Pexels** *(recommended)* | 200 req/hr | none — instant key | Higher headroom, simpler workflow. |
| Unsplash | 50 req/hr (Demo) | Demo instant; Production = 14 days | More aesthetic depth on some queries. |

If both keys are set, Pexels wins (the rate limits are friendlier).
There are two ways to run the script: a **GitHub Actions workflow**
(recommended — no local terminal needed) or a **local terminal command**.

### Path A — GitHub Actions (recommended)

The workflow at `.github/workflows/seed-photos.yml` runs the script on
GitHub's runner, uses your repo secret for the API key, and pushes the
candidates to a review branch you can browse directly on github.com.

**One-time setup — choose one provider:**

- **Pexels** *(easiest)*: get a free key at <https://www.pexels.com/api/>
  (instant — no approval). Add as a repo secret named `PEXELS_API_KEY`
  under **Settings → Secrets and variables → Actions**.
- **Unsplash**: get a free Access Key at
  <https://unsplash.com/oauth/applications> (Demo tier instant; ignore
  the "Production" 14-day approval — Demo is enough for the curation
  pass). Add as a repo secret named `UNSPLASH_ACCESS_KEY`.

**Each curation run:**

1. **Actions tab → "Seed Phase D photos" → Run workflow**.
   - `category`: pick one (or `all` for every category in one run).
   - `candidates`: `3` is the default (~15 per category); bump to `5`
     if a category needs more variety.
2. The workflow runs in ~30 seconds and pushes results to a review
   branch named `phase-d-candidates-<run-number>` (e.g.
   `phase-d-candidates-7`). The Actions Summary shows the branch link.
3. **Browse the review branch on github.com** —
   `lib/illustrations/photos/_candidates/<category>/` shows each JPG
   inline. Open each `_credits.json` to see photographer + source URL
   per candidate.
4. Pick favourites and tell the maintainer (or open a PR yourself)
   to copy chosen photos into `lib/illustrations/photos/<category>/`
   as `01.jpg` … `NN.jpg`.
5. Delete the review branch when curation is done. The workflow also
   uploads a `phase-d-candidates-N` artefact (auto-cleaned after 14
   days) as a backup.

**Rate limit awareness:** Pexels gives 200 req/hr — comfortably enough
for `category=all` runs. Unsplash Demo is 50 req/hr; a full all-categories
run uses ~120 calls (5 search calls + ~15 download-tracking pings per
category), so on Unsplash kick off **one category at a time**. The
script gracefully reports rate-limit errors and is safe to re-run — it
skips files already on disk.

### Path B — Local terminal

```sh
# Pexels — recommended (200 req/hr, instant key from https://www.pexels.com/api/)
export PEXELS_API_KEY="your-pexels-api-key-here"

# Or Unsplash (50 req/hr Demo, key from https://unsplash.com/oauth/applications)
export UNSPLASH_ACCESS_KEY="your-unsplash-access-key-here"

# Fetch candidates for all 6 categories (default 3 per query, ~15 per cat)
node scripts/seed-photos.js

# One category at a time
node scripts/seed-photos.js --category=mathematics

# More candidates per query (5 queries × 5 = 25 per category)
node scripts/seed-photos.js --candidates=5
```

The `_candidates/` directory is **gitignored** — only the final ~50
curated photos under `<category>/01.jpg` … `NN.jpg` are committed.

After running:

1. Browse each `_candidates/<category>/` folder
2. Pick 8–9 you like that match the curation guide rules (kid-appropriate,
   diverse, mix of subject-matter and abstract)
3. Copy chosen JPGs into the parent `<category>/` directory and rename to
   `01.jpg`, `02.jpg`, … (slot order doesn't matter for picking but does
   determine which photo appears on which slide ordinal — see
   `lib/illustrations/photos.js`)
4. Delete or keep `_candidates/` — it's gitignored either way

The script:

- Auto-detects the provider from the env var that's set (Pexels wins
  when both are present)
- Skips files already on disk so re-runs are additive
- Merges `_credits.json` across runs so adding new query terms later is
  safe and incremental
- Saves photos as `<photo-id>.jpg` so each candidate is traceable to its
  source
- For Unsplash, uses CDN URL params to request a pre-cropped 1200×800
  JPG and pings the photographer's download counter as the API ToS
  requires; for Pexels, downloads the `large` rendition (~940 px wide,
  cover-cropped at PowerPoint render time)
- Reports rate-limit errors clearly and continues — re-run later when
  the limit window rolls over

## After dropping photos in

The picker reads from disk at render time — no rebuild needed. Generate
a Lesson and verify the photos appear on `concept` / `example` / `warmUp`
slides. If you want to swap or refresh a photo, just replace the file
on disk; the next generation will pick it up (cache permitting — bump
the cache version if you want to force re-renders).

## Phase D v2 ideas (post-validation)

- Per-grade-band photo sub-buckets (junior gets brighter / character
  shots, senior gets cleaner / more neutral compositions)
- Per-language buckets (an Afrikaans Lesson could pull from a small
  SA-specific sub-library)
- Hand-curated SA-specific top-up library (~10–20 photos paid via
  iAfrica or Africa Media Online if generic stock starts feeling off)
