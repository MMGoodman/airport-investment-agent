/**
 * Tab 12 — one weather question, all the way round.
 *
 * The first version had three boxes and no Open-Meteo in it at all, so "the server runs
 * get_airport_weather" sat there with no answer to the obvious question: runs it against
 * WHAT. A reader who does not already know where the temperature comes from cannot follow
 * the rest, and the whole point of a simple tab is that it needs nothing else.
 *
 * So: four actors, one question, seven numbered steps, and the two doors labelled by what
 * actually passes through them — numbers in through the server, voice out through the
 * browser. Nothing else on the page.
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

const arrow = (x1, y1, x2, y2, label, colour, dashed = false) => {
  const i = `s${++id}`
  cells.push(
    `        <mxCell id="${i}" value="${esc(label)}" style="endArrow=block;endFill=1;html=1;strokeWidth=3;fontSize=15;fontStyle=1;labelBackgroundColor=#ffffff;strokeColor=${colour};fontColor=${colour};${dashed ? 'dashed=1;dashPattern=8 8;' : ''}" edge="1" parent="1"><mxGeometry relative="1" as="geometry"><mxPoint x="${x1}" y="${y1}" as="sourcePoint"/><mxPoint x="${x2}" y="${y2}" as="targetPoint"/></mxGeometry></mxCell>`,
  )
  return i
}

const lifeline = (x, yTop, yBottom, colour) => {
  const i = `s${++id}`
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

const BLUE = '#6c8ebf'
const GREEN = '#82b366'
const RED = '#b85450'
const ORANGE = '#d79b00'

const YOU = 260
const BR = 620
const OA = 1010
const SV = 1400
const OM = 1740

box('המודל ההיברידי — שאלה אחת על מזג אוויר, מהתחלה עד הסוף', `${T}fontSize=28;fontStyle=1;`, 60, 26, 1500, 40)
box(
  rtl('סשן אחד אצל OpenAI, ושני חיבורים אליו. עקוב אחרי המספרים — אחרי שבעה צעדים חוזרים לאותו מקום.'),
  `${T}fontSize=14;fontColor=#6b6b6b;`,
  60,
  70,
  1500,
  24,
)

/* actors */
box(ctr('אתה<br><span style="font-size:11px;font-weight:normal">מיקרופון ורמקול</span>'), HEAD('#e8e8e8', '#9a9a9a'), YOU - 105, 120, 210, 66)
box(ctr('הדפדפן'), HEAD('#dae8fc', BLUE), BR - 105, 120, 210, 66)
box(ctr('OpenAI<br><span style="font-size:11px;font-weight:normal">gpt-realtime</span>'), HEAD('#f8cecc', RED), OA - 105, 120, 210, 66)
box(ctr('השרת שלך'), HEAD('#d5e8d4', GREEN), SV - 105, 120, 210, 66)
box(ctr('Open-Meteo'), HEAD('#ffe6cc', ORANGE), OM - 95, 120, 190, 66)

for (const [x, c] of [[YOU, '#9a9a9a'], [BR, BLUE], [OA, RED], [SV, GREEN], [OM, ORANGE]]) {
  lifeline(x, 190, 830, c)
}

/* what Open-Meteo actually is — the thing the previous version left unanswered */
box(
  rtl(
    '<b>מה זה Open-Meteo?</b><br>' +
      'אתר מזג אוויר חינמי באינטרנט. <b>לא</b> חלק מהפרויקט ולא קשור ל-OpenAI — רק דמיון בשם.<br>' +
      'שולחים לו קו רוחב וקו אורך, הוא מחזיר מספרים: טמפרטורה, רוח, ראות. בלי מפתח ובלי חשבון.<br>' +
      'הוא נבחר כי הוא <b>הדבר היחיד בכל הפרויקט שדורש לצאת לאינטרנט</b> — וזו כל הסיבה שהכלי שלו יושב בשרת.',
  ),
  NOTE('#fff4e6', ORANGE) + 'verticalAlign=top;spacingTop=10;',
  1130,
  870,
  740,
  110,
)

/* the seven steps */
arrow(YOU, 245, BR, 245, '1 · "מה מזג האוויר בבוסטון?"', '#4a4a4a')
arrow(BR, 300, OA, 300, '2 · האודיו, ישירות', BLUE)

box(
  rtl('<b>3 · המודל מכריז לחדר:</b> "אני צריך get_airport_weather · BOS"<br>ההכרזה נשמעת בשני החיבורים. הדפדפן שומע ושותק — השם לא ברשימה שלו.'),
  NOTE('#fde8e6', RED),
  OA - 330,
  340,
  660,
  62,
)

arrow(OA, 440, SV, 440, '4 · הקריאה מגיעה גם לכאן', GREEN)
arrow(SV, 490, OM, 490, '5 · lat/lon של בוסטון', ORANGE)
arrow(OM, 540, SV, 540, '6 · 15.3°C, בהיר, רוח 4 קשרים', ORANGE)
arrow(SV, 590, OA, 590, '7 · המספרים חוזרים כ-JSON', GREEN)

box(
  rtl('<b>המודל מנסח משפט מהמספרים.</b> הוא לא יודע מי ענה, ואין לו דרך לשאול.'),
  NOTE('#fde8e6', RED),
  OA - 280,
  630,
  560,
  46,
)

arrow(OA, 720, BR, 720, 'הקול חוזר', BLUE)
arrow(BR, 770, YOU, 770, '"בבוסטון לוגן 15.3 מעלות, בהיר"', '#4a4a4a')

/* the one thing to take away */
box(
  rtl(
    '<b>הדלת של השרת נכנסת בלבד.</b> JSON נכנס בה. <b>אף פעם לא יוצא ממנה קול.</b><br>' +
      'כל הקול — בלי יוצא מן הכלל — עובר בדלת של הדפדפן. לכן זה מהיר: 974ms · 796ms, נמדד.',
  ),
  'rounded=1;whiteSpace=wrap;html=1;fillColor=#e8f0e4;strokeColor=#82b366;fontSize=15;align=right;verticalAlign=middle;spacingRight=14;arcSize=6;',
  60,
  870,
  1030,
  110,
)

box(
  rtl(
    '<b>ומה עם ששת הכלים האחרים?</b> דירוגים, השוואות ופרופילים — הדפדפן מריץ אותם בעצמו: שומע את ההכרזה, רץ לשרת דרך POST /api/tool, ומקריא את התוצאה בחזרה. ' +
      'הם קוראים ממאגר מקומי שממילא שלך, אז אין נזק בכך שהוא רואה אותם. <b>רק מזג האוויר יוצא החוצה, ורק הוא יושב בשרת.</b>',
  ),
  'rounded=1;whiteSpace=wrap;html=1;fillColor=#eef4fc;strokeColor=#6c8ebf;fontSize=13;align=right;verticalAlign=middle;spacingRight=14;spacingLeft=14;arcSize=6;',
  60,
  1000,
  1810,
  70,
)

box(
  rtl(
    '<b>ומה זה לא עושה</b> — שני החיבורים על סשן אחד, אז הדפדפן שומע שהקריאה קרתה. הוא לא מריץ אותה ולא מקבל את ה-JSON, אבל את המשפט המדובר הוא שומע כמו כולם. ' +
      'זה מסתיר <b>מי מריץ</b>, לא <b>מה חזר</b>. לסודיות מלאה כל השיחה צריכה לעבור בשרת — וזה פי 4-5 בלטנסי.',
  ),
  'rounded=1;whiteSpace=wrap;html=1;fillColor=#fff2cc;strokeColor=#d6b656;fontSize=13;align=right;verticalAlign=middle;spacingRight=14;spacingLeft=14;arcSize=6;',
  60,
  1090,
  1810,
  70,
)

const tab = `  <diagram id="hybrid-simple" name="12 - The hybrid, simply">
    <mxGraphModel dx="1422" dy="820" grid="1" gridSize="10" guides="1" tooltips="1" connect="1" arrows="1" fold="1" page="1" pageScale="1" pageWidth="1960" pageHeight="1220" math="0" shadow="0">
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
