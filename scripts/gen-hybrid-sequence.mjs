/**
 * Tab 11 — the hybrid tool placement, as a sequence.
 *
 * Tab 10 lays the two connections side by side; this one runs a single story down the
 * lifelines, because the point only lands in order: on the direct line a normal tool call
 * physically passes through the browser, and the withheld one never becomes a function call
 * at all. Same style vocabulary as tab 8 so the two read as one set.
 *
 * Re-running replaces the tab rather than stacking a copy.
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

/** A straight arrow between two x positions at one y, the way tab 8 draws them. */
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
  box(label, 'rounded=1;html=1;fillColor=none;strokeColor=#9a9a9a;dashed=1;dashPattern=6 6;arcSize=6;verticalAlign=top;align=left;spacingLeft=10;spacingTop=4;fontSize=12;fontColor=#7a7a7a;', x, y, w, h)

const HEAD_BLUE =
  'rounded=1;whiteSpace=wrap;html=1;fontSize=15;fontStyle=1;align=center;verticalAlign=middle;arcSize=10;fillColor=#dae8fc;strokeColor=#6c8ebf;'
const HEAD_GREEN =
  'rounded=1;whiteSpace=wrap;html=1;fontSize=15;fontStyle=1;align=center;verticalAlign=middle;arcSize=10;fillColor=#d5e8d4;strokeColor=#82b366;'
const HEAD_RED =
  'rounded=1;whiteSpace=wrap;html=1;fontSize=15;fontStyle=1;align=center;verticalAlign=middle;arcSize=10;fillColor=#f8cecc;strokeColor=#b85450;'
const ACT_GREEN =
  'rounded=1;whiteSpace=wrap;html=1;fontSize=13;align=center;verticalAlign=middle;arcSize=10;fillColor=#d5e8d4;strokeColor=#82b366;'
const ACT_RED =
  'rounded=1;whiteSpace=wrap;html=1;fontSize=13;align=center;verticalAlign=middle;arcSize=10;fillColor=#f8cecc;strokeColor=#b85450;'
const ACT_BLUE =
  'rounded=1;whiteSpace=wrap;html=1;fontSize=13;align=center;verticalAlign=middle;arcSize=10;fillColor=#dae8fc;strokeColor=#6c8ebf;'
const ACT_GATE =
  'rounded=1;whiteSpace=wrap;html=1;fontSize=13;fontStyle=1;align=center;verticalAlign=middle;arcSize=10;fillColor=#ffe6cc;strokeColor=#d79b00;'
const FOOT =
  'rounded=0;whiteSpace=wrap;html=1;fillColor=#f5f5f5;strokeColor=#999999;fontSize=11;align=left;spacingLeft=10;verticalAlign=top;spacingTop=8;'
const rtlBox = (html) => `<div dir='rtl' style='text-align:right'>${html}</div>`

/* ── lifelines ───────────────────────────────────────────────────────────── */
const BR = 300 // browser
const SV = 760 // your server
const OA = 1210 // openai
const OM = 1580 // open-meteo

box('gpt-realtime — the hybrid: who runs which tool', 'text;html=1;fontSize=26;fontStyle=1;align=left;verticalAlign=middle;', 40, 24, 1600, 40)
box(
  'One question on the direct line, then the same question on the relayed one. The model never sees a seventh tool on the first — so it never asks, and there is nothing to intercept.',
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

for (const x of [BR, SV, OA, OM]) lifeline(x, 152, 1545)

/* ── phase 1: the connection is built with SIX tools ─────────────────────── */
phase(rtlBox('התחברות — הרשימה נקבעת כאן, פעם אחת'), 100, 180, 1560, 190)

msg(BR, SV, 222, '1 · GET /api/realtime/session')
box(
  rtlBox('<b>2 · buildRealtimeSession(query, "browser")</b><br>6 כלים — get_airport_weather לא נכלל'),
  ACT_GREEN,
  SV - 200,
  244,
  400,
  50,
)
msg(SV, OA, 320, '3 · mint client_secret + prompt + 6 tools')
msg(OA, BR, 352, '4 · ephemeral key → WebRTC session live', 'exitX=0;exitY=0.5;')

/* ── phase 2: an ordinary tool — the browser IS in the loop ──────────────── */
phase(rtlBox('שאלה ראשונה — "דרג לי את ניו אינגלנד"  ·  כלי רגיל'), 100, 400, 1560, 330)

msg(BR, OA, 442, '5 · audio, straight to OpenAI')
msg(OA, BR, 480, '6 · function_call_arguments.done — rank_airports', 'exitX=0;exitY=0.5;')
box(
  rtlBox('<b>הקריאה נוחתת בדפדפן.</b><br>השרת לא רואה אותה — זו צורת הפרוטוקול'),
  ACT_BLUE,
  BR - 200,
  500,
  400,
  46,
)
msg(BR, SV, 578, '7 · POST /api/tool')
box(
  rtlBox('<b>8 · placement = anywhere</b> → runTool()<br>נרשם עם callId + חתימת SHA-256'),
  ACT_GREEN,
  SV - 200,
  598,
  400,
  50,
)
msg(SV, BR, 678, '9 · result + x-tool-call-id + x-tool-digest', 'exitX=0;exitY=0.5;')
msg(BR, OA, 710, '10 · function_call_output + response.create')

/* ── phase 3: the withheld tool — no function call ever happens ──────────── */
phase(rtlBox('שאלה שנייה — "מה מזג האוויר בבוסטון?"  ·  כלי שמור לשרת'), 100, 760, 1560, 330)

msg(BR, OA, 802, '11 · audio, straight to OpenAI')
box(
  rtlBox(
    '<b>12 · אין כלי מזג אוויר ברשימה שלו.</b><br>לכן אין function_call בכלל — אין מה ליירט',
  ),
  ACT_RED,
  OA - 230,
  822,
  460,
  50,
)
msg(OA, BR, 904, '13 · audio — "זה דורש את הקו של השרת, החלף ל־via your server"', 'exitX=0;exitY=0.5;')
box(
  rtlBox(
    '<b>14 · ואם משהו בכל זאת ינסה:</b>  POST /api/tool  →  <b>403</b><br>הסירוב חל על כל קורא, תמיד — הנקודה הזאת היא איך שדפדפן היה מגיע לכלי',
  ),
  ACT_GATE,
  SV - 300,
  946,
  600,
  56,
)
box(
  rtlBox(
    'ההוראה שמונעת מהמודל להמציא: <b>NOT AVAILABLE ON THIS CONNECTION</b> — בלעדיה, מודל שקיבל 6 כלים כשההוראות מרמזות על 7 עונה על השביעי מהזיכרון.',
  ),
  'rounded=0;whiteSpace=wrap;html=1;fillColor=#fff2cc;strokeColor=#d6b656;fontSize=11;align=right;spacingRight=10;verticalAlign=middle;',
  140,
  1016,
  1480,
  46,
)

/* ── phase 4: the same question on the relayed line ──────────────────────── */
phase(rtlBox('אותה שאלה, אחרי מעבר ל־"via your server"  ·  הדפדפן יוצא מהלולאה'), 100, 1120, 1560, 425)

msg(BR, SV, 1162, '15 · PCM16 frames')
box(
  rtlBox('<b>16 · buildRealtimeSession(query, "relay")</b><br>7 כלים — הכול זמין'),
  ACT_GREEN,
  SV - 200,
  1182,
  400,
  50,
)
msg(SV, OA, 1262, '17 · input_audio_buffer.append')
msg(OA, SV, 1296, '18 · function_call_arguments.done — get_airport_weather', 'exitX=0;exitY=0.5;')
box(
  rtlBox('<b>19 · runTool() בתוך התהליך</b>'),
  ACT_GREEN,
  SV - 160,
  1316,
  320,
  36,
)
msg(SV, OM, 1382, '20 · GET /v1/forecast')
msg(OM, SV, 1414, '21 · current conditions', 'exitX=0;exitY=0.5;')
msg(SV, OA, 1446, '22 · function_call_output + response.create')
msg(OA, SV, 1478, '23 · output_audio.delta', 'exitX=0;exitY=0.5;')
msg(SV, BR, 1510, '24 · PCM16 — הדפדפן קיבל אודיו בלבד', 'exitX=0;exitY=0.5;')

/* ── the point ───────────────────────────────────────────────────────────── */
box(
  rtlBox(
    '<b>למה זה המודל היחיד שעובד — ומה זה עולה</b><br>' +
      '<b>1. אי אפשר "להסתיר" כלי בקו הישיר.</b> ב-WebRTC ה-function_call נוחת על ערוץ הנתונים של הדפדפן והשרת לא בלולאה. לכן כלי שהדפדפן לא אמור לראות הוא כלי שהקו הזה לא יכול להציע — הוא מוסר מהרשימה, לא מוחבא מאחוריה.<br>' +
      '<b>2. שלוש נקודות אכיפה, כי כל אחת לבד היא תיאטרון.</b> הסשן (6 כלים) · הדלת (403) · המודל (יודע מה נמנע ואיזה מתג מזיז את השיחה).<br>' +
      '<b>3. הקו הוא הסיכון בקריאה, לא בתשובה.</b> ששת האחרים הם קריאה טהורה ממאגר מקומי — אין מחיר בכך שהדפדפן רואה את התוצאה. get_airport_weather הוא היחיד שיוצא מהבניין, ונקודת קצה שהדפדפן קורא לה היא פרוקסי פתוח דרך כתובת השרת שלך.<br>' +
      '<b>4. המחיר:</b> שלב 15–24 עולה פי 4–5 בלטנסי — 1,611ms מול כ-340ms, נמדד. מזג אוויר עולה יותר בקו הזה, וזו בדיוק הבחירה.<br>' +
      '<b>5. מה שעדיין פתוח:</b> ל-POST /api/tool אין אימות. שלב 14 חוסם את מזג האוויר לכל קורא, אבל שלב 7 עדיין ירוץ לכל מי שמגיע לפורט, וה-session id שנרשם ביומן נוצר בדפדפן ולכן אינו ראיה.',
  ),
  FOOT,
  100,
  1560,
  1560,
  180,
)

/* ── write ───────────────────────────────────────────────────────────────── */
const tab = `  <diagram id="seq-hybrid" name="11 - Sequence: the hybrid">
    <mxGraphModel dx="1422" dy="820" grid="1" gridSize="10" guides="1" tooltips="1" connect="1" arrows="1" fold="1" page="1" pageScale="1" pageWidth="1700" pageHeight="1800" math="0" shadow="0">
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
