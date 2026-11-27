# VoteDex

A plain-English look at how Congress and the New Hampshire legislature vote, who pays for their campaigns, and what bills mean for you.

The site is one static page (`site/index.html`) that reads JSON files from `site/data/`. A GitHub Action refreshes those files every morning and publishes the site to GitHub Pages. No server, no cost.

## Where the data comes from

| What | Source | Key needed |
|---|---|---|
| Members of Congress | [congress-legislators](https://github.com/unitedstates/congress-legislators) | none |
| House roll-call votes | clerk.house.gov XML | none |
| Senate roll-call votes | senate.gov XML | none |
| Bills, summaries, bills sponsored | Congress.gov API | `DATA_GOV_API_KEY` |
| Campaign money, top donor employers | FEC API | `DATA_GOV_API_KEY` |
| NH legislators | Open States bulk CSV | none |
| NH roll-call votes | Open States API | `OPENSTATES_API_KEY` (optional) |
| Address to districts | U.S. Census geocoder, called from the browser | none |

One api.data.gov key works for both Congress.gov and the FEC. The FEC allows about 1,000 requests an hour, so donor data for all 535 members fills in over the first few days and then stays current on a rolling basis.

## Setup (one time)

1. **Add the key as a secret.** Repo → Settings → Secrets and variables → Actions → New repository secret. Name `DATA_GOV_API_KEY`, value your api.data.gov key. (Optional: `OPENSTATES_API_KEY` from open.pluralpolicy.com for NH votes.)
2. **Turn on Pages.** Repo → Settings → Pages → Source: **GitHub Actions**.
3. **Run it.** Actions tab → "Refresh data and publish" → Run workflow. The first run takes 20 to 40 minutes because it downloads every roll call of the current Congress.

After that it runs every morning at about 5 AM Eastern, plus a donors-only run at about 5 PM.

**How fresh is donor money?** Each member's FEC data is re-checked every week, and every day from Aug 1 to Dec 15 of election years (3 months before the general election through the post-general report) and for 10 days after each quarterly FEC deadline (Jan 31, Apr 15, Jul 15, Oct 15). Member pages show which filing the numbers come from.

## Run locally

```
npm ci
DATA_GOV_API_KEY=your-key node scripts/refresh.mjs          # everything
node scripts/refresh.mjs votes members states               # just the parts with no key
npm run serve                                               # http://localhost:8080
```
