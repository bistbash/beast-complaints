import type { JustificationDecision } from './constants.ts';

/**
 * Formal IDF-style closing letter (חיל האוויר / בח"א 21 letterhead) — optimized
 * for Puppeteer PDF (print backgrounds on). Layout mirrors the official
 * "מסמך אזרחי" format: "בלמ"ס" classification top & bottom, a unit-identification
 * block beside the emblem, a centered underlined "הנדון:" subject line, then body.
 *
 * Structure note: keep the .sheet / .sheet-main / .sheet-bottom classes — the
 * PDF footer-pinning in letterLayoutFix.ts depends on them.
 */
export function institutionalClosingLetterHtml(kind: JustificationDecision): string {
  const isJustified = kind === 'justified';

  const bodyMid = isJustified
    ? `<p class="p">
        לאחר בדיקה יסודית שנערכה על ידי הנהלת בית הספר, לרבות עיון בפרטי הפנייה
        ובהתייחסות הגורמים הרלוונטיים, נמצא כי הפנייה <strong>מוצדקת</strong>.
        אנו מודים לך על שהפנית את תשומת ליבנו לנושא, ורואים בכך הזדמנות
        ללמידה, לשיפור ולייעול השירות לתלמידים ולהוריהם.
      </p>`
    : `<p class="p">
        לאחר בדיקה מעמיקה שנערכה על ידי הנהלת בית הספר, לרבות עיון בפרטי הפנייה
        ובהתייחסות הגורמים הרלוונטיים, נמצא כי הפנייה <strong>אינה מוצדקת</strong>.
        אנו מבינים כי ייתכן שהתוצאה אינה תואמת את ציפיותיך, ומכבדים את נקודת
        המבט שהצגת בפנייתך.
      </p>`;

  const bodyClose = isJustified
    ? `<p class="p">
        הנהלת בית הספר פועלת בשקיפות ובשיתוף פעולה מלא עם ההורים והתלמידים,
        ותמשיך לטפח תקשורת חיובית, מכבדת ופתוחה.
      </p>
      <p class="p">
        נשמח לעמוד לרשותך בכל שאלה נוספת, ומודים לך על מעורבותך ואכפתיותך
        בנעשה בבית הספר.
      </p>`
    : `<p class="p">
        אנו מודים לך על שהפנית את תשומת ליבנו, ומאמינים כי שיח פתוח ומכבד
        בין ההורים, התלמידים וההנהלה מחזק את הקשר עם בית הספר.
      </p>
      <p class="p">
        אם ברצונך להבהיר או להוסיף פרטים, נשמח לעמוד לרשותך בכל עת.
      </p>`;

  return `<!DOCTYPE html>
<html lang="he" dir="rtl">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>מכתב סגירת פנייה</title>
<style>
  /* שוליים בתוך .sheet — לא ב-@page (Puppeteer PDF דורש margin:0) */
  @page { size: A4 portrait; margin: 0; }
  * { box-sizing: border-box; margin: 0; padding: 0; }

  /* סולם טיפוגרפי אחיד למכתב רשמי */
  :root {
    --fs-title: 13pt;
    --fs-body: 11pt;
    --fs-small: 9.5pt;
    --fs-tiny: 8.5pt;
    --lh: 1.45;
  }

  html, body {
    color: #000;
    direction: rtl;
    text-align: right;
    font-family: Arial, 'Liberation Sans', Arimo, 'Noto Sans Hebrew', Helvetica, sans-serif;
    font-size: var(--fs-body);
    line-height: var(--lh);
    -webkit-print-color-adjust: exact;
    print-color-adjust: exact;
  }
  html, body { margin: 0; padding: 0; background: #fff; }

  /* דף A4 — גובה מלא; חתימה+פוטר ננעצים בתחתית (מסך: CSS, PDF: htmlToPdf) */
  .sheet {
    width: 210mm;
    min-height: 297mm;
    margin: 0 auto;
    padding: 18mm 20mm 10mm;
    background: #fff;
    position: relative;
    box-sizing: border-box;
  }
  /* Footer flows naturally for multi-page letters; for single-page letters the
     JS (pushLetterFooterToPageBottom) pins it to the physical page bottom. */
  .sheet-main { padding-bottom: 0; }
  .sheet-bottom {
    position: static;
    margin-top: 18pt;
    left: 20mm;
    right: 20mm;
    bottom: 10mm;
  }

  @media screen {
    body { background: #e3e6ea; padding: 24px 16px; }
    .sheet { box-shadow: 0 1px 4px rgba(0,0,0,0.16), 0 8px 28px rgba(0,0,0,0.1); }
  }

  @media print {
    body { background: #fff; padding: 0; }
    .sheet { width: auto; margin: 0; box-shadow: none; }

    .classif-top,
    .letterhead,
    .subject-line { break-inside: avoid; page-break-inside: avoid; }
    .response-heading { break-after: avoid; page-break-after: avoid; }
    .response-section,
    .response-text,
    .p { break-inside: auto; page-break-inside: auto; orphans: 3; widows: 3; }
    .sheet-bottom,
    .signature { break-inside: avoid; page-break-inside: avoid; }
  }

  /* ── סיווג "בלמ"ס" ── */
  .classif-top {
    text-align: center;
    font-size: var(--fs-small);
    font-weight: 700;
    letter-spacing: 0.06em;
    margin-bottom: 10pt;
  }

  /* ── letterhead: בלוק זיהוי יחידה (שמאל) + סמל (ימין) ── */
  .letterhead {
    width: 100%;
    border-collapse: collapse;
    table-layout: fixed;
    margin-bottom: 20pt;
  }
  .letterhead td { vertical-align: top; }

  /* לוגו משולב (חיל האוויר + ביה"ס) — בד"כ רחב; מתאים ליחס שלו עם max-width/height */
  .lh-emblem { width: 42%; text-align: right; padding-top: 2pt; vertical-align: top; }
  .lh-emblem img {
    width: auto;
    height: auto;
    max-width: 100%;
    max-height: 92px;
    display: inline-block;
  }

  .lh-unit { width: 58%; text-align: left; vertical-align: top; }
  .unit-table { display: inline-block; text-align: right; border-collapse: collapse; font-size: var(--fs-body); }
  .unit-table td {
    padding: 1.5pt 0;
    vertical-align: top;
    line-height: 1.4;
  }
  .unit-table .u-label {
    font-weight: 700;
    white-space: nowrap;
    padding-left: 14pt;
  }
  .unit-table .u-val { font-weight: 400; }

  /* ── כותרת "הנדון:" ── */
  .subject-line {
    text-align: center;
    font-size: var(--fs-body);
    font-weight: 700;
    margin: 16pt 0 22pt;
  }
  .subject-line .subj-text {
    text-decoration: underline;
    text-underline-offset: 3px;
  }

  /* ── גוף ── */
  .body-open { margin-top: 4pt; }
  .addressee { margin-bottom: 12pt; padding-right: 2pt; }
  .addressee-lbl { font-weight: 400; }
  .addressee-name { font-weight: 700; }
  .salute { margin-bottom: 12pt !important; font-weight: 600; }
  .p { margin-bottom: 10pt; text-align: justify; }

  /* התייחסות הנהלה */
  .response-section { margin: 4pt 0 20pt; }
  .response-heading {
    font-size: var(--fs-body);
    font-weight: 700;
    margin-bottom: 8pt;
    text-decoration: underline;
    text-underline-offset: 3px;
    line-height: var(--lh);
  }
  .response-text {
    white-space: pre-wrap;
    padding-right: 12pt;
    border-right: 1pt solid #666;
    line-height: var(--lh);
    text-align: justify;
  }

  .closing-block { margin-top: 0; }
  .closing-block .p:last-of-type { margin-bottom: 0; }

  /* חתימה */
  .signature { margin-top: 12pt; text-align: right; }
  .signature .sign-off { margin: 0 0 12pt !important; font-weight: 700; }
  .sig-block { display: inline-block; text-align: right; min-width: 160px; max-width: 220px; }
  .sig-hand {
    display: block;
    width: 156px;
    max-height: 58pt;
    height: auto;
    object-fit: contain;
    object-position: right bottom;
  }
  .sig-name { font-weight: 700; margin-top: 2pt; padding-top: 2pt; border-top: 0.5pt solid #ccc; }
  .sig-role { font-size: var(--fs-small); margin-top: 2pt; line-height: var(--lh); }

  /* תחתית — קו מפריד ופרטי קשר */
  .footer-rule { border: none; border-top: 1pt solid #000; margin: 16pt 0 6pt; }
  .footer {
    text-align: center;
    font-size: var(--fs-tiny);
    line-height: var(--lh);
    color: #222;
  }
  .footer a { color: #222; text-decoration: none; }
  .footer .sep { margin: 0 6pt; }
  .footer-org { font-weight: 700; font-size: var(--fs-small); margin-bottom: 2pt; }
</style>
</head>
<body>
  <div class="sheet">
    <div class="sheet-main">

      <div class="classif-top">בלמ"ס</div>

      <table class="letterhead" role="presentation">
        <tr>
          <td class="lh-emblem">
            <img src="{{asset_logo}}" alt="סמל המכללה הטכנולוגית של חיל האוויר" />
          </td>
          <td class="lh-unit">
            <table class="unit-table" role="presentation">
              <tr><td class="u-label">חיל</td><td class="u-val">האוויר</td></tr>
              <tr><td class="u-label">בח"א</td><td class="u-val">21</td></tr>
              <tr><td class="u-label">טייסת</td><td class="u-val">ביס"ט ב"ש</td></tr>
              <tr><td class="u-label">גף</td><td class="u-val">מנהלה</td></tr>
              <tr><td class="u-label">סימוכין</td><td class="u-val">{{closed_at}}</td></tr>
            </table>
          </td>
        </tr>
      </table>

      <div class="subject-line">הנדון: <span class="subj-text">מענה לפנייתך בנושא &#x201C;{{subject}}&#x201D;</span></div>

      <div class="body-open">
        <p class="addressee"><span class="addressee-lbl">לכבוד </span><span class="addressee-name">{{submitter_name}}</span>,</p>
        <p class="p salute">שלום רב,</p>
      </div>

      <p class="p">
        תודה על פנייתך מיום {{form_timestamp}} בנושא
        &#x201C;{{subject}}&#x201D;. אנו מעריכים את הזמן והמאמץ שהשקעת בפנייתך אלינו,
        ורואים בפניות ההורים והתלמידים נדבך חשוב בשיפור השירות וההתנהלות בבית הספר.
      </p>

      ${bodyMid}

      <div class="response-section">
        <div class="response-heading">התייחסות הנהלה</div>
        <div class="response-text">{{manager_response}}</div>
      </div>

      <div class="closing-block">
        ${bodyClose}

        <div class="signature">
          <p class="sign-off">בכבוד רב,</p>
          <div class="sig-block">
            <img class="sig-hand" src="{{asset_signature_2}}" alt="חתימת מנהל ביה&#x201C;ס" />
            <div class="sig-name">קובי דוידסון אל&#x201C;מ/מ&#x27;</div>
            <div class="sig-role">מנהל ביה&#x201C;ס</div>
          </div>
        </div>
      </div><!-- /.closing-block -->

    </div><!-- /.sheet-main -->

    <div class="sheet-bottom">
      <hr class="footer-rule" />
      <div class="footer">
        <div class="footer-org">המכללה הטכנולוגית של חיל האוויר באר שבע</div>
        <div>דרך אילן רמון 1, באר שבע<span class="sep">|</span>טלפון: 08-9907410/2</div>
        <div>
          <a href="http://techni-bs.iscool.co.il">techni-bs.iscool.co.il</a>
          <span class="sep">|</span>
          <a href="mailto:technibeersheva@gmail.com">technibeersheva@gmail.com</a>
        </div>
      </div>
    </div>

  </div><!-- /.sheet -->
</body>
</html>`;
}
