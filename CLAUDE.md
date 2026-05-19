# A Dollar Of Discipline — Project Guide
# OneSignal ID: 70614f7a-7945-4604-89a4-28891e6fba09

## What this app is

Financial accountability app. User sets a discipline goal (habit), commits to a schedule, submits photo/video proof each session, or gets automatically charged a penalty they set upfront. No loopholes, no refunds.

This repo is the **mobile client** (Expo iOS app). The backend lives in the sibling directory `../backend` — see the **Backend** section below.

## Tech stack (client)

- **Framework:** Expo (SDK 54) + Expo Router v6 (file-based routing, typed routes)
- **Language:** TypeScript
- **UI:** React Native with custom StyleSheet (no Tailwind/Nativewind)
- **Animation:** React Native Reanimated v4
- **State:** Zustand stores with `persist` (AsyncStorage) — `store/*.ts`
- **SVG:** react-native-svg
- **Haptics:** expo-haptics
- **Blur/Gradient:** expo-blur + expo-linear-gradient + expo-glass-effect (iOS 26+ liquid glass)
- **Auth:** expo-auth-session (Google) + expo-apple-authentication
- **Payments:** @stripe/stripe-react-native (PaymentSheet for off-session card setup)
- **Native alarms:** `expo-alarm-kit` (iOS AlarmKit, patched — see `patches/`) with App Group `group.com.dollar-discipline.app`
- **Push:** OneSignal (`onesignal-expo-plugin`)

## Design system

All tokens live in `constants/theme.ts`.

| Token | Value |
|---|---|
| bg | `#202226` |
| bgDeep | `#16181B` |
| bgElevated | `#2A2D33` |
| text | `#E7E7E9` |
| textMuted | `#C4C4DF` |
| accent1 | `#9CADD8` (primary accent, blue-grey) |
| accent2 | `#7793C2` |
| accent3 | `#5A6484` |
| border | `rgba(156,173,216,0.18)` |
| borderStrong | `rgba(156,173,216,0.32)` |
| danger | `#E26D6D` |
| success | `#7DD3A8` |

Typography scale: `display` (40/700), `title` (28/700), `heading` (22/600), `body` (16/400), `bodyStrong` (16/600), `caption` (13/500), `micro` (11/600).

Radius: sm=10, md=16, lg=22, xl=28, pill=999.

Glassmorphism aesthetic: BlurView + LinearGradient overlays + glow shadows.

## Client app structure

```
app/
├── _layout.tsx           Root stack. Bootstraps: authStore.hydrate → userProfileStore.hydrate
│                         → hydrateAlarmEvents → hydrateDisciplines → initAlarms
│                         → syncTimezoneToBackend → fetchGoals → syncAlarmSchedules
│                         → handleLaunchPayload. Same chain runs on AppState 'active'.
├── index.tsx             Welcome / sign-in entry. Routes to /auth or /(tabs).
├── auth.tsx              Google + Apple sign-in. Calls syncTimezoneToBackend after signIn.
├── add-discipline.tsx    Multi-step wizard for creating a goal (uses StepXxx components).
├── goal-detail.tsx       Per-goal screen: stats card, weekly grid, sessions list, edit.
├── submit-proof.tsx      Camera + AI verification flow during the proof window.
├── days-active.tsx       Weekly day-by-day view of all active goals.
├── sessions-history.tsx  Per-goal session history with verdicts/proof thumbnails.
├── transactions.tsx      All Stripe charges (succeeded + failed) for the user.
├── payment-setup.tsx     Stripe PaymentSheet — collect / replace card.
├── onboarding/           9-step intro + profile flow (marketing + profile questions)
└── (tabs)/               Dashboard tabs (Home, Profile) — glass tab bar

components/
├── CelestialBackground.tsx, GlassCard.tsx, PrimaryButton.tsx, SelectCard.tsx, ProgressBar.tsx
└── onboarding/           StepXxx components for both onboarding & add-discipline flows

services/
├── alarmService.ts       Schedule/cancel native alarms + syncAlarmSchedules + launch payload
├── timezoneSync.ts       PATCH /users/:id with Intl IANA tz on signin/launch/foreground
├── oneSignal.ts          Push init
└── (proof flow helpers)

store/                    Zustand + persist (AsyncStorage)
├── auth.ts               { isAuthenticated, userId, backendUserId, accessToken, refreshToken }
├── userProfile.ts        { onboardingComplete, gender, weight, ... }
├── onboarding.ts         Discipline-goal in-progress state (during add-discipline wizard)
├── disciplines.ts        DisciplineGoal[] — fetchGoals, addGoal, updateGoal, removeGoal
├── alarmEvents.ts        Recent native alarm fires (for UI feedback)
└── paymentMethod.ts      Stripe card brand/last4 for display

constants/
├── api.ts                API_BASE_URL + apiFetch (handles 401 refresh w/ mutex)
├── alarmConfig.ts        APP_GROUP_ID, ALARM_PAYLOAD_PREFIX
└── theme.ts              All design tokens

patches/
└── expo-alarm-kit+0.1.11.patch   Patches AlarmPresentation.Alert + Alarm.CountdownDuration
```

## Discipline types & per-type wizard flows

Defined in `store/onboarding.ts`. Add-discipline wizard `buildSteps(discipline)` is dynamic:

| Discipline | Steps |
|---|---|
| `loseweight` | Discipline → WeightGoal → Schedule → Duration → ProofSnap → Penalty → Why → Agreement |
| `prayer` / `custom` | Discipline → Schedule → AlarmCountdown → ProofCustomDescription → ProofSnap → Penalty → Why → Agreement |
| `study` / `workout` / `work` / `bedtime` / `wakeup` | Discipline → Schedule → AlarmCountdown → ProofSnap → Penalty → Why → Agreement |

Key onboarding fields: `days`, `time`, `durationMinutes`, `countdownMinutes` (proof-window length, default 15), `proof` (`photo`|`video`|`both`), `proofDescription`, `penaltyAmount`, `why`, `agreementChecks`, `weightUnit`, `currentWeight?`, `goalWeight?`.

## Native alarm system

- Each goal has a stable `alarmId` (UUID) → mapped to a native iOS AlarmKit alarm via `expo-alarm-kit`.
- `services/alarmService.ts → scheduleGoalAlarms(goal)` schedules a repeating alarm for the goal's `days` + `time`. Title embeds `goal.why` so it shows on the lock screen for motivation.
- On dismiss, AlarmKit launches the app with a payload (`discipline:<goalId>` or `countdown:<goalId>`). `handleLaunchPayload` routes to the correct screen.
- App Group `group.com.dollar-discipline.app` is required (Xcode entitlement) for shared storage between app + dismiss intent.

## Cross-device alarm sync

When the user edits an alarm on device A (e.g. simulator) and opens device B (e.g. phone), device B's native alarms must update.

Flow (in `_layout.tsx` bootstrap **and** AppState 'active'):

1. Snapshot `oldGoals = disciplinesStore.get().goals`
2. `await syncTimezoneToBackend()` — push device IANA tz so server uses correct tz for any new sessions.
3. `await disciplinesStore.fetchGoals()` — overwrite store with backend truth.
4. `await syncAlarmSchedules(oldGoals, newGoals)` — for each goal whose `time`, `days`, `countdownMinutes` or `why` changed, re-call `scheduleGoalAlarms` (iOS replaces in place by `alarmId`). Local goal data is **not** rewritten — `fetchGoals` already did that.

## Timezone handling (critical — read this!)

`user.timezone` defaults to `'UTC'` server-side. The server's hourly cron (daily session creator) uses this tz to compute each session's `scheduledDate` UTC instant. **If `user.timezone` is wrong, sessions are created at the wrong UTC moment**, leading to "orphan" rows and double-charges (see `services/chargeService.ts` defensive guard).

The client must push the correct IANA tz **before** any backend session creation:

- `services/timezoneSync.ts` calls `PATCH /api/users/:id` with `Intl.DateTimeFormat().resolvedOptions().timeZone`.
- Triggered: on app bootstrap (before `fetchGoals`), on AppState 'active' (in case user travelled), and immediately after both Google and Apple `signIn` flows.
- Backend validates the string with `IANAZone.isValidZone()` and silently drops invalid values rather than poisoning the column.

## Auth & session refresh

`constants/api.ts → apiFetch` handles every authenticated call. On 401 it shares one in-flight refresh promise (mutex) so multiple parallel calls returning from background don't race-rotate the refresh token.

`authStore.signIn` → persists `userId`, `backendUserId`, tokens. `signOut` clears everything.

## Stripe penalty flow

1. User adds a card via `payment-setup.tsx` → Stripe PaymentSheet → backend stores `stripeCustomerId` + `stripePaymentMethodId` on the user.
2. When a session's proof window expires unverified, the backend's proof-window worker (or hourly reconciler) calls `chargeSession()` → off-session Stripe `paymentIntent.create({ confirm: true })`.
3. Success → `PenaltyCharge` row. Failure → `FailedCharge` row (reconciler retries hourly).

## Push notifications (OneSignal)

OneSignal App ID `70614f7a-7945-4604-89a4-28891e6fba09` (also in `services/oneSignal.ts` client-side). The mobile client requests permission and PATCHes `User.oneSignalId` (the player/subscription id) to the backend via `/api/users/:id`.

**Server-side env vars** (`backend/.env`):

- `ONESIGNAL_APP_ID` — public app id
- `ONESIGNAL_REST_API_KEY` — secret REST API key (server-only). Fetch from OneSignal dashboard → Settings → Keys & IDs.

### Notification types

| Type | When | Trigger location |
|---|---|---|
| `upcoming_goal` | 15 min before scheduled time | `workers/scheduledWorker.ts` daily-session-creator → `enqueueDelayedNotification` |
| `countdown_started` | Alarm fires, proof window opens | `routes/alarms.ts /alarm/session-started` (instant) |
| `countdown_expiring` | 5 min before proof deadline (only if window > 6 min) | `routes/alarms.ts /alarm/session-started` → `enqueueDelayedNotification` |
| `charge_succeeded` | Stripe charge succeeds | `services/chargeService.ts` after PenaltyCharge insert (instant) |
| `charge_failed` | Stripe charge fails | `services/chargeService.ts` after FailedCharge insert (instant) |
| `streak_milestone` | Verified session completes a 3 / 7 / 14 / 30 / 60 / 100 / 365-day streak | `routes/proof.ts` after ACCEPTED verdict |
| `morning_motivation` | 60 min before each scheduled session — AI personalized using `goal.why` | `workers/scheduledWorker.ts` daily-session-creator → `enqueueDelayedNotification` (kind `morning-motivation`) |
| `streak_at_risk` | ~3 min before proof deadline, only if streak ≥3 & session still pending | `workers/scheduledWorker.ts` daily-session-creator → `enqueueDelayedNotification` (kind `streak-at-risk`) |
| `comeback` | First ACCEPTED session after a previous scheduled day was missed — AI personalized | `routes/proof.ts` after ACCEPTED verdict → `maybeSendComebackNudge` |
| `weekly_recap` | Sunday 20:00 in user's local tz — saved $X, lost $Y, sessions done | `workers/scheduledWorker.ts` `weekly-recap-dispatch` (hourly cron, fires per-user when local Sunday 8pm) |

### Architecture

- **`services/oneSignal.ts`** — low-level REST client. POSTs to `https://onesignal.com/api/v1/notifications` with `Authorization: Basic <REST_API_KEY>`. Never throws — returns `{ ok: false, errors }` so callers can log and continue.
- **`services/notificationService.ts`** — domain templates (`sendUpcomingGoalReminder`, `sendCountdownStarted`, `sendCountdownExpiringSoon`, `sendChargeSucceeded`, `sendChargeFailed`, `maybeSendStreakMilestone`, `sendMorningMotivational`, `sendStreakAtRisk`, `maybeSendComebackNudge`, `sendWeeklyRecap`). Each looks up `User.oneSignalId`; if absent (user denied push), it silently no-ops.
- **`services/motivationalAI.ts`** — OpenAI wrapper (`gpt-4o-mini`, JSON mode) that generates short personalized push messages (title ≤40 char, message ≤110 char) using `goal.why`, `goal.type`, and `goal.penaltyAmount`. Three kinds: `morning`, `streak_risk`, `comeback`. On any error returns a templated fallback so a notification still goes out.
- **`queues/notificationQueue.ts` + `workers/notificationWorker.ts`** — BullMQ queue for delayed jobs. Kinds: `upcoming-goal`, `countdown-expiring`, `morning-motivation`, `streak-at-risk`, `weekly-recap`. Deterministic `jobId = ${kind}:${goalId|userId}:${scheduledDate}` dedups across hourly creator runs (weekly-recap uses ISO-week as scheduledDate). Worker re-checks goal/session state at fire time and skips stale reminders (already verified, charged, or goal deactivated).
- **Worker boot** — `startNotificationWorker()` is called from `server.ts` alongside `startProofWindowWorker` and `startScheduledWorker`.

### Failure semantics

Notifications are always **fire-and-forget**. A failure to send must NEVER:
- Roll back a Stripe charge
- Cause a 500 on `/proof/submit` or `/alarm/session-started`
- Block the daily session creator

All call sites use `.catch(err => console.error(...))` on the promise.

## Design system

All tokens in `constants/theme.ts`. Glassmorphism aesthetic (BlurView + LinearGradient + glow shadows).

| Token | Value | | Token | Value |
|---|---|---|---|---|
| bg | `#202226` | | accent1 | `#9CADD8` (primary, blue-grey) |
| bgDeep | `#16181B` | | accent2 | `#7793C2` |
| bgElevated | `#2A2D33` | | accent3 | `#5A6484` |
| text | `#E7E7E9` | | danger | `#E26D6D` |
| textMuted | `#C4C4DF` | | success | `#7DD3A8` |

Typography: `display` (40/700), `title` (28/700), `heading` (22/600), `body` (16/400), `bodyStrong` (16/600), `caption` (13/500), `micro` (11/600). Radius: sm=10, md=16, lg=22, xl=28, pill=999.

## Activity & streak logic

All activity data flows from `GET /api/users/:id/activity?days=N` → `store/activity.ts`.

### DayCell status (`buildDayCells`)
Per local calendar day, per goal, dedupe: if any session for a goal is ACCEPTED, all other sessions for that goal on that day are ignored (orphan suppression). Status priority: `upcoming` → `charged` → `failed` → `accepted` → `partial` → `pending` → `off`.
- `accepted` — ALL scheduled goals for that day have an ACCEPTED session
- `partial` — some but not all scheduled goals accepted
- `charged` — at least one goal has a `penaltyCharged=true` session (no accepted sibling)
- `failed` — REJECTED or CANT_PROVE, not charged
- `pending` — today, no verdict yet

### Lost / Saved tiles (`computeMoney`)
- **Saved**: sum `penaltyAmount` for every ACCEPTED session
- **Lost**: sum per `(goalId, local-date)` key (at most once per goal-day):
  - Stripe-confirmed charge → use `penaltyCharge.amountCents`
  - REJECTED or CANT_PROVE (no confirmed charge) → use `goal.penaltyAmount`
  - Does NOT suppress if an accepted sibling exists — user can lose money on an orphan session even if they later succeeded
  - Deduped by `countedLossKeys` so multiple rejected sessions same day count only once

### Current streak (`computeCurrentStreak`)
- Scans `DayCell[]` from yesterday backward; rest days (not scheduled) skipped
- Breaks on first scheduled day where `status !== 'accepted'` — partial does NOT maintain streak
- Today excluded from break logic (user still has time to complete)
- Today adds +1 only if already `accepted`

### Longest streak (backend, `routes/users.ts`)
- All-time ACCEPTED sessions grouped by local date in user's IANA timezone
- Max consecutive calendar days with ≥1 accepted session
- Separate query from the windowed activity fetch so it's always all-time

## Things to keep in mind

- Never modify `constants/theme.ts` tokens without updating all usages.
- Android: BlurView falls back to `intensity={0}` — don't rely on blur for visual hierarchy.
- `onboardingStore` (discipline-goal wizard state) ≠ `userProfileStore` (profile data).
- All penalty/proof screens must include: "Missed commitments result in automatic charges. No refunds."
- Never write to local `DisciplineGoal` during alarm-sync — `fetchGoals` already did that.
- After modifying anything in `app/`, alarm payloads, or auth flow, test bootstrap path on cold start and on foreground.

---

# Backend (`../backend`)

The backend is a separate repo at `/Users/arifulwadud/Dollar Discipline/backend`. Open it with `cd ../backend` from the client root.

## Hosting & access

- **Production:** [Railway](https://railway.app) — `https://backend-production-2709.up.railway.app` (set in `constants/api.ts → API_BASE_URL`).
- **Auto-deploy:** Pushing to the backend's `main` branch triggers a Railway build + deploy.
- **Logs / env / DB URL:** Railway dashboard → project → service.
- **Postgres:** managed by Railway. `DATABASE_URL` is injected as env.
- **Redis:** Railway Redis add-on, used by BullMQ queues. `REDIS_URL` injected as env.
- **R2:** Cloudflare R2 (S3-compatible) for proof image storage. Creds in env.
- **Stripe:** secret key + webhook signing secret in env. Test mode for dev, live for prod.
- **OpenAI:** for proof verification vision API.

Local dev: `npm run dev` in `../backend` (nodemon + ts-node). Point the client at LAN IP via `API_BASE_URL`.

## Stack

- **Fastify 4** — HTTP server (`src/server.ts`)
- **Prisma 5** — ORM, schema in `prisma/schema.prisma`
- **BullMQ** — delayed/retry job queues backed by Redis
- **Stripe Node SDK** — penalty charges (off-session confirm)
- **Luxon** — all timezone math (IANA-aware)
- **OpenAI** — proof image verification
- **AWS SDK S3** — talks to Cloudflare R2 for proof uploads
- **JWT** (`jsonwebtoken`) — access + refresh tokens

## Backend structure

```
backend/
├── prisma/
│   └── schema.prisma         User, Goal, GoalSession, PenaltyCharge, FailedCharge,
│                             OnboardingProfile, RefreshToken
├── sql/                      Ad-hoc queries / migrations notes
└── src/
    ├── index.ts              Entry point — buildServer().listen()
    ├── server.ts             buildServer(): cors, prismaPlugin, authPlugin, all routes
    │                         under /api prefix; starts proofWindowWorker + scheduledWorker.
    ├── plugins/
    │   ├── prisma.ts         Decorates fastify with server.prisma
    │   └── auth.ts           server.authenticate preHandler — verifies JWT, sets req.userId
    ├── routes/
    │   ├── auth.ts           POST /auth/signin, /auth/refresh, /auth/signout (Google/Apple)
    │   ├── users.ts          GET/PATCH/DELETE /users/:id, PUT /users/:id/onboarding
    │   │                     (PATCH validates timezone via IANAZone.isValidZone)
    │   ├── goals.ts          CRUD /goals, /users/:userId/goals, /goals/:id/sessions,
    │   │                     /goals/:id/charges/summary
    │   ├── sessions.ts       Session CRUD + verify/charge endpoints
    │   ├── proof.ts          POST /goals/:id/proof/submit (AI verify),
    │   │                     POST /goals/:id/proof/cant-prove (declares failure → charge),
    │   │                     GET  /goals/:id/sessions/week (weekly summary)
    │   ├── stripe.ts         Card setup, webhooks, /users/:userId/charges (per-user list)
    │   └── alarms.ts         POST /alarm/session-started — called by client when alarm
    │                         fires; updates user.timezone (if valid), upserts canonical
    │                         GoalSession, enqueues proof-window check.
    ├── services/
    │   ├── chargeService.ts  chargeSession(sessionId, source) — atomic claim →
    │   │                     defensive same-day verified-sibling guard → Stripe charge →
    │   │                     PenaltyCharge / FailedCharge row.
    │   ├── proofVerifier.ts  OpenAI vision call to ACCEPT/REJECT proof images.
    │   ├── r2.ts             Upload base64 → Cloudflare R2.
    │   └── token.ts          JWT issue/verify.
    ├── queues/
    │   └── proofWindowQueue.ts   BullMQ queue + enqueueProofWindowCheck (deterministic
    │                              jobId per session for dedup).
    ├── workers/
    │   ├── proofWindowWorker.ts  Fires N min after alarm — calls chargeSession().
    │   └── scheduledWorker.ts    Hourly cron:
    │                              (a) Daily session creator: upsert today's GoalSession
    │                                  for every active goal in the user's tz.
    │                              (b) Reconciler: charge any overdue session with no
    │                                  proof / not yet charged (16 min+ past scheduledDate).
    └── lib/
        ├── redis.ts          getRedisConnectionOptions()
        └── scheduleDate.ts   goalScheduledDateUtcForDate(time, tz, "YYYY-MM-DD"),
                              extractLocalDate(iso) — canonicalises scheduledDate so
                              every endpoint hits the same DB row.
```

## Key DB models (see `prisma/schema.prisma`)

- **User** — `provider`/`providerId`, `stripeCustomerId`, `stripePaymentMethodId`, `hasPaymentMethod`, `timezone` (default `'UTC'`, IANA-validated on writes), `oneSignalId`.
- **Goal** — `userId`, `type`, `customName`, `time`, `days[]`, `countdownMinutes`, `penaltyAmount`, `why`, `proofType`, `proofDescription`, `alarmIds` (JSON: `{ alarm, countdown }`), `isActive`.
- **GoalSession** — unique on `(goalId, scheduledDate)`. Fields: `verdict` (`PENDING|ACCEPTED|REJECTED|CANT_PROVE`), `verified`, `proofSubmitted`, `proofUrl`, `chargeDue`, `penaltyCharged`, `aiResponse`.
- **PenaltyCharge** — successful Stripe charge. `sessionId @unique` (final dedup guard). `amountCents`, `stripePaymentIntentId`, `stripeStatus`.
- **FailedCharge** — failed attempt (Stripe error, reconciler will retry).

## Important invariants

- All routes mount under `/api` (`server.ts`). Frontend uses `apiFetch('/api/...')`.
- `scheduledDate` is **always** a UTC instant computed from `goal.time` + `user.timezone` for a specific local calendar day. Use `goalScheduledDateUtcForDate` everywhere — never construct manually.
- `chargeSession` is the **only** code path that creates `PenaltyCharge` rows. It uses an atomic `updateMany` claim (`chargeDue: false → true`) so two workers can't double-charge.
- Defensive guard in `chargeService` skips charging if any sibling session for the same goal on the same local-day (in user's tz) is already verified — protects against orphan rows from old `'UTC'`-default sessions.
- Daily session creator runs **hourly** (not at midnight) because "today" starts at different UTC moments per user tz. Upsert is idempotent.

## Common dev workflows

### Client (this repo)

```bash
npm install
npx expo prebuild --clean        # regenerate ios/android (after native plugin/patch changes)
npx expo run:ios                 # build + launch in simulator (requires Xcode)
npx expo start                   # JS-only dev server (use --tunnel for physical device on different network)
```

If you change `patches/expo-alarm-kit*.patch`, run `npx patch-package` (auto-runs on `npm install` via `postinstall`).

### Backend (`../backend`)

```bash
cd ../backend
npm install
cp .env.example .env             # then fill DATABASE_URL, REDIS_URL, STRIPE_SECRET_KEY, OPENAI_API_KEY, R2_*

npm run dev                      # nodemon + ts-node, hot reload on src/**
npm run db:studio                # Prisma Studio — visual DB browser
npm run db:migrate -- --name <x> # create + apply a new migration in dev
npm run db:push                  # push schema without a migration (prototype only)
npm run db:generate              # regen Prisma client after schema edit
npm run build && npm start       # production build + run
```

**Deploy:** push to backend `main` → Railway auto-builds. Check logs in the Railway dashboard. Env vars (incl. `DATABASE_URL`, `REDIS_URL`) are managed there.

**Connecting client to local backend:** edit `constants/api.ts → API_BASE_URL` to your LAN IP (e.g. `http://192.168.x.x:3000`) when running on a physical device. Simulator can use `http://localhost:3000`.

### Debugging the most painful failure modes

**"User got charged twice / charged after verifying":**
1. Check `user.timezone` in DB — should be a real IANA zone, not `'UTC'` for non-UTC users.
2. Check `GoalSession` rows for that goal on the affected local date — there should be exactly one. If multiple, the older one is an orphan from a tz race; the `chargeService` defensive guard skips charging it as long as a sibling is verified.
3. Look for `[ChargeService] Skipping orphan session=...` lines in Railway logs.

**"Alarms didn't update on phone after editing on simulator":**
1. Foreground/cold-launch the app on the phone — `_layout.tsx` runs `fetchGoals` + `syncAlarmSchedules` only on these events.
2. Look for `[AlarmService] syncAlarmSchedules — rescheduling goal:` log — confirms a diff was detected.
3. Verify both devices share the same `backendUserId` (same auth provider account).

**"Daily session not created today":**
1. Confirm `Goal.isActive=true` and today's day-of-week (in user tz) is in `Goal.days`.
2. Confirm `user.timezone` is correct.
3. Check Railway logs for `[DailySessionCreator] goals=N created=… existing=… skipped_wrong_day=…` — runs hourly.

**"Stripe charge failed":**
1. Check `FailedCharge` table for the error code.
2. The reconciler retries hourly until `penaltyCharged=true` or the user removes their payment method.
