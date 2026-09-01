/**
 * Tab 11 — the hybrid, as a sequence.
 *
 * Rewritten. The first version said a tool the browser must not invoke could only be
 * withheld from the WebRTC line, because the function call lands on the browser's data
 * channel and the server is never in that loop. That is wrong: a Realtime session takes a
 * second connection from an application server, addressed by call id, and either side can
 * answer a tool call. The sequence below is the one that was actually observed running.
 *
 * Same style vocabulary as tab 8 so the two read as one set. Re-running replaces the tab.
 */
import { readFileSync, writeFileSync } from 'node:fs'

const FILE = new URL('../docs/architecture.drawio', import.meta.url).pathname.replace(/^\//, '')

let id = 0
const nid = () => `h${++id}`
const cells = []

const esc = (s) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

const box = (value, style, x, y, w, h) => {
  const i = nid()
  cells.push(
    `        <mxCell id="${i}" value="${esc(value)}" style="${style}" vertex="1" parent="1"><mxGeometry x="${x}" y="${y}" width="${w}" height="${h}" as="geometry"/></mxCell>`,
  )
  return i
}

const msg = (x1, x2, y, label, style = '') => {
  const i = nid()
  cells.push(
    `        <mxCell id="${i}" value="${esc(label)}" style="endArrow=block;endFill=1;html=1;strokeWidth=2;strokeColor=#4a4a4a;fontSize=13;labelBackgroundColor=#ffffff;verticalAlign=bottom;${style}" edge="1" parent="1"><mxGeometry relative="1" as="geometry"><mxPoint x="${x1}" y="${y}" as="sourcePoint"/><mxPoint x="${x2}" y="${y}" as="targetPoint"/></mxGeometry></mxCell>`,
  )
  return i
}

const lifeline = (x, yTop, yBottom) => {
  const i = nid()
  cells.push(
    `        <mxCell id="${i}" style="endArrow=none;dashed=1;dashPattern=4 4;strokeWidth=1;strokeColor=#9a9a9a;html=1;" edge="1" parent="1"><mxGeometry relative="1" as="geometry"><mxPoint x="${x}" y="${yTop}" as="sourcePoint"/><mxPoint x="${x}" y="${yBottom}" as="targetPoint"/></mxGeometry></mxCell>`,
  )
  return i
}

const phase = (label, x, y, w, h) =>
  box(
    label,
    'rounded=1;html=1;fillColor=none;strokeColor=#9a9a9a;dashed=1;dashPattern=6 6;arcSize=6;verticalAlign=top;align=left;spacingLeft=10;spacingTop=4;fontSize=12;fontColor=#7a7a7a;',
    x,
    y,
    w,
    h,
  )

const HEAD_BLUE =
  'rounded=1;whiteSpace=wrap;html=1;fontSize=15;fontStyle=1;align=center;verticalAlign=middle;arcSize=10;fillColor=#dae8fc;strokeColor=#6c8ebf;'
const HEAD_GREEN =
  'rounded=1;whiteSpace=wrap;html=1;fontSize=15;fontStyle=1;align=center;verticalAlign=middle;arcSize=10;fillColor=#d5e8d4;strokeColor=#82b366;'
const HEAD_RED =
  'rounded=1;whiteSpace=wrap;html=1;fontSize=15;fontStyle=1;align=center;verticalAlign=middle;arcSize=10;fillColor=#f8cecc;strokeColor=#b85450;'
const ACT_GREEN =
  'rounded=1;whiteSpace=wrap;html=1;fontSize=13;align=center;verticalAlign=middle;arcSize=10;fillColor=#d5e8d4;strokeColor=#82b366;'
const ACT_BLUE =
  'rounded=1;whiteSpace=wrap;html=1;fontSize=13;align=center;verticalAlign=middle;arcSize=10;fillColor=#dae8fc;strokeColor=#6c8ebf;'
const ACT_GATE =
  'rounded=1;whiteSpace=wrap;html=1;fontSize=13;fontStyle=1;align=center;verticalAlign=middle;arcSize=10;fillColor=#ffe6cc;strokeColor=#d79b00;'
const FOOT =
  'rounded=0;whiteSpace=wrap;html=1;fillColor=#f5f5f5;strokeColor=#999999;fontSize=11;align=left;spacingLeft=10;verticalAlign=top;spacingTop=8;'
const rtlBox = (html) => `<div dir='rtl' style='text-align:right'>${html}</div>`

const BR = 300
const SV = 760
const OA = 1210
const OM = 1580

box(
  'gpt-realtime — one session, two connections',
  'text;html=1;fontSize=26;fontStyle=1;align=left;verticalAlign=middle;',
  40,
  24,
  1600,
  40,
)
box(
  'The browser holds the audio. The server holds a second connection to the same session and answers the tools the browser must not invoke. Observed end to end — the step numbers below are the run, not a design.',
  'text;html=1;fontSize=13;align=left;verticalAlign=middle;fontColor=#6b6b6b;',
  40,
  66,
  1600,
  24,
)

box(rtlBox('הדפדפן'), HEAD_BLUE, BR - 110, 108, 220, 42)
box(rtlBox('השרת שלך'), HEAD_GREEN, SV - 110, 108, 220, 42)
box('openai', HEAD_RED, OA - 110, 108, 220, 42)
box('open-meteo', HEAD_RED, OM - 100, 108, 200, 42)

for (const x of [BR, SV, OA, OM]) lifeline(x, 152, 1495)

/* phase 1 — the session is minted deliberately short */
phase(rtlBox('התחברות — הרשימה נקבעת פעמיים, וזה בכוונה'), 100, 180, 1560, 230)
msg(BR, SV, 222, '1 · GET /api/realtime/session?session=…')
box(
  rtlBox(
    '<b>2 · buildRealtimeSession(query, "browser")</b><br>6 כלים · והפרומט אומר שמזג האוויר לא זמין בקו הזה<br>המפתח הזמני נשמר לשתי דקות',
  ),
  ACT_GREEN,
  SV - 210,
  242,
  420,
  62,
)
msg(SV, OA, 328, '3 · mint client_secret')
msg(OA, BR, 360, '4 · ephemeral key', 'exitX=0;exitY=0.5;')
msg(BR, OA, 392, '5 · POST /v1/realtime/calls — SDP offer')

/* phase 2 — the sideband joins */
phase(rtlBox('ההצמדה — אחרי שהשיחה קיימת, לא לפני'), 100, 425, 1560, 275)
msg(OA, BR, 467, '6 · SDP answer  +  Location: /v1/realtime/calls/rtc_…', 'exitX=0;exitY=0.5;')
box(
  rtlBox(
    '<b>7 · הדפדפן קורא את ה-call_id מהכותרת</b><br>אפשרי רק כי Location מופיע ב-Access-Control-Expose-Headers',
  ),
  ACT_BLUE,
  BR - 220,
  487,
  440,
  50,
)
msg(BR, SV, 561, '8 · POST /api/realtime/sideband { callId }')
msg(SV, OA, 593, '9 · wss ?call_id=rtc_…  —  Bearer THE EPHEMERAL KEY')
box(
  rtlBox(
    '<b>10 · session.update</b> — כל 7 הכלים, ופרומט בלי הפסקה על מה שחסר<br>כלים והוראות זזים יחד, אחרת המודל מסרב לכלי שכבר יש לו',
  ),
  ACT_GREEN,
  SV - 250,
  613,
  500,
  50,
)

/* phase 3 — a browser tool */
phase(rtlBox('כלי של הדפדפן — הדפדפן בלולאה'), 100, 715, 1560, 235)
msg(BR, OA, 757, '11 · audio, ישירות')
msg(OA, BR, 789, '12 · function_call — rank_airports', 'exitX=0;exitY=0.5;')
msg(BR, SV, 821, '13 · POST /api/tool')
box(
  rtlBox('<b>14 · placement = anywhere</b> → runTool · callId + חתימה'),
  ACT_GREEN,
  SV - 210,
  841,
  420,
  36,
)
msg(SV, BR, 895, '15 · result', 'exitX=0;exitY=0.5;')
msg(BR, OA, 927, '16 · function_call_output')

/* phase 4 — the server tool, on the same session */
phase(rtlBox('כלי של השרת — אותו סשן, הדפדפן מחוץ ללולאה'), 100, 965, 1560, 330)
msg(BR, OA, 1007, '17 · audio — "מה מזג האוויר בבוסטון?"')
box(
  rtlBox(
    '<b>18 · הקריאה משודרת לשני החיבורים.</b> הדפדפן רואה אותה ו<b>לא</b> עונה —<br>שני צדדים שעונים ייצרו שני outputs לאותו call_id',
  ),
  ACT_BLUE,
  BR - 250,
  1027,
  500,
  50,
)
msg(OA, SV, 1101, '19 · function_call — get_airport_weather', 'exitX=0;exitY=0.5;')
box(rtlBox('<b>20 · runTool בתהליך של השרת</b>'), ACT_GREEN, SV - 160, 1121, 320, 36)
msg(SV, OM, 1183, '21 · GET /v1/forecast')
msg(OM, SV, 1215, '22 · current conditions', 'exitX=0;exitY=0.5;')
msg(SV, OA, 1247, '23 · function_call_output + response.create')
msg(OA, BR, 1279, '24 · audio — התשובה, בקו הישיר', 'exitX=0;exitY=0.5;')

box(
  rtlBox(
    '<b>25 · ומי שינסה לעקוף:</b>  POST /api/tool  get_airport_weather  →  <b>403</b>, לכל קורא, תמיד',
  ),
  ACT_GATE,
  SV - 300,
  1320,
  600,
  38,
)

/* what was measured */
box(
  rtlBox(
    '<b>מה שנמדד בפועל</b><br>' +
      'sideband נפתח אחרי <b>559ms</b> · הכריז 7 כלים · הריץ get_airport_weather ב-<b>302ms</b> → t1 ביומן הביקורת.<br>' +
      'הדפדפן ראה את הקריאה: <b>כן</b>. הדפדפן ענה על קריאת כלי: <b>לא</b>.<br>' +
      'התשובה: "בבוסטון לוגן כרגע מעונן לגמרי, הטמפרטורה בערך 19.4 מעלות…"',
  ),
  'rounded=0;whiteSpace=wrap;html=1;fillColor=#d5e8d4;strokeColor=#82b366;fontSize=11;align=right;spacingRight=10;verticalAlign=top;spacingTop=8;',
  100,
  1380,
  1560,
  90,
)

box(
  rtlBox(
    '<b>מה זה קונה, ומה זה עדיין לא</b><br>' +
      '<b>1. אין החלפת ערוץ.</b> אותו סשן, אותה שיחה. המהירות של החיבור הישיר, והכלי הרגיש רץ בשרת. הבחירה של המשתמש בין שני קווים הייתה fallback, לא עיצוב.<br>' +
      '<b>2. ניתוב הוא לא החלטה של המודל.</b> הגבול נקבע לפני שהשיחה מתחילה ויושב ברשימת הכלים, לא בהוראות — מה שאפשר לשכנע את המודל לעשות, אפשר גם להזריק לו.<br>' +
      '<b>3. זה לא מסתיר את החילוף.</b> שני החיבורים על סשן אחד: הדפדפן רואה שהקריאה קרתה ומה המודל קיבל. תוצאה שאסור שתגיע ללקוח בכלל דורשת שה-session עצמו יהיה בשרת — זה טאב 8, ופי 4-5 בלטנסי.<br>' +
      '<b>4. עדיין פתוח:</b> ל-POST /api/tool אין אימות. שלב 25 חוסם את מזג האוויר לכל קורא, אבל שלב 13 ירוץ לכל מי שמגיע לפורט.',
  ),
  FOOT,
  100,
  1490,
  1560,
  150,
)

const tab = `  <diagram id="seq-hybrid" name="11 - Sequence: the hybrid">
    <mxGraphModel dx="1422" dy="820" grid="1" gridSize="10" guides="1" tooltips="1" connect="1" arrows="1" fold="1" page="1" pageScale="1" pageWidth="1700" pageHeight="1700" math="0" shadow="0">
      <root>
        <mxCell id="0"/>
        <mxCell id="1" parent="0"/>
${cells.join('\n')}
      </root>
    </mxGraphModel>
  </diagram>
`

let xml = readFileSync(FILE, 'utf8')
xml = xml.replace(/ {2}<diagram id="seq-hybrid"[\s\S]*?<\/diagram>\n/g, '')
writeFileSync(FILE, xml.replace('</mxfile>', tab + '</mxfile>'))
console.log('written: 11 - Sequence: the hybrid')
