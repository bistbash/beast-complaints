# Closing letter email templates — guide

This document explains how to edit **HTML closing letters** in **Settings → Management (ניהול) → Closing letters (מכתבי סגירה)**.

The system does not run JavaScript in emails and does not load external CSS files. You write **static HTML** with **placeholders** in the form `{{field_name}}`. At send time, the server fills them from the inquiry record.

---

## Where to edit and what gets sent

| UI area | Purpose |
|--------|---------|
| **Justified / Unjustified** | Two separate templates — the one used depends on the manager’s decision when closing the inquiry. |
| **Preview** | Live render with sample data (updates while you type). |
| **Edit** | Change **Subject** and **HTML** body. |
| **Active template** | What is actually sent to submitters. |
| **Drafts** | Saved variants for experimentation; **Publish** copies a draft into the active template. |
| **Add field** | Inserts a `{{variable}}` at the cursor (subject or HTML). |
| **Graphic assets** | Upload logo, signature, etc. (separate tab). |

**Save:** `Ctrl/Cmd+S` or the **Save** button (enabled only when there are unsaved changes).

**Fullscreen:** Use the expand control for a larger preview or editor; press `Esc` to exit.

---

## Placeholders (template variables)

### Syntax

```html
Hello {{submitter_name}},
Regarding: {{subject}}
```

- Optional spaces: `{{ subject }}` works the same as `{{subject}}`.
- Names use lowercase letters, digits, and underscores only.
- Unknown names are left unchanged in the output.

### Subject line (outside the HTML body)

The **Subject** field supports the same placeholders, for example:

```text
Inquiry closed: {{subject}}
```

That becomes the email’s subject line in the recipient’s inbox.

### Variable reference

| Group | Placeholder | Meaning |
|-------|-------------|---------|
| Submitter | `{{submitter_name}}` | Submitter name |
| | `{{submitter_email}}` | Email |
| | `{{submitter_phone}}` | Phone |
| | `{{submitter_relation}}` | Relationship (e.g. parent) |
| Inquiry | `{{subject}}` | Inquiry subject |
| | `{{description}}` | Full description |
| | `{{category}}` | Category (localized label) |
| | `{{form_timestamp}}` | Form submission timestamp |
| | `{{grade_level}}` | Grade level |
| | `{{class_name}}` | Class |
| | `{{department}}` | Department |
| Handling | `{{justification_label}}` | Justified / not justified (Hebrew label) |
| | `{{manager_response}}` | Manager response text |
| | `{{team_response}}` | Team response text |
| | `{{closed_at}}` | Close date/time (`he-IL`, `Asia/Jerusalem`) |
| | `{{assigned_group}}` | Assigned group (localized label) |
| Sender | `{{from_name}}` | Display name from email settings |

### How text is processed

- **Text placeholders** — Values are **HTML-escaped** (`<`, `>`, etc.) so content from the inquiry cannot inject markup.
- Do **not** put HTML inside `{{manager_response}}`; wrap the placeholder in your own `<div>` or `<p>` if you need styling around the text.
- Empty values render as **—** (em dash).

Implementation: `lib/emailTemplate.ts` → `renderTemplate()`.

---

## Images (graphic assets)

Upload assets under **Graphic assets** with an English key (e.g. `logo`, `signature`).

| Asset key | Placeholder |
|-----------|-------------|
| `logo` | `{{asset_logo}}` |
| `signature` | `{{asset_signature}}` |
| `banner` | `{{asset_banner}}` |

Rule: `asset_` + the key you defined.

### Correct usage

```html
<img src="{{asset_logo}}" alt="Logo" style="max-width:140px;height:auto;display:block;" />
```

- **Preview** — `src` becomes a `data:` URL.
- **Send** — `src` becomes `cid:asset_<key>@beast-complaints` with an inline attachment.
- If the asset was not uploaded, the placeholder becomes empty (image row may collapse).
- Do **not** paste external image URLs; use assets only.

You can copy the placeholder from the asset card in the UI.

---

## Recommended HTML structure for email

The default template in the codebase follows email-client best practices:

1. `<!DOCTYPE html>` with `lang="he"` and **`dir="rtl"`** for Hebrew.
2. **Layout tables** — `<table role="presentation">`; avoid relying on flex/grid alone.
3. **Inline styles** on each element — no `<link>` stylesheets; limited `<style>` support in clients.
4. **Content width** ~580px (`max-width:580px` on the inner table).
5. Light outer background, white card in the center.
6. Safe fonts: `Assistant`, Arial, Helvetica, sans-serif.

### Minimal example

```html
<!DOCTYPE html>
<html lang="he" dir="rtl">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
</head>
<body style="margin:0;padding:0;background:#eef2f7;font-family:Arial,Helvetica,sans-serif;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#eef2f7;padding:32px 16px;">
    <tr>
      <td align="center">
        <table role="presentation" width="100%" style="max-width:580px;background:#fff;border-radius:12px;">
          <tr>
            <td style="padding:24px;font-size:15px;line-height:1.7;color:#1e293b;">
              <p>שלום <strong>{{submitter_name}}</strong>,</p>
              <p>{{justification_label}}</p>
              <div style="white-space:pre-wrap;background:#f1f5f9;padding:12px;border-radius:8px;">
                {{manager_response}}
              </div>
              <p style="margin-top:20px;">בברכה,<br>{{from_name}}</p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>
```

Use `white-space:pre-wrap` on the manager response block to preserve line breaks from the form.

The full default layout lives in `lib/emailTemplate.ts` → `defaultHtmlTemplate()`.

---

## Drafts workflow

1. Edit HTML and preview until satisfied.
2. **Save as draft** — give a clear name (e.g. “Winter 2026 – justified”).
3. Switch between **Active template** and drafts via the chips bar.
4. When ready, open the draft and click **Publish** to set it as the active template for that kind (`justified` / `unjustified`).
5. **Save** updates either the active template or the currently selected draft, depending on which chip is active.

Publishing asks for confirmation because it affects all future closing emails of that type.

---

## Which template is sent when

| Manager decision | Template used |
|------------------|-----------------|
| Inquiry **justified** | **Justified** template |
| Inquiry **not justified** | **Unjustified** template |

Fixed intro paragraphs differ per template in the default design; you can change those in HTML as well as the placeholders.

Emails are sent when a closing email is triggered from the inquiry workflow (requires Gmail connected under **Connection & sending**).

---

## Do / don’t

| Do | Don’t |
|----|--------|
| Tables + inline `style` | `<script>`, iframes, embedded video |
| `{{placeholders}}` for dynamic data | Hard-code real parent names or inquiry IDs |
| `{{asset_*}}` in `<img src="...">` | Hotlink images from arbitrary URLs |
| Preview on desktop and mobile | Complex CSS (float, absolute positioning) |
| Save drafts before publishing | Edit active template without a backup draft |
| Send a **test email** from Connection settings | Assume preview matches every client 100% |

---

## Suggested workflow

1. **Reset** (if needed) to restore the built-in default template.
2. Upload **logo** and **signature** under Graphic assets.
3. Edit HTML; use **Add field** for placeholders.
4. Switch to **Preview**; check desktop and mobile toggles.
5. **Save as draft** with a descriptive name.
6. **Publish** when the draft is approved.
7. Under **Connection & sending**, send a **test email** to yourself before production use.

---

## Troubleshooting

| Issue | What to check |
|-------|----------------|
| Placeholder appears literally in the sent email | Typo in name; must match the table above exactly. |
| Image missing in sent email | Asset uploaded? Key matches `{{asset_<key>}}`? |
| Broken layout in Outlook | Prefer tables; simplify CSS; avoid margin on block elements where possible. |
| Manager text has no line breaks | Add `white-space:pre-wrap` on the wrapper element. |
| Email not sent at all | Gmail connected? OAuth credentials saved? See README Gmail section. |

---

## Related code

| File | Role |
|------|------|
| `lib/emailTemplate.ts` | Variables, defaults, `renderTemplate()`, sample preview inquiry |
| `lib/emailRender.ts` | Builds subject/HTML/text + inline images |
| `services/emailTemplates.ts` | Active template storage |
| `services/emailTemplateDrafts.ts` | Draft storage |
| `services/emailAssets.ts` | Image assets and `asset_*` context |
| `routes/settings.ts` | Preview and CRUD API |
