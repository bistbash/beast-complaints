import type { JustificationDecision } from './constants.ts';

/** Formal A4 closing letter — optimized for Puppeteer PDF (print backgrounds on). */
export function institutionalClosingLetterHtml(kind: JustificationDecision): string {
  const isJustified = kind === 'justified';

  const bodyMid = isJustified
    ? `<p class="p">
        לאחר בדיקה יסודית שנערכה על ידי הנהלת המכללה, לרבות עיון בפרטי הפנייה
        ובהתייחסות הגורמים הרלוונטיים, נמצא כי הפנייה <strong>מוצדקת</strong>.
        אנו מודים לך על שהפנית את תשומת ליבנו לנושא זה, ורואים בכך הזדמנות
        ללמידה, לשיפור ולהתייעלות בשירות לקהילת המכללה.
      </p>`
    : `<p class="p">
        לאחר בדיקה מעמיקה שנערכה על ידי הנהלת המכללה, לרבות עיון בפרטי הפנייה
        ובהתייחסות הגורמים הרלוונטיים, נמצא כי הפנייה <strong>לא מוצדקת</strong>.
        אנו מבינים שייתכן שהתוצאה אינה תואמת את ציפיותיך, ומכבדים את נקודת
        המבט שהבאת בפנייה.
      </p>`;

  const bodyClose = isJustified
    ? `<p class="p">
        הנהלת המכללה פועלת בשקיפות ובשיתוף פעולה מלא עם ההורים והתלמידים,
        ותמשיך לפעול לשמירה על תקשורת חיובית, מכבדת ופתוחה.
      </p>
      <p class="p">
        נשמח לעמוד לרשותך בכל שאלה נוספת, ומודים לך על המעורבות והאכפתיות
        כלפי חיי הקהילה הבית-ספרית.
      </p>`
    : `<p class="p">
        אנו מודים לך על שהפנית את תשומת ליבנו, ומאמינים כי שיח פתוח ומכבד
        בין ההורים, התלמידים והנהלה תורם לקהילה הבית-ספרית.
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
    --fs-title: 14pt;   /* כותרת ראשית — letterhead, כותרת המכתב */
    --fs-body: 12pt;    /* גוף, תת-כותרת, כותרות משנה, פרטי מכתב */
    --fs-small: 10pt;   /* פוטר, פרטי קשר, תוויות בטבלה */
    --lh: 1.55;
  }

  html, body {
    color: #000;
    direction: rtl;
    text-align: right;
    font-family: 'David', 'David Libre', 'Times New Roman', 'Liberation Serif', serif;
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
  .sheet-main { padding-bottom: 48mm; }
  .sheet-bottom {
    position: absolute;
    left: 20mm;
    right: 20mm;
    bottom: 10mm;
  }

  @media screen {
    body { background: #e3e6ea; padding: 24px 16px; }
    .sheet {
      box-shadow: 0 1px 4px rgba(0,0,0,0.16), 0 8px 28px rgba(0,0,0,0.1);
    }
  }

  /* הדפסה / PDF — מיקום סופי נקבע ב-htmlToPdf; כאן רק זרימה רב-עמודית */
  @media print {
    body { background: #fff; padding: 0; }

    .sheet {
      width: auto;
      margin: 0;
      box-shadow: none;
    }

    /* לא לפצל כותרת עליונה / כותרת מכתב בין עמודים */
    .opening,
    .opening-frame,
    .doc-head {
      break-inside: avoid;
      page-break-inside: avoid;
    }

    /* כותרת "התייחסות הנהלה" נשארת עם תחילת הטקסט */
    .response-heading {
      break-after: avoid;
      page-break-after: avoid;
    }

    /* התייחסות ארוכה — ממשיכה לעמוד הבא */
    .response-section,
    .response-text,
    .p {
      break-inside: auto;
      page-break-inside: auto;
      orphans: 3;
      widows: 3;
    }

    /* סיום, חתימה ופוטר — בלוק אחד בתחתית העמוד */
    .sheet-bottom,
    .closing-block {
      break-inside: avoid;
      page-break-inside: avoid;
    }

    .signature {
      break-inside: avoid;
      page-break-inside: avoid;
    }

    .footer-rule { margin-top: 16pt; }
  }

  /* ── פתיחה: letterhead רשמי ── */
  .opening { margin-bottom: 22pt; }

  .opening-frame {
    border: 1pt solid #000;
    padding: 0;
  }
  .opening-frame-top {
    border-bottom: 1pt solid #000;
    padding: 14pt 16pt 12pt;
  }
  .letterhead-table {
    width: 100%;
    border-collapse: collapse;
    table-layout: fixed;
  }
  .letterhead-table td { vertical-align: middle; }
  .lh-logo {
    width: 88px;
    text-align: center;
    padding-left: 4pt;
  }
  .lh-logo img {
    width: 76px;
    height: auto;
    display: block;
    margin: 0 auto;
  }
  .lh-center { text-align: center; padding: 0 8pt; }
  .lh-org {
    font-size: var(--fs-title);
    font-weight: 700;
    line-height: var(--lh);
    letter-spacing: 0.01em;
  }
  .lh-contact {
    font-size: var(--fs-small);
    margin-top: 6pt;
    color: #333;
    line-height: var(--lh);
  }
  .lh-spacer { width: 88px; }

  /* פרטי מכתב */
  .ref-table {
    width: 100%;
    border-collapse: collapse;
    font-size: var(--fs-body);
  }
  .ref-table th,
  .ref-table td {
    border: 1pt solid #000;
    padding: 7pt 10pt;
    vertical-align: top;
    text-align: right;
  }
  .ref-table th {
    width: 22%;
    font-size: var(--fs-small);
    font-weight: 700;
    background: #f5f5f5;
    letter-spacing: 0.04em;
  }
  .ref-table .ref-val { font-weight: 600; }

  /* כותרת המכתב */
  .doc-head {
    text-align: center;
    margin: 24pt 0 22pt;
  }
  .doc-head-rule {
    display: table;
    width: 72%;
    margin: 0 auto 10pt;
    table-layout: fixed;
  }
  .doc-head-rule td { vertical-align: middle; }
  .doc-head-line {
    border: none;
    border-top: 0.75pt solid #000;
    height: 1px;
  }
  .doc-title {
    font-size: var(--fs-title);
    font-weight: 700;
    padding: 0 12pt;
    white-space: nowrap;
    letter-spacing: 0.03em;
    line-height: var(--lh);
  }
  .doc-subtitle {
    font-size: var(--fs-body);
    color: #222;
    margin-top: 4pt;
    line-height: var(--lh);
  }

  /* פתיחת גוף */
  .body-open { margin-top: 4pt; }
  .addressee {
    margin-bottom: 14pt;
    padding-right: 2pt;
  }
  .addressee-lbl { font-weight: 400; }
  .addressee-name { font-weight: 700; }
  .salute { margin-bottom: 14pt !important; font-weight: 600; }
  .p { margin-bottom: 12pt; text-align: justify; }

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

  /* חתימה — חתימה ידנית (נכס signature) + שם ותפקיד מתחת */
  .signature {
    margin-top: 12pt;
    text-align: right;
  }
  .signature .sign-off {
    margin: 0 0 14pt !important;
    font-weight: 700;
  }
  .sig-block {
    display: inline-block;
    text-align: right;
    min-width: 160px;
    max-width: 220px;
  }
  .sig-hand {
    display: block;
    width: 120px;
    max-height: 44pt;
    height: auto;
    margin: 0 0 0 0;
    object-fit: contain;
    object-position: right bottom;
  }
  .sig-name {
    font-weight: 700;
    margin-top: 2pt;
    padding-top: 2pt;
    border-top: 0.5pt solid #ccc;
  }
  .sig-role {
    font-size: var(--fs-small);
    margin-top: 2pt;
    line-height: var(--lh);
  }

  /* תחתית — קו מפריד ופרטי קשר */
  .footer-rule { border: none; border-top: 1pt solid #000; margin: 20pt 0 8pt; }
  .footer {
    text-align: center;
    font-size: var(--fs-small);
    line-height: var(--lh);
    color: #222;
  }
  .footer a { color: #222; text-decoration: none; }
  .footer .sep { margin: 0 6pt; }
</style>
</head>
<body>
  <div class="sheet">
    <div class="sheet-main">

    <header class="opening">
      <div class="opening-frame">
        <div class="opening-frame-top">
          <table class="letterhead-table" role="presentation">
            <tr>
              <td class="lh-logo">
                <img src="{{asset_logo}}" alt="לוגו המכללה" />
              </td>
              <td class="lh-center">
                <div class="lh-org">המכללה הטכנולוגית של חיל האוויר באר שבע</div>
                <div class="lh-contact">
                  דרך אילן רמון 1 &nbsp;|&nbsp; טלפון 08-9907410/2 &nbsp;|&nbsp; פקס 08-9907411/02
                </div>
              </td>
              <td class="lh-spacer" aria-hidden="true"></td>
            </tr>
          </table>
        </div>
        <table class="ref-table">
          <tr>
            <th scope="row">תאריך</th>
            <td class="ref-val">{{closed_at}}</td>
            <th scope="row">הנדון</th>
            <td class="ref-val">{{subject}}</td>
          </tr>
        </table>
      </div>
    </header>

    <div class="doc-head">
      <table class="doc-head-rule" role="presentation">
        <tr>
          <td class="doc-head-line"></td>
          <td class="doc-title">תגובה לפנייתך</td>
          <td class="doc-head-line"></td>
        </tr>
      </table>
      <div class="doc-subtitle">בנושא: {{subject}}</div>
    </div>

    <div class="body-open">
      <p class="addressee"><span class="addressee-lbl">לכבוד </span><span class="addressee-name">{{submitter_name}}</span>,</p>
      <p class="p salute">שלום רב,</p>
    </div>

    <p class="p">
      תודה על פנייתך מיום {{form_timestamp}} בנושא
      &#x201C;{{subject}}&#x201D;. אנו מעריכים את הזמן והמאמץ שהקדשת לשיתוף אותנו,
      ורואים בפניות ההורים והתלמידים חלק חשוב בשיפור השירות וההתנהלות במוסדנו.
    </p>

    ${bodyMid}

    <div class="response-section">
      <div class="response-heading">התייחסות הנהלה</div>
      <div class="response-text">{{manager_response}}</div>
    </div>

    </div><!-- /.sheet-main -->

    <div class="sheet-bottom">
      <div class="closing-block">
        ${bodyClose}

        <div class="signature">
          <p class="sign-off">בכבוד רב,</p>
          <div class="sig-block">
            <img class="sig-hand" src="{{asset_signature}}" alt="" />
            <div class="sig-name">קובי דודסון</div>
            <div class="sig-role">מנהל ביה&#x201C;ס</div>
          </div>
        </div>
      </div>

      <hr class="footer-rule" />
      <div class="footer">
        <div>דרך אילן רמון 1, באר שבע<span class="sep">|</span>טלפון: 08-9907410/2<span class="sep">|</span>פקס: 08-9907411/02</div>
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
