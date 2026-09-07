/**
 * Tab 13 — the ElevenLabs hybrid, drawn against tab 12 on purpose.
 *
 * The diagram had twelve tabs and not one mention of a webhook: every hybrid picture in it
 * was the OpenAI one. Which left the project's most interesting comparison undrawn, because
 * the two hybrids reach the same place — eight tools, the server holding the credentials —
 * by opposite mechanisms, and the difference is not visible in a list of features.
 *
 * SAME ACTORS, SAME POSITIONS, SAME QUESTION AS TAB 12
 *
 * Deliberate. Put the two tabs side by side and everything that matters is the difference:
 * there, your server dials out and joins a session; here, their cloud dials in to an address
 * you had to publish first. Everything else on this page follows from that one reversal —
 * the tunnel, the second process, the four layers, and the one thing this path cannot prove.
 *
 *   node scripts/gen-elevenlabs-hybrid.mjs
 */
import { readFileSync, writeFileSync } from 'node:fs'

const FILE = new URL('../docs/architecture.drawio', import.meta.url).pathname.replace(/^\//, '')

let id = 0
const cells = []
const esc = (s) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

const box = (value, style, x, y, w, h) => {
  const i = `e${++id}`
  cells.push(
    `        <mxCell id="${i}" value="${esc(value)}" style="${style}" vertex="1" parent="1"><mxGeometry x="${x}" y="${y}" width="${w}" height="${h}" as="geometry"/></mxCell>`,
  )
  return i
}

const arrow = (x1, y1, x2, y2, label, colour, dashed = false) => {
  const i = `e${++id}`
  cells.push(
    `        <mxCell id="${i}" value="${esc(label)}" style="endArrow=block;endFill=1;html=1;strokeWidth=3;fontSize=15;fontStyle=1;labelBackgroundColor=#ffffff;strokeColor=${colour};fontColor=${colour};${dashed ? 'dashed=1;dashPattern=8 8;' : ''}" edge="1" parent="1"><mxGeometry relative="1" as="geometry"><mxPoint x="${x1}" y="${y1}" as="sourcePoint"/><mxPoint x="${x2}" y="${y2}" as="targetPoint"/></mxGeometry></mxCell>`,
  )
  return i
}

const lifeline = (x, yTop, yBottom, colour) => {
  const i = `e${++id}`
  cells.push(
    `        <mxCell id="${i}" style="endArrow=none;dashed=1;dashPattern=4 4;strokeWidth=2;strokeColor=${colour};html=1;" edge="1" parent="1"><mxGeometry relative="1" as="geometry"><mxPoint x="${x}" y="${yTop}" as="sourcePoint"/><mxPoint x="${x}" y="${yBottom}" as="targetPoint"/></mxGeometry></mxCell>`,
  )
  return i
}

const T = 'text;html=1;align=left;verticalAlign=middle;'
const rtl = (h) => `<div dir='rtl' style='text-align:right'>${h}</div>`
const ctr = (h) => `<div dir='rtl' style='text-align:center'>${h}</div>`
const HEAD = (fill, stroke) =>
  `rounded=1;whiteSpace=wrap;html=1;fontSize=17;fontStyle=1;align=center;verticalAlign=middle;arcSize=10;fillColor=${fill};strokeColor=${stroke};`
const NOTE = (fill, stroke) =>
  `rounded=1;whiteSpace=wrap;html=1;fontSize=13;align=right;verticalAlign=middle;spacingRight=12;spacingLeft=12;arcSize=8;fillColor=${fill};strokeColor=${stroke};`
const PANEL = (fill, stroke, size = 13) =>
  `rounded=1;whiteSpace=wrap;html=1;fillColor=${fill};strokeColor=${stroke};fontSize=${size};align=right;verticalAlign=top;spacingRight=14;spacingLeft=14;spacingTop=10;arcSize=6;`

const BLUE = '#6c8ebf'
const GREEN = '#82b366'
const PURPLE = '#9673a6'
const ORANGE = '#d79b00'
const RED = '#b85450'

// The same five columns as tab 12, so the two pages overlay in the reader's head.
const YOU = 260
const BR = 620
const EL = 1010
const SV = 1400
const OM = 1740

box(
  'ההיברידי של ElevenLabs — אותה שאלה, החץ ההפוך',
  `${T}fontSize=28;fontStyle=1;`,
  60,
  26,
  1500,
  40,
)
box(
  rtl(
    'טאב 12 מראה את אותה שאלה בדיוק אצל OpenAI. שים את שני הדפים זה לצד זה — כל מה שחשוב הוא ההבדל בצעד 4.',
  ),
  `${T}fontSize=14;fontColor=#6b6b6b;`,
  60,
  70,
  1500,
  24,
)

/* ── the one idea, before any steps ─────────────────────────────── */

box(
  rtl(
    '<b>מי פותח את החיבור — וזה כל ההבדל</b><br><br>' +
      '<b>OpenAI (טאב 12):</b> &nbsp;השרת שלך &nbsp;<b>◄──</b>&nbsp; מחייג החוצה אל הסשן החי. חיבור שאתה יזמת. ' +
      'שום דבר במחשב שלך אינו נגיש מבחוץ, ואין נקודת כניסה שצריך להגן עליה.<br>' +
      '<b>ElevenLabs (הדף הזה):</b> &nbsp;אין sideband. השיחה יושבת אצלם. אם השרת שלך אמור לענות על כלי — ' +
      '<b>הם</b> חייבים להתקשר <b>אליך</b>: HTTP POST לכתובת שפרסמת מראש. זה ה-webhook.',
  ),
  PANEL('#f3eefa', PURPLE, 15),
  60,
  110,
  1810,
  108,
)

/* actors */
box(
  ctr('אתה<br><span style="font-size:11px;font-weight:normal">מיקרופון ורמקול</span>'),
  HEAD('#e8e8e8', '#9a9a9a'),
  YOU - 105,
  240,
  210,
  66,
)
box(ctr('הדפדפן'), HEAD('#dae8fc', BLUE), BR - 105, 240, 210, 66)
box(
  ctr('ElevenLabs<br><span style="font-size:11px;font-weight:normal">cascade: תמלול → LLM → קול</span>'),
  HEAD('#e1d5e7', PURPLE),
  EL - 125,
  240,
  250,
  66,
)
box(
  ctr('השרת שלך<br><span style="font-size:11px;font-weight:normal">פורט 3002, דרך מנהרה</span>'),
  HEAD('#d5e8d4', GREEN),
  SV - 115,
  240,
  230,
  66,
)
box(ctr('Open-Meteo'), HEAD('#ffe6cc', ORANGE), OM - 95, 240, 190, 66)

for (const [x, c] of [
  [YOU, '#9a9a9a'],
  [BR, BLUE],
  [EL, PURPLE],
  [SV, GREEN],
  [OM, ORANGE],
]) {
  lifeline(x, 310, 960, c)
}

/* ── the steps ──────────────────────────────────────────────────── */

arrow(YOU, 355, BR, 355, '1 · "מה מזג האוויר בבוסטון?"', '#4a4a4a')
arrow(BR, 405, EL, 405, '2 · האודיו, ב-WebSocket', BLUE)

box(
  rtl(
    '<b>3 · שלושה שלבים אצלם, בזה אחר זה:</b> התמלול הופך אודיו לטקסט → ה-LLM קורא את הטקסט → ומחליט שהוא צריך get_airport_weather · BOS.<br>' +
      '<b>הדפדפן לא שומע כלום מזה.</b> אצל OpenAI ההכרזה נשמעת בשני החיבורים; כאן היא נשארת אצלם.',
  ),
  NOTE('#f3eefa', PURPLE),
  EL - 350,
  440,
  700,
  62,
)

/* THE step */
arrow(
  EL,
  545,
  SV,
  545,
  '4 · POST https://…trycloudflare.com/api/tool/hook/get_airport_weather',
  PURPLE,
)
box(
  rtl('<b>החץ ההפוך.</b> חיבור HTTPS חדש, שהם פותחים, אל כתובת שפרסמת.'),
  NOTE('#f3eefa', PURPLE) + 'fontSize=12;',
  EL + 20,
  565,
  360,
  40,
)

arrow(SV, 645, OM, 645, '5 · lat/lon של בוסטון', ORANGE)
arrow(OM, 695, SV, 695, '6 · 15.5°C, מעונן חלקית', ORANGE)
arrow(SV, 745, EL, 745, '7 · JSON — כתשובת ה-HTTP לאותה בקשה', GREEN)

box(
  rtl(
    '<b>ה-LLM מנסח משפט מהמספרים, ואז הקול מיוצר.</b> בקסקייד שום דבר לא נאמר עד שהניסוח נגמר — לכן זמן התגובה כאן נמדד בשניות ולא במאיות.',
  ),
  NOTE('#f3eefa', PURPLE),
  EL - 300,
  785,
  600,
  46,
)

arrow(EL, 875, BR, 875, '8 · הקול חוזר', BLUE)
arrow(BR, 925, YOU, 925, '"בבוסטון לוגן 15.5 מעלות, מעונן חלקית"', '#4a4a4a')

/* ── why a tunnel, and why not 3001 ─────────────────────────────── */

box(
  rtl(
    '<b>למה צריך מנהרה בכלל — ולמה דווקא לפורט 3002</b><br><br>' +
      'הענן שלהם יושב באינטרנט. הוא לא יכול להגיע ל-localhost שלך, אז חייבת להיות כתובת ציבורית. <b>cloudflared</b> יוצר אחת.<br><br>' +
      '<b>אבל לא מול השרת הראשי.</b> פורט 3001 מנפיק מפתח זמני של OpenAI, כתובת חתומה של ElevenLabs ומפתח Soniox — ' +
      '<b>בלי אימות</b>, כי כל מה שמגיע אליו בא מהדפדפן במכונה הזו. מנהרה מולו פירושה שמי שמוצא את הכתובת מוציא לך כסף, ' +
      'ויכול גם להעלות מסמכים למאגר בדרך.<br><br>' +
      '<b>לכן תהליך שני משלו</b>, שמרכיב <b>מסלול אחד בדיוק</b>. מה שפומבי: שתי שליפות לקריאה בלבד. ' +
      'שום דבר אחר לא מאזין — לכן <span style="font-family:monospace">curl</span> על הבסיס מחזיר 404.',
  ),
  PANEL('#e8f0e4', GREEN),
  60,
  1000,
  900,
  230,
)

box(
  rtl(
    '<b>ארבע שכבות על המסלול הזה — והסדר מכוון</b><br><br>' +
      '<b>1 · רשימת כתובות</b> — 12 כתובות egress של ElevenLabs, נקראות מ-<span style="font-family:monospace">cf-connecting-ip</span>. ' +
      'זיוף שלה נחסם על ידי Cloudflare לפני שהגיע לתהליך.<br>' +
      '<b>2 · מגבלת קצב</b> — 60 לדקה לכתובת.<br>' +
      '<b>3 · סוד משותף</b> — השוואה בזמן קבוע.<br>' +
      '<b>4 · מיקום</b> — 403 לכל כלי שאינו <span style="font-family:monospace">placement: server</span>.<br><br>' +
      '<b>כתובת לפני סוד</b>, כדי שמי שלא יכול להיות הם לא יקבל הזדמנות לנחש.',
  ),
  PANEL('#fff2cc', '#d6b656'),
  990,
  1000,
  880,
  230,
)

/* ── the 6/2 split, which is the whole "ceiling" ─────────────────── */

box(
  rtl(
    '<b>ומכאן "תקרה של 6 כלים בלי מנהרה" — שאיננה מגבלה של הפלטפורמה</b><br><br>' +
      'יש 8 כלים. &nbsp;<b>6</b> מהם <span style="font-family:monospace">placement: anywhere</span> ורצים כ-<b>client tools</b>: ' +
      'ElevenLabs מבקשים מהדפדפן, הדפדפן עושה POST ל-3001 המקומי. הדפדפן הוא זה שמחייג — אז אין צורך בכתובת ציבורית.<br>' +
      '<b>2</b> מהם <span style="font-family:monospace">placement: server</span>, ולכן <span style="font-family:monospace">/api/tool</span> מחזיר להם <b>403</b> לדפדפן בכוונה. ' +
      'הם <b>לא יכולים</b> להיות client tools, ונשאר להם מנגנון אחד: webhook. שדורש כתובת. <b>8 − 2 = 6.</b><br><br>' +
      'לכן יש שני סוכנים אצלם, זהים חוץ מזה: &nbsp;<span style="font-family:monospace">6 client · 0 webhook · 6/8</span> &nbsp;מול&nbsp; ' +
      '<span style="font-family:monospace">6 client · 2 webhook · 8/8</span>.<br>' +
      'אילו היו לך 20 כלים ושניים בשרת, זה היה 18/20. <b>התקרה איננה 6 — היא כל כלי שאתה מסרב לתת לדפדפן להריץ.</b>',
  ),
  PANEL('#eef4fc', BLUE),
  60,
  1260,
  1810,
  150,
)

/* ── what this path pays that the other does not ─────────────────── */

box(
  rtl(
    '<b>מה זה עולה — שני דברים שההיברידי של OpenAI לא משלם</b><br><br>' +
      '<b>נקודת קצה ציבורית.</b> הקל לבנייה הוא החשוף יותר: ה-webhook פשוט לכתוב, אבל הוא מחייב לפרסם כתובת לאינטרנט — ומכאן ארבע השכבות. ' +
      'ה-sideband של OpenAI הוא יותר קוד ומפרסם <b>כלום</b>.<br><br>' +
      '<b>ושיוך שהוא הסקה, לא ודאות.</b> הקריאה מגיעה בלי מזהה שיחה אמין — ' +
      '<span style="font-family:monospace">{{system__conversation_id}}</span> מתועד אצלם אבל <b>מגיע מילולית ולא מוחלף</b> (נמדד). ' +
      'אצל OpenAI זה אותו סשן וההתאמה ודאית. כאן, עם שני מתקשרים במקביל, קריאה יכולה להשתייך לשיחה הלא נכונה.<br>' +
      'אם ההבטחה שלך היא שכל מספר ניתן למעקב עד לקריאה שייצרה אותו — <b>זה מימד בחירה, לא פרט טכני.</b>',
  ),
  PANEL('#fdf1f0', RED),
  60,
  1440,
  1810,
  150,
)

const tab = `  <diagram id="elevenlabs-hybrid" name="13 - ElevenLabs hybrid: the opposite arrow">
    <mxGraphModel dx="1422" dy="820" grid="1" gridSize="10" guides="1" tooltips="1" connect="1" arrows="1" fold="1" page="1" pageScale="1" pageWidth="1960" pageHeight="1650" math="0" shadow="0">
      <root>
        <mxCell id="0"/>
        <mxCell id="1" parent="0"/>
${cells.join('\n')}
      </root>
    </mxGraphModel>
  </diagram>
`

let xml = readFileSync(FILE, 'utf8')
// Re-running replaces this tab rather than stacking copies of it.
xml = xml.replace(/ {2}<diagram id="elevenlabs-hybrid"[\s\S]*?<\/diagram>\n/g, '')
writeFileSync(FILE, xml.replace('</mxfile>', tab + '</mxfile>'))
console.log('written: 13 - ElevenLabs hybrid: the opposite arrow')
