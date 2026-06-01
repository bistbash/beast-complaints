# Beast Complaints — ניהול פניות לקוח

מערכת לטיפול בפניות הורים/לקוחות. בנויה על:

- **Beast** — SSO, AD groups, user-roles, in-app notifications, app directory.
- **db-smart** — שמירת הפניות ב-dataset יחיד (שורה לכל פנייה).
- **PostgreSQL** עזר — טבלאות auxiliary (messages, history, notifications).
- **Express + React (Vite) + TypeScript**, RTL, מצב כהה, עיצוב מותאם.

---

## תהליך העבודה (workflow)

```
┌──────────────────────┐
│ הורה / לקוח חיצוני   │  ממלא Google Form
└──────────┬───────────┘
           │ db-smart מסנכרן את ה-Sheet → PostgreSQL
           ▼
       ┌───────┐ status = new (ברירת מחדל)
       │ פנייה │ inquiry_id = gen_random_uuid() (ברירת מחדל)
       └───┬───┘
           │ נע"ט מנתב (לחבר צוות בקבוצה X)
           ▼
       ┌─────────┐ status = routed
       │ צוות    │ assigned_user = team_member
       └────┬────┘
            │ חבר הצוות כותב team_response
            ▼
       ┌────────────────────┐ status = awaiting_manager
       │ ממתינה למנהל       │
       └────┬───────────────┘
            │ מנהל כותב manager_response
            ▼
       ┌────────┐ status = closed
       │ נסגרה  │ → מייל סיום נשלח לפונה (Gmail API)
       └────────┘
```

**מסלול חלופי:** הנע"ט יכול לנתב פנייה ישירות למנהל (Bypass של שלב הצוות) — הסטטוס קופץ ישר ל-`awaiting_manager`.

---

## תפקידים והרשאות

| תפקיד                  | הגדרה ב-Beast                                  | רואה                                     | יכול לנתב                               | יכול לסגור |
|------------------------|------------------------------------------------|------------------------------------------|------------------------------------------|------------|
| **מנהל מערכת** (admin) | AD group `ADMIN_GROUP` (ברירת מחדל `tichnun`)  | הכל                                      | לכל קבוצה                                | כן         |
| **נע"ט פניות לקוח**    | platform role `NAVIGATOR_ROLE_KEY` (`naat_pniot_lakoach`) | הכל                       | לכל קבוצה                                | לא         |
| **מנהל** (manager)     | `ADMIN_GROUP` *או* role מתוך `MANAGER_ROLE_KEYS` (`madr`) | הכל                  | לא (מנהלים כותבים החלטה סופית)           | כן         |
| **קבע** (keva)         | AD group `KEVA_GROUP` (`keva`)                 | כל פניות הצוותים (גם של אחרים)           | **רק לקבוצות שהוא חבר בהן**              | לא         |
| **חבר צוות רגיל**      | חבר בקבוצה X (לא keva)                         | רק פניות ששויכו אישית אליו או לקבוצה שלו | לא                                       | לא         |

---

## ה-dataset ב-db-smart

הפניות מסונכרנות מ-**Google Form** אל **Google Sheet** אל db-smart. ב-db-smart יש להגדיר dataset שמסנכרן את הגיליון.

### עמודות מ-Google Form (מנוהלות על ידי db-smart)

db-smart מסנכרן את העמודות הללו אוטומטית — אל **תיגע** בהן באפליקציה הזאת:

| עמודה              | סוג     | תיאור                                            |
|--------------------|---------|--------------------------------------------------|
| `timestamp` (PK)   | text    | תאריך הגשה ב-Google Form (`DD/MM/YYYY HH:MM:SS`) |
| `email`            | text    | מייל הפונה                                       |
| `full_name`        | text    | שם מלא                                           |
| `phone_number`     | integer | טלפון                                            |
| `requester_type`   | text    | סוג הפונה (הורה/אפוטרופוס/...)                   |
| `role_bislat`      | text    | תפקיד בבסל"ת                                     |
| `department`       | text    | מחלקה                                            |
| `entity`           | text    | גורם                                             |
| `role`             | text    | תפקיד                                            |
| `grade_level`      | text    | שכבה                                             |
| `class_name`       | integer | כיתה                                             |
| `request_category` | text    | קטגוריית הבקשה                                   |
| `title`            | text    | נושא                                             |
| `description`      | text    | תיאור מפורט                                      |

### עמודות workflow (נוצרות אוטומטית על ידי האפליקציה)

כשהאפליקציה עולה, היא מריצה `ensureInquiryWorkflowColumns()` שמוסיף את העמודות הללו אל ה-table של ה-dataset (`ALTER TABLE ... ADD COLUMN IF NOT EXISTS`). הסינכרון של db-smart לא ייגע בהן:

| עמודה                   | סוג         | DEFAULT             |
|-------------------------|-------------|---------------------|
| `inquiry_id`            | uuid UNIQUE | `gen_random_uuid()` |
| `status`                | text        | `'new'`             |
| `priority`              | text        | `'medium'`          |
| `created_at`            | timestamptz | `NOW()` (מעודכן בסטארטאפ לפי `timestamp` הצורני) |
| `last_activity_at`      | timestamptz | `NOW()`             |
| `due_at`                | timestamptz | `NOW() + 72h`       |
| `routed_at` / `routed_by` / `assigned_group` / `assigned_user` | | מתעדכן בעת ניתוב |
| `team_response` / `team_response_at` / `team_response_by`     | | מתעדכן ע"י חבר הצוות  |
| `manager_response` / `manager_response_at` / `manager_response_by` | | מתעדכן ע"י המנהל     |
| `closed_at` / `closing_email_sent_at`                              | | מתעדכן בעת סגירה     |

---

## הקמת המערכת

### 1. דרישות מקדימות

- Node.js 20+
- Beast portal פועל בכתובת `BEAST_PORTAL_URL`
- db-smart פועל מול PostgreSQL שאתה מחובר אליו ב-`DB_*`
- Dataset של פניות לקוח קיים ב-db-smart עם העמודות לעיל

### 2. שלבי התקנה

```bash
git clone <repo>
cd beast-complaints
cp .env.example .env
# ערוך .env לפי הסביבה שלך — חשוב: COMPLAINTS_DATASET_ID, BEAST_PORTAL_URL, DB_*
npm install
npm run dev          # מריץ backend (3050) + frontend (5180)
```

### 3. הרשמת האפליקציה ב-Beast

ב-Beast Admin → Apps:

- `app_id` = `beast-complaints` (חייב להיות זהה ל-`APP_ID` ב-`.env`)
- `app_url` = `http://your-host:3050`
- `slo_callback_url` = `http://your-host:3050/auth/slo/callback`
- שייך את האפליקציה לקבוצות `tichnun`, `keva`, `tet`, `yod`, `handesaim` וכו'.

**שמור את ה-`api_key` וה-`secret_key`** שמוחזרים בעת היצירה — הם מופיעים פעם אחת בלבד.
הוסף אותם ל-`.env`:

```
BEAST_API_KEY=beast_abc123def456...
BEAST_SECRET_KEY=xyz789...
```

ה-API key נדרש כדי לטעון את רשימת חברי הקבוצות מ-AD (כלומר כדי שתופיע רשימת חברי צוות ב-dialog הניתוב). בלעדיו, הניתוב עובד רק ברמת הקבוצה — לא לחבר ספציפי.

### 4. הגדרת תפקיד "נע"ט פניות לקוח"

ב-Beast → User Roles → Add Role:

- key: `naat_pniot_lakoach`
- name: `נע"ט פניות לקוח`
- שייך משתמשים שיהיו נע"טים.

תפקיד `madr` (מד"ר) קיים כבר ב-Beast; משתמשים עם תפקיד זה יזוהו אוטומטית כמנהלים.

### 5. הקישור הציבורי להורים

הקישור להורים הוא ה-**Google Form** שלך (לא נמצא ב-`beast-complaints` עצמו). הנתונים זורמים:

```
Google Form ──▶ Google Sheet ──▶ db-smart sync ──▶ PostgreSQL ──▶ beast-complaints
```

---

## API summary

(כל ה-API מאחורי Beast Bearer token — אין מסלול ציבורי באפליקציה הזאת.)

| Method | Path                                      | תיאור                                          | הרשאה        |
|--------|-------------------------------------------|------------------------------------------------|---------------|
| GET    | `/api/inquiries/capabilities`             | יכולות המשתמש הנוכחי                           | כל מחובר      |
| GET    | `/api/inquiries`                          | רשימה (filtered by view, status, group...)     | כל מחובר      |
| GET    | `/api/inquiries/:id`                      | פנייה + messages + history                     | מורשה (visibility-checked) |
| POST   | `/api/inquiries/:id/route`                | ניתוב (group + assignedUser + routeToManager)  | navigator / admin / keva |
| POST   | `/api/inquiries/:id/team-response`        | התייחסות צוות → awaiting_manager               | assignee / keva / navigator / admin |
| POST   | `/api/inquiries/:id/manager-response`     | התייחסות מנהל + הצדקה → closed + מייל סגירה    | manager       |
| POST   | `/api/inquiries/:id/justification`        | קביעת הצדקה (justified / unjustified) רטרואקטיבית | manager     |
| POST   | `/api/inquiries/:id/reopen`               | פתיחה מחדש                                     | manager / admin |
| POST   | `/api/inquiries/:id/priority`             | שינוי דחיפות                                   | router / manager |
| POST   | `/api/inquiries/:id/messages`             | תגובה בשיח הפנימי                              | מורשה (visibility-checked) |
| GET    | `/api/inquiries/stats`                    | סטטיסטיקות                                     | כל מחובר      |
| GET    | `/api/inquiries/lookup/groups`            | רשימת קבוצות + manageable למשתמש               | כל מחובר      |
| GET    | `/api/inquiries/lookup/members?group=X`   | חברי קבוצה                                     | כל מחובר      |
| GET    | `/api/inquiries/lookup/managers`          | רשימת המנהלים (admin group + role keys)        | כל מחובר      |
| GET    | `/api/settings/email`                     | סטטוס חיבור Gmail + הגדרות Google              | admin (תפעול הדרכה) |
| PUT    | `/api/settings/email/credentials`         | שמירת Client ID/Secret, מפתח הצפנה, redirect   | admin           |
| GET    | `/api/settings/email/templates`           | תבניות מכתב סגירה + רשימת משתנים              | admin           |
| PUT    | `/api/settings/email/templates/:kind`     | שמירת תבנית (`justified` / `unjustified`)      | admin           |
| POST   | `/api/settings/email/templates/preview`   | תצוגה מקדימה עם נתוני דוגמה                    | admin           |
| GET    | `/api/settings/email/oauth/start`         | URL להתחברות Google OAuth                      | admin           |
| GET    | `/api/settings/email/oauth/callback`      | callback מ-Google (redirect ל-/settings)       | — (signed state) |
| DELETE | `/api/settings/email`                     | ניתוק חשבון Gmail                              | admin           |
| POST   | `/api/settings/email/test`                | מייל בדיקה למנהל המחובר                        | admin           |

---

## חיבור Gmail (מייל סגירה לפונים)

משתמשי **מנהל מערכת** (`ADMIN_GROUP`, ברירת מחדל `tichnun` — תפעול הדרכה) רואים טאב **ניהול**. שם מגדירים את פרטי Google OAuth (Client ID/Secret, מפתח הצפנה) ומחברים חשבון Gmail **משותף** אחד — **ללא עריכת `.env`**. לאחר סגירת פנייה (`manager-response`), המערכת שולחת מייל סיכום ל-`submitter_email` דרך Gmail API. `closing_email_sent_at` מתעדכן רק אם השליחה הצליחה.

### הקמת Google Cloud (פעם אחת)

1. [Google Cloud Console](https://console.cloud.google.com/) → פרויקט חדש.
2. **APIs & Services** → Enable **Gmail API**.
3. **OAuth consent screen** — Internal (Workspace) או External + Test users לפיתוח.
4. **Credentials** → Create **OAuth client ID** → Web application.
5. **Authorized redirect URIs** (חייב להתאים לשרת, לא ל-Vite) — העתיקו מהטקסט בטאב ניהול:
   - פיתוח: `http://localhost:3050/api/settings/email/oauth/callback`
   - production: `https://<host-של-השרת>/api/settings/email/oauth/callback`
6. בטאב **ניהול**: תחת **הגדרות Google OAuth** (מתקפל) — Client ID, Secret, מפתח הצפנה, **שמור**, **התחבר עם Google**.
7. תחת **מכתבי סגירה** — העלו **נכסים** (לוגו, חתימה) והשתמשו ב-HTML עם משתנים כמו `{{submitter_name}}` או `{{asset_logo}}` בתוך `<img src="...">`. תבנית נפרדת לפנייה מוצדקת / לא מוצדקת.

### משתני סביבה (אופציונלי)

ניתן להגדיר גם ב-`.env` כ-fallback; עדיפות לערכים שנשמרו ב-UI (PostgreSQL).

| משתנה | תיאור |
|--------|--------|
| `APP_URL` | כתובת ה-UI (למשל `http://localhost:5180`) — redirect אחרי OAuth |
| `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` / `EMAIL_TOKEN_ENCRYPTION_KEY` | fallback בלבד |

### פתרון תקלות Gmail

| תופעה | פתרון |
|--------|--------|
| `redirect_uri_mismatch` | ה-URI ב-Google Console חייב להיות זהה לזה שמוצג בטאב ניהול (פורט השרת 3050, לא Vite). |
| `missing_refresh_token` | נתקו ב-Google Account → חיבור מחדש; OAuth משתמש ב-`prompt=consent`. |
| מייל סגירה לא נשלח | ודאו שמירת הגדרות Google + חיבור Gmail בטאב ניהול. |
| שינוי מפתח הצפנה נכשל | נתקו קודם את חשבון Gmail, שנהו מפתח, שמרו, והתחברו מחדש. |

---

## ייבוא נתונים

יש שני סקריפטים לייבוא חד-פעמי לתוך ה-dataset הקיים. שניהם הם idempotent — אפשר להריץ שוב.

| סקריפט                                                              | מקור                                                  | מה הוא עושה                                                                                                                                                          |
|---------------------------------------------------------------------|--------------------------------------------------------|----------------------------------------------------------------------------------------------------------------------------------------------------------------------|
| `npm run import-inquiries -- data/sheets.tsv`                       | Excel/TSV של ה-Google Form (14 עמודות ה-sheet)        | מסנכרן עמודות sheet בלבד (timestamp, email, full_name...). שורות חדשות מקבלות workflow ברירת מחדל (`status='new'`).                                                  |
| `npm run import-legacy-db -- data/legacy.tsv`                       | Export של complaints-manager הקודם (עם JSON columns)   | ממלא workflow data של שורות קיימות: status, assigned_group/user, team_response, manager_response, justification, closed_at, וגם מייבא את message thread.             |

הסקריפטים מתאימים שורות לפי `(timestamp, email)`. ה-legacy script ממיר ISO UTC → "DD/MM/YYYY HH:MM:SS" באזור זמן Asia/Jerusalem כדי להתאים לפורמט של db-smart sync. כל סקריפט תומך ב-`--dry-run` להצגת תוצאות ללא כתיבה.

---

## TODO / לא ממומש עדיין

- [ ] **תזכורות SLA**: cron שמדגיש פניות שעוברות את ה-`due_at`.
- [ ] **קוד split** של ה-bundle (כרגע ~545kB → ~152kB gzip).

---

## פתרון תקלות

| תופעה                                                  | פתרון                                                                                              |
|--------------------------------------------------------|----------------------------------------------------------------------------------------------------|
| `Dataset של פניות לקוח לא הוגדר`                       | ודא ש-`COMPLAINTS_DATASET_ID` ב-`.env` תואם ל-id של dataset קיים ב-db-smart, ושכל העמודות שלעיל קיימות. |
| `אימות מול Beast נכשל` (503)                           | בדוק ש-Beast portal זמין ב-`BEAST_PORTAL_URL` ושה-`APP_ID` רשום כאפליקציה מאושרת.                  |
| נע"ט לא רואה את התפקיד שלו                             | ודא שיש לו role עם key `naat_pniot_lakoach` ב-Beast (לא רק קבוצת AD).                              |
| חבר keva רואה רק את הפניות שלו                         | ודא שהוא ב-AD group ששמו זהה ל-`KEVA_GROUP` ב-`.env` (`keva` כברירת מחדל).                         |
| מנהל לא יכול לכתוב התייחסות                            | ודא שהוא ב-`ADMIN_GROUP` *או* יש לו role מתוך `MANAGER_ROLE_KEYS`.                                  |
| 429 על הטופס הציבורי                                   | rate limit 10/min לכל IP. אם נדרש לשנות, ערוך `routes/public.ts`.                                   |
| מייל סגירה לא נשלח לפונה                              | בטאב **ניהול**: שמרו הגדרות Google והתחברו ל-Gmail.                                                |
