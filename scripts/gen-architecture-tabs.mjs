import { readFileSync, writeFileSync } from 'node:fs'

const FILE = 'C:/Users/Tehila/Desktop/Wonderful/airport-investment-agent/docs/architecture.drawio'
let id = 0
const nid = () => `x${++id}`
let cells = []

const esc = (s) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

const cell = (value, style, x, y, w, h, parent = '1') => {
  const i = nid()
  cells.push(
    `        <mxCell id="${i}" value="${esc(value)}" style="${style}" vertex="1" parent="${parent}"><mxGeometry x="${x}" y="${y}" width="${w}" height="${h}" as="geometry"/></mxCell>`,
  )
  return i
}

const edge = (src, dst, label = '', style = '') => {
  const i = nid()
  cells.push(
    `        <mxCell id="${i}" value="${esc(label)}" style="edgeStyle=orthogonalEdgeStyle;rounded=1;html=1;fontSize=11;${style}" edge="1" parent="1" source="${src}" target="${dst}"><mxGeometry relative="1" as="geometry"/></mxCell>`,
  )
  return i
}

const S = {
  h1: 'text;html=1;fontSize=26;fontStyle=1;align=left;verticalAlign=middle;',
  sub: 'text;html=1;fontSize=13;align=left;verticalAlign=top;fontColor=#6b6b6b;',
  cap: 'text;html=1;fontSize=11;fontStyle=1;align=left;verticalAlign=middle;fontColor=#666666;',
  laneBlue:
    'swimlane;html=1;startSize=40;fillColor=#dae8fc;strokeColor=#6c8ebf;fontSize=16;fontStyle=1;rounded=0;swimlaneFillColor=#eef4fc;',
  laneGreen:
    'swimlane;html=1;startSize=40;fillColor=#d5e8d4;strokeColor=#82b366;fontSize=16;fontStyle=1;rounded=0;swimlaneFillColor=#f0f7ee;',
  laneRed:
    'swimlane;html=1;startSize=40;fillColor=#f8cecc;strokeColor=#b85450;fontSize=16;fontStyle=1;rounded=0;swimlaneFillColor=#fdf1f0;',
  boxBlue:
    'rounded=1;whiteSpace=wrap;html=1;fillColor=#ffffff;strokeColor=#6c8ebf;fontSize=11;align=left;spacingLeft=8;arcSize=12;verticalAlign=top;spacingTop=6;',
  boxGreen:
    'rounded=1;whiteSpace=wrap;html=1;fillColor=#ffffff;strokeColor=#82b366;fontSize=11;align=left;spacingLeft=8;arcSize=12;verticalAlign=top;spacingTop=6;',
  boxRed:
    'rounded=1;whiteSpace=wrap;html=1;fillColor=#ffffff;strokeColor=#b85450;fontSize=11;align=left;spacingLeft=8;arcSize=12;verticalAlign=top;spacingTop=6;',
  boxGrey:
    'rounded=1;whiteSpace=wrap;html=1;fillColor=#ffffff;strokeColor=#909090;fontSize=11;align=left;spacingLeft=8;arcSize=12;verticalAlign=top;spacingTop=6;',
  gate: 'rounded=1;whiteSpace=wrap;html=1;fillColor=#ffe6cc;strokeColor=#d79b00;fontSize=11;fontStyle=1;align=left;spacingLeft=8;arcSize=12;verticalAlign=top;spacingTop=6;',
  block:
    'rounded=1;whiteSpace=wrap;html=1;fillColor=#f8cecc;strokeColor=#b85450;fontSize=11;fontStyle=1;align=left;spacingLeft=8;arcSize=12;verticalAlign=top;spacingTop=6;',
  ok: 'rounded=1;whiteSpace=wrap;html=1;fillColor=#d5e8d4;strokeColor=#82b366;fontSize=11;fontStyle=1;align=left;spacingLeft=8;arcSize=12;verticalAlign=top;spacingTop=6;',
  he: 'rounded=0;whiteSpace=wrap;html=1;fillColor=#fff2cc;strokeColor=#d6b656;fontSize=11;align=right;spacingRight=10;verticalAlign=top;spacingTop=8;',
}

const rtl = (html) => `<div dir="rtl" style="text-align:right">${html}</div>`

/* ───────────────────────── TAB 9 — the project today ───────────────────────── */
cells = []
id = 0

cell('Airport Investment Agent — the project today', S.h1, 40, 24, 1600, 40)
cell(
  'Five providers, two live transports, one scoring engine. Every figure the model states comes from a tool result, and the server decides which tools exist.',
  S.sub,
  40,
  68,
  1600,
  22,
)

const cl = cell('BROWSER', S.laneBlue, 40, 120, 470, 640)
cell('CHAT + CONTROL', S.cap, 18, 48, 430, 16, cl)
cell('App.jsx — chat, provider switcher, EN/HE', S.boxBlue, 18, 68, 430, 24, cl)
cell('LivePanel.jsx — pipeline board, audit, timings', S.boxBlue, 18, 96, 430, 24, cl)
cell('LiveTrace.jsx — trace + session-wide totals', S.boxBlue, 18, 124, 430, 24, cl)
cell('live/stopwatch.js — which timing an answer can report', S.boxBlue, 18, 152, 430, 24, cl)
cell('agent/phantom.js — hint-echo guard, imports nothing', S.boxBlue, 18, 180, 430, 24, cl)
cell('LIVE TRANSPORTS', S.cap, 18, 216, 430, 16, cl)
const wrtc = cell(
  'live/openaiRealtime.js — WebRTC\nthe browser holds the session',
  S.boxBlue,
  18,
  236,
  430,
  38,
  cl,
)
const rly = cell(
  'live/openaiRelay.js — mic and speaker only\nPCM16 both ways over a WebSocket',
  S.boxBlue,
  18,
  280,
  430,
  38,
  cl,
)
cell('live/soniox.js · live/elevenlabs.js — cascades', S.boxBlue, 18, 324, 430, 24, cl)
cell('THE ONLY DOOR TO THE ENGINE', S.cap, 18, 360, 430, 16, cl)
const door = cell('live/tools.js → POST /api/tool', S.gate, 18, 380, 430, 26, cl)
cell(
  rtl(
    '<b>מחזיק:</b> מיקרופון, אודיו, חיבור ישיר, מדידת זמן.<br><b>לא מחזיק:</b> ניקוד, נתונים, פרומפט, מפתחות חשבון.<br><b>כן מחזיק:</b> מפתח זמני בלבד — נטבע בשרת, חי דקות.<br><b>לא מגיע אליו:</b> get_airport_weather — ראה טאב 10.',
  ),
  S.he,
  18,
  420,
  430,
  110,
  cl,
)

const sv = cell('YOUR SERVER — Node · Express', S.laneGreen, 560, 120, 470, 640)
cell('SESSION AUTHORITY', S.cap, 18, 48, 430, 16, sv)
const bld = cell(
  'voice.js — buildRealtimeSession(query, transport)\nprompt · tools · turn detection · language · voice',
  S.boxGreen,
  18,
  68,
  430,
  38,
  sv,
)
cell('GET /api/realtime/session — mints the ephemeral key', S.boxGreen, 18, 112, 430, 24, sv)
const rel = cell(
  'relay.js — holds the OpenAI socket, tools in-process',
  S.boxGreen,
  18,
  140,
  430,
  24,
  sv,
)
cell('THE ENGINE', S.cap, 18, 176, 430, 16, sv)
const eng = cell(
  'agent/tools.js — 7 tools · runTool()\nscoring/ — pure functions, 44 verify checks',
  S.boxGreen,
  18,
  196,
  430,
  38,
  sv,
)
const gate = cell('POST /api/tool — refuses placement:server, always', S.gate, 18, 240, 430, 26, sv)
cell('toolLog.js — callId + SHA-256 · JSONL · survives restart', S.boxGreen, 18, 272, 430, 24, sv)
cell('POST /api/tool-log/reconcile — claim vs record', S.boxGreen, 18, 300, 430, 24, sv)
cell('TEXT PATH', S.cap, 18, 336, 430, 16, sv)
cell(
  'POST /api/chat → agent/agent.js → Gemini\nsame process, so nothing can get between the two',
  S.boxGreen,
  18,
  356,
  430,
  38,
  sv,
)
cell(
  rtl(
    '<b>השרת הוא הסמכות בשני הנתיבים.</b><br>אותו buildRealtimeSession בונה את הפרומט, רשימת הכלים, ה-VAD והשפה — גם ל-WebRTC וגם לרילוי.<br>ההבדל היחיד: איפה עוברים בייטים של אודיו.',
  ),
  S.he,
  18,
  408,
  430,
  110,
  sv,
)

const vn = cell('VENDORS', S.laneRed, 1080, 120, 470, 640)
const oa = cell(
  'OpenAI\n· /v1/realtime/client_secrets — mint\n· /v1/realtime/calls — WebRTC\n· wss realtime — the relayed socket\n· gpt-4o-transcribe — parallel listener',
  S.boxRed,
  18,
  48,
  430,
  86,
  vn,
)
cell('Google Gemini — generateContent, the text path', S.boxRed, 18, 146, 430, 24, vn)
cell('Soniox — wss stt-rt-v5', S.boxRed, 18, 174, 430, 24, vn)
cell('ElevenLabs Agents — their LLM runs on their side', S.boxRed, 18, 202, 430, 24, vn)
const om = cell(
  'Open-Meteo — no key, no account\nreached ONLY from the server',
  S.boxRed,
  18,
  238,
  430,
  38,
  vn,
)
cell(
  rtl(
    '<b>מה מוגן ואיפה:</b> מפתחות החשבון לעולם לא עוזבים את השרת. הדפדפן מקבל מפתח זמני שחי דקות.<br>כל קריאת כלי נרשמת עם callId וחתימת SHA-256, והפאנל מיישב מולה — כי בנתיבי הקול הדפדפן הוא שמוסר את התוצאה למודל.',
  ),
  S.he,
  18,
  296,
  430,
  120,
  vn,
)

edge(wrtc, oa, 'audio + data channel', 'strokeColor=#6c8ebf;strokeWidth=2;')
edge(rly, rel, 'PCM16', 'strokeColor=#6c8ebf;strokeWidth=2;')
edge(rel, oa, 'WebSocket', 'strokeColor=#82b366;strokeWidth=2;')
edge(door, gate, '', 'strokeColor=#d79b00;strokeWidth=2;')
edge(gate, eng, '', 'strokeColor=#82b366;')
edge(eng, om, 'get_airport_weather only', 'strokeColor=#b85450;dashed=1;')
edge(bld, oa, 'session config', 'strokeColor=#82b366;dashed=1;')

cell('WHAT IS CHECKED', S.cap, 40, 800, 1500, 16)
cell(
  'npm test — 52 tests   ·   npm run verify — 44 engine checks   ·   npm run eval — 19 cases across two model paths, provenance 19/19\nsrc/live/__tests__/browser-safe.test.js walks the real client module graph and fails on any node: import — the build cannot catch that, it compiles such code clean and blanks the page on load.',
  S.boxGrey,
  40,
  822,
  1510,
  56,
)

const tab9 = cells.join('\n')

/* ───────────────────── TAB 10 — where the hybrid sits ───────────────────── */
cells = []
id = 0

cell('Where the hybrid sits — placement is the tool list', S.h1, 40, 24, 1600, 40)
cell(
  'The hybrid is not a third transport. It is that the two connections are built with different tool lists, and the server decides which.',
  S.sub,
  40,
  68,
  1600,
  22,
)

cell('THE CONSTRAINT — protocol shape, not a preference', S.cap, 40, 110, 1500, 16)
cell(
  'WebRTC   model —function_call→ BROWSER data channel → browser runs it → browser injects the result.    The server is never in that loop.\nRelay     model —function_call→ YOUR SERVER → server runs it in-process → server injects the result.    The browser never sees it.\n\nSo a tool the browser must not see is a tool WebRTC cannot offer. Placement removes it from that line rather than hiding it there.',
  S.boxGrey,
  40,
  132,
  1510,
  76,
)

const dl = cell('DIRECT LINE — gpt-realtime · voice   (WebRTC)', S.laneBlue, 40, 240, 730, 470)
cell('SESSION BUILT WITH 6 TOOLS', S.cap, 18, 48, 690, 16, dl)
cell(
  'list_supported_regions · rank_airports · compare_airports\nget_airport_profile · get_flight_mix · end_call',
  S.boxBlue,
  18,
  68,
  690,
  40,
  dl,
)
cell('get_airport_weather — NOT DECLARED HERE', S.block, 18, 116, 690, 26, dl)
cell('WHO RUNS THEM', S.cap, 18, 152, 690, 16, dl)
cell(
  'The browser. live/tools.js → POST /api/tool → engine → result injected back into the data channel.',
  S.boxBlue,
  18,
  172,
  690,
  32,
  dl,
)
cell('WHAT THE MODEL IS TOLD', S.cap, 18, 214, 690, 16, dl)
cell(
  'NOT AVAILABLE ON THIS CONNECTION — get_airport_weather is not offered on this line. Say so\nin one sentence and name the switch.\nWithout this, a model handed six tools where its instructions imply seven answers the seventh from\nmemory — which is how a caller who asked for the weather got a score summary.',
  S.boxBlue,
  18,
  234,
  690,
  72,
  dl,
)
cell('LATENCY', S.cap, 18, 318, 690, 16, dl)
cell(
  'Roughly 340–900 ms to first sound. Echo cancellation, jitter buffering and loss concealment come free.',
  S.ok,
  18,
  338,
  690,
  32,
  dl,
)
cell(
  rtl(
    '<b>מה הדפדפן רואה:</b> כל קריאת כלי וכל תוצאה שהמודל מקבל.<br>זה לא ניתן לשינוי בטרנספורט הזה — ולכן כלי רגיש פשוט לא מוצע כאן.',
  ),
  S.he,
  18,
  382,
  690,
  70,
  dl,
)

const sl = cell('RELAYED LINE — via your server   (WebSocket)', S.laneGreen, 810, 240, 730, 470)
cell('SESSION BUILT WITH ALL 7 TOOLS', S.cap, 18, 48, 690, 16, sl)
cell('the six above, plus:', S.boxGreen, 18, 68, 690, 24, sl)
cell('get_airport_weather — runs here, in-process', S.ok, 18, 100, 690, 26, sl)
cell('WHO RUNS THEM', S.cap, 18, 136, 690, 16, sl)
cell(
  'The server. relay.js calls runTool() directly. Nothing crosses to the browser but audio.',
  S.boxGreen,
  18,
  156,
  690,
  32,
  sl,
)
cell('WHAT THE MODEL IS TOLD', S.cap, 18, 198, 690, 16, sl)
cell('Nothing extra. Nothing is withheld, so there is no gap to explain.', S.boxGreen, 18, 218, 690, 28, sl)
cell('LATENCY', S.cap, 18, 258, 690, 16, sl)
cell(
  'Four to five times the direct line — 1,611 ms measured against roughly 340 ms. Echo cancellation and\njitter buffering are lost. conversation.item.truncate is not sent on barge-in, because only the browser\nknows where playback actually stopped.',
  S.boxGreen,
  18,
  278,
  690,
  60,
  sl,
)
cell(
  rtl(
    '<b>מה הדפדפן רואה:</b> אודיו בלבד. התמלול, התשובות וקריאות הכלים — כולם בשרת.<br>זה המחיר וזו גם התמורה.',
  ),
  S.he,
  18,
  352,
  690,
  70,
  sl,
)

cell('ENFORCED IN THREE PLACES — any one alone is theatre', S.cap, 40, 740, 1500, 16)
cell(
  '1.  THE SESSION\nbuildRealtimeSession(query, "browser") returns six tools,\nso the model cannot ask for the seventh.',
  S.boxGrey,
  40,
  762,
  480,
  70,
)
cell(
  '2.  THE DOOR\nPOST /api/tool returns 403 for placement:"server" — every\ncaller, always. That endpoint IS how a browser would reach it.',
  S.gate,
  550,
  762,
  490,
  70,
)
cell(
  '3.  THE MODEL\nTold what is withheld and which switch moves the call to the\nline where it works, so the gap is named rather than improvised.',
  S.boxGrey,
  1070,
  762,
  480,
  70,
)

cell('WHY get_airport_weather AND NOTHING ELSE', S.cap, 40, 852, 1500, 16)
cell(
  'Every other tool is a pure read over a local, read-only dataset — the browser seeing that result costs nothing. get_airport_weather is the one call that leaves the building, so a browser-reachable endpoint for it is an open proxy through this server address.\nThat is the line: a tool is server-placed when the risk is in the CALL, not in the answer.',
  S.boxGrey,
  40,
  874,
  1510,
  54,
)

cell(
  rtl(
    '<b>עדיין פתוח:</b> ל-POST /api/tool אין אימות כלל. הוא יסרב עכשיו למזג אוויר לכל קורא, אבל את ששת כלי הקריאה הוא מריץ לכל מי שמגיע לפורט, וה-session id שהוא רושם ביומן נוצר בדפדפן ולכן אינו ראיה לכלום. התיקון: טוקן קצר-חיים שנטבע יחד עם המפתח הזמני, נדרש בנקודת הקצה, ומשמש כמזהה הסשן האמיתי.',
  ),
  S.he,
  40,
  946,
  1510,
  80,
)

const tab10 = cells.join('\n')

/* ───────────────────────────── write ───────────────────────────── */
const wrap = (diagramId, name, body, w, h) =>
  `  <diagram id="${diagramId}" name="${name}">
    <mxGraphModel dx="1422" dy="820" grid="1" gridSize="10" guides="1" tooltips="1" connect="1" arrows="1" fold="1" page="1" pageScale="1" pageWidth="${w}" pageHeight="${h}" math="0" shadow="0">
      <root>
        <mxCell id="0"/>
        <mxCell id="1" parent="0"/>
${body}
      </root>
    </mxGraphModel>
  </diagram>`

let xml = readFileSync(FILE, 'utf8')
// Re-running replaces these two rather than stacking copies.
xml = xml.replace(/ {2}<diagram id="(project-today|hybrid-placement)"[\s\S]*?<\/diagram>\n/g, '')

const added =
  wrap('project-today', '9 - The project today', tab9, 1700, 940) +
  '\n' +
  wrap('hybrid-placement', '10 - Where the hybrid sits', tab10, 1700, 1080) +
  '\n'

writeFileSync(FILE, xml.replace('</mxfile>', added + '</mxfile>'))
console.log('written: 2 tabs')
