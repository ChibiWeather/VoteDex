# VoteDex for iPhone

The iPhone app is the VoteDex website wrapped with [Capacitor](https://capacitorjs.com).
The pages ship inside the app; bills, votes and money load from
https://chibiweather.github.io/VoteDex/ so the app is always current.

The app saves the user's state, districts, ballot votes, topics and alert
settings in their **own iCloud** (iCloud key-value storage), so they follow the
user to their other iPhones and iPads. VoteDex never sees that data, so the
App Store label "Data Not Collected" stays true.

No Mac is needed. A Mac in GitHub's cloud builds and uploads the app
(`.github/workflows/ios.yml`).

## One-time setup

### 1. Turn on iCloud for the App ID
1. Go to https://developer.apple.com/account and click **Certificates, IDs & Profiles**.
2. Click **Identifiers** on the left, then click **VoteDex** (`com.chibiweather.votedex`).
3. On the **Capabilities** list, tick **iCloud**. If it asks, pick **Include CloudKit support**. You don't need to add a container.
4. Click **Save** (top right), then **Confirm** in the pop-up.

### 2. Make an App Store Connect API key
1. Go to https://appstoreconnect.apple.com and click **Users and Access**.
2. Click the **Integrations** tab, then **App Store Connect API** on the left, then **Team Keys**.
   If you see **Request Access**, click it and accept.
3. Click the **+** button. Name it `VoteDex GitHub` and set Access to **Admin**
   (Admin lets the build make its own signing certificate). Click **Generate**.
4. Copy the **Issuer ID** (above the table) and the **Key ID** (in the new row).
5. Click **Download** on the new row. You get `AuthKey_XXXXXXXXXX.p8`. Apple lets you download it only once, so keep it safe.

### 3. Find your Team ID
https://developer.apple.com/account, scroll to **Membership details**, copy the 10-character **Team ID**.

### 4. Add four secrets on GitHub
https://github.com/ChibiWeather/VoteDex/settings/secrets/actions, click **New repository secret** for each:

| Name | Value |
|---|---|
| `APPLE_TEAM_ID` | Team ID from step 3 |
| `ASC_KEY_ID` | Key ID from step 2 |
| `ASC_ISSUER_ID` | Issuer ID from step 2 |
| `ASC_KEY_P8` | Open the `.p8` file in Notepad and paste all of it, including the `BEGIN` and `END` lines |

## Build and upload
1. On GitHub, open the **Actions** tab and click **Build iPhone app and send to App Store Connect**.
2. Click **Run workflow**, keep version `1.0` (or type a new one), and click **Run workflow**.
3. It takes about 15 to 25 minutes. When it is green, the build shows up in
   App Store Connect under **VoteDex > TestFlight** after Apple finishes processing (about 10 to 30 minutes).
4. Install **TestFlight** on your iPhone to try it, then pick the build on the App Store tab and submit for review.

## For developers
```
cd app
npm ci
npm run sync          # copies ../site into the app
npx cap open ios      # on a Mac, opens Xcode
node scripts/make-art.cjs   # redraws the pixel icon and launch screen (needs `npm ci` at the repo root)
```
