/**
 * Tab 12 — the hybrid in one picture.
 *
 * Tabs 10 and 11 are the reference: every enforcement point, every measurement, every
 * caveat. This one is the idea, and nothing else. If it takes more than a glance it has
 * failed, so the rule while editing it is that a sentence has to earn its place by being
 * the thing somebody would otherwise get wrong.
 */
import { readFileSync, writeFileSync } from 'node:fs'

const FILE = new URL('../docs/architecture.drawio', import.meta.url).pathname.replace(/^\//, '')

let id = 0
const cells = []
const esc = (s) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

const box = (value, style, x, y, w, h) => {
  const i = `s${++id}`
  cells.push(
    `        <mxCell id="${i}" value="${esc(value)}" style="${style}" vertex="1" parent="1"><mxGeometry x="${x}" y="${y}" width="${w}" height="${h}" as="geometry"/></mxCell>`,
  )
  return i
}

const arrow = (x1, y1, x2, y2, label, style = '') => {
  const i = `s${++id}`
  cells.push(
    `        <mxCell id="${i}" value="${esc(label)}" style="endArrow=block;endFill=1;html=1;strokeWidth=3;fontSize=14;fontStyle=1;labelBackgroundColor=#ffffff;${style}" edge="1" parent="1"><mxGeometry relative="1" as="geometry"><mxPoint x="${x1}" y="${y1}" as="sourcePoint"/><mxPoint x="${x2}" y="${y2}" as="targetPoint"/></mxGeometry></mxCell>`,
  )
  return i
}

const T = 'text;html=1;align=left;verticalAlign=middle;'
const rtl = (html) => `<div dir='rtl' style='text-align:right'>${html}</div>`

const BIG =
  'rounded=1;whiteSpace=wrap;html=1;fontSize=20;fontStyle=1;align=center;verticalAlign=middle;arcSize=8;'
const NOTE =
  'rounded=1;whiteSpace=wrap;html=1;fontSize=13;align=right;verticalAlign=top;spacingTop=10;spacingRight=12;arcSize=8;'

box('המודל ההיברידי', `${T}fontSize=30;fontStyle=1;`, 60, 30, 1000, 44)
box(
  rtl('סשן אחד אצל OpenAI. שתי דלתות אליו. האודיו נכנס מהדפדפן, הכלי הרגיש מהשרת שלך.'),
  `${T}fontSize=15;fontColor=#6b6b6b;`,
  60,
  78,
  1200,
  26,
)

/* the three actors */
box(rtl('הדפדפן'), `${BIG}fillColor=#dae8fc;strokeColor=#6c8ebf;`, 60, 190, 260, 90)
box('OpenAI\ngpt-realtime', `${BIG}fillColor=#f8cecc;strokeColor=#b85450;`, 690, 170, 280, 130)
box(rtl('השרת שלך'), `${BIG}fillColor=#d5e8d4;strokeColor=#82b366;`, 1340, 190, 260, 90)

/* the two doors */
arrow(320, 218, 690, 218, 'audio', 'strokeColor=#6c8ebf;')
arrow(690, 252, 320, 252, 'audio', 'strokeColor=#6c8ebf;')
arrow(1340, 235, 970, 235, 'control', 'strokeColor=#82b366;')

box(
  rtl('<b>WebRTC</b><br>מיקרופון ורמקול, ישירות'),
  `${T}fontSize=13;fontColor=#6c8ebf;align=center;`,
  380,
  120,
  250,
  44,
)
box(
  rtl('<b>WebSocket</b><br>אותו סשן, ?call_id'),
  `${T}fontSize=13;fontColor=#82b366;align=center;`,
  1030,
  120,
  250,
  44,
)

/* what each door carries */
box(
  rtl(
    '<b>הדפדפן מריץ</b><br>' +
      'דירוגים · השוואות · פרופילים<br><br>' +
      'קריאה ממאגר מקומי. אין מחיר בכך שהדפדפן רואה את התוצאה.',
  ),
  `${NOTE}fillColor=#eef4fc;strokeColor=#6c8ebf;`,
  60,
  360,
  460,
  140,
)

box(
  rtl(
    '<b>השרת מריץ</b><br>' +
      'get_airport_weather<br><br>' +
      'הכלי היחיד שיוצא החוצה. נקודת קצה שהדפדפן קורא לה לשירות חיצוני היא פרוקסי פתוח דרך כתובת השרת שלך.',
  ),
  `${NOTE}fillColor=#f0f7ee;strokeColor=#82b366;`,
  1140,
  360,
  460,
  140,
)

box(
  rtl(
    '<b>המודל לא יודע ולא אכפת לו</b><br><br>' +
      'הוא קורא לכלי. מי עונה — נקבע לפני שהשיחה התחילה, וזה לא משהו שאפשר לשכנע אותו לשנות.',
  ),
  `${NOTE}fillColor=#fff2cc;strokeColor=#d6b656;align=center;verticalAlign=middle;spacingTop=0;`,
  600,
  360,
  460,
  140,
)

/* the payoff, in three lines */
box(
  rtl(
    '<b>מה זה קונה</b><br>' +
      '<b>מהירות —</b> האודיו אף פעם לא עובר דרכך. אותה לטנסי כמו בלי זה: 275ms · 193ms · 1137ms, נמדד.<br>' +
      '<b>שליטה —</b> אין קריאה מהדפדפן לכלי הרגיש. הוא לא ברשימה שלו, ו-/api/tool מחזיר 403 לכל קורא.<br>' +
      '<b>בלי מתגים —</b> אותה שיחה. אין החלפת ערוץ ואין שיחה שנייה.',
  ),
  'rounded=1;whiteSpace=wrap;html=1;fillColor=#f5f5f5;strokeColor=#999999;fontSize=14;align=right;verticalAlign=top;spacingTop=12;spacingRight=14;arcSize=6;',
  60,
  560,
  1540,
  130,
)

box(
  rtl(
    '<b>ומה זה לא</b> — שני החיבורים על סשן אחד, אז הדפדפן עדיין רואה שהקריאה קרתה ומה המודל קיבל. זה מסתיר <b>מי מריץ</b>, לא <b>מה חזר</b>. לסודיות מלאה צריך שה-session עצמו יהיה בשרת — וזה פי 4-5 בלטנסי.',
  ),
  'rounded=1;whiteSpace=wrap;html=1;fillColor=#fff2cc;strokeColor=#d6b656;fontSize=13;align=right;verticalAlign=middle;spacingRight=14;arcSize=6;',
  60,
  710,
  1540,
  70,
)

const tab = `  <diagram id="hybrid-simple" name="12 - The hybrid, simply">
    <mxGraphModel dx="1422" dy="820" grid="1" gridSize="10" guides="1" tooltips="1" connect="1" arrows="1" fold="1" page="1" pageScale="1" pageWidth="1700" pageHeight="840" math="0" shadow="0">
      <root>
        <mxCell id="0"/>
        <mxCell id="1" parent="0"/>
${cells.join('\n')}
      </root>
    </mxGraphModel>
  </diagram>
`

let xml = readFileSync(FILE, 'utf8')
xml = xml.replace(/ {2}<diagram id="hybrid-simple"[\s\S]*?<\/diagram>\n/g, '')
writeFileSync(FILE, xml.replace('</mxfile>', tab + '</mxfile>'))
console.log('written: 12 - The hybrid, simply')
