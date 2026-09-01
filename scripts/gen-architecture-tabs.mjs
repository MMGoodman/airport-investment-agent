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

/* TAB 10 — where the hybrid sits */
cells = []
id = 0

cell('Where the hybrid sits — three places a tool can run', S.h1, 40, 24, 1600, 40)
cell(
  'A Realtime session takes two connections: the browser holds the audio, and this server can hold a second one addressed by call id. Placement is not "which transport" — it is who answers the function call, on the same session.',
  S.sub, 40, 68, 1600, 22,
)

cell('CORRECTING WHAT THIS TAB USED TO SAY', S.cap, 40, 110, 1500, 16)
cell(
  'It said a tool the browser must not invoke could only be withheld from the WebRTC line, because the function call lands on the browser data channel and the server is never in that loop. That is wrong. OpenAI calls the second connection a sideband control channel: either side can answer a tool call, and the side that does not simply ignores it.',
  S.boxGrey, 40, 132, 1510, 46,
)

const l1 = cell('1 · BROWSER-RUN   placement: anywhere', S.laneBlue, 40, 200, 480, 400)
cell('WHO ANSWERS', S.cap, 18, 48, 440, 16, l1)
cell('The browser. live/tools.js → POST /api/tool → engine →\nresult injected back into the data channel.', S.boxBlue, 18, 68, 440, 40, l1)
cell('WHAT THE BROWSER SEES', S.cap, 18, 120, 440, 16, l1)
cell('The call, the arguments and the result. It runs the tool.', S.boxBlue, 18, 140, 440, 30, l1)
cell('LATENCY', S.cap, 18, 182, 440, 16, l1)
cell('Full speed. Audio never leaves the direct peer connection.', S.ok, 18, 202, 440, 30, l1)
cell('WHICH TOOLS', S.cap, 18, 244, 440, 16, l1)
cell('list_supported_regions · rank_airports · compare_airports\nget_airport_profile · get_flight_mix · end_call', S.boxBlue, 18, 264, 440, 40, l1)
cell(rtl('כולם קריאה טהורה ממאגר מקומי. אין שום מחיר בכך שהדפדפן רואה את התוצאה.'), S.he, 18, 316, 440, 56, l1)

const l2 = cell('2 · SIDEBAND   placement: server', S.laneGreen, 545, 200, 480, 400)
cell('WHO ANSWERS', S.cap, 18, 48, 440, 16, l2)
cell('This server, on its own WebSocket to the SAME session.\nrunTool() in-process, against this process credentials.', S.boxGreen, 18, 68, 440, 40, l2)
cell('WHAT THE BROWSER SEES', S.cap, 18, 120, 440, 16, l2)
cell('That the call happened, and the result the model was given.\nIt does not run it, and POST /api/tool refuses it 403.', S.boxGreen, 18, 140, 440, 40, l2)
cell('LATENCY', S.cap, 18, 192, 440, 16, l2)
cell('Full speed — the audio path is untouched.\nAttach measured at 559 ms, the tool at 302 ms.', S.ok, 18, 212, 440, 40, l2)
cell('WHICH TOOLS', S.cap, 18, 264, 440, 16, l2)
cell('get_airport_weather — the one call that leaves the building', S.ok, 18, 284, 440, 28, l2)
cell(rtl('נקודת קצה שהדפדפן קורא לה לשירות חיצוני היא פרוקסי פתוח דרך כתובת השרת שלך. זה הקו.'), S.he, 18, 324, 440, 56, l2)

const l3 = cell('3 · RELAYED   the session itself is here', S.laneGrey, 1050, 200, 500, 400)
cell('WHO ANSWERS', S.cap, 18, 48, 460, 16, l3)
cell('This server, which also holds the model connection.\nNothing crosses to the browser but audio.', S.boxGrey, 18, 68, 460, 40, l3)
cell('WHAT THE BROWSER SEES', S.cap, 18, 120, 460, 16, l3)
cell('Audio. Not the transcript, not the answers, not the calls.', S.boxGrey, 18, 140, 460, 30, l3)
cell('LATENCY', S.cap, 18, 182, 460, 16, l3)
cell('Four to five times the direct line — 1,611 ms against ~340 ms.\nEcho cancellation and jitter buffering are lost.', S.boxGrey, 18, 202, 460, 42, l3)
cell('WHEN IT IS THE ONLY ANSWER', S.cap, 18, 256, 460, 16, l3)
cell('When a result must not reach the client AT ALL. The sideband\nhides who runs a tool, not what it returned.', S.boxGrey, 18, 276, 460, 40, l3)
cell(rtl('זה המחיר האמיתי של סודיות מלאה, ולכן זו לא ברירת המחדל.'), S.he, 18, 328, 460, 46, l3)

cell('ENFORCED IN THREE PLACES — any one alone is theatre', S.cap, 40, 630, 1500, 16)
cell('1.  THE SESSION\nMinted with six tools, so nothing can hand the browser the\nseventh before the sideband has taken responsibility for it.', S.boxGrey, 40, 652, 480, 70)
cell('2.  THE DOOR\nPOST /api/tool returns 403 for placement:"server" — every\ncaller, always. That endpoint IS how a browser would reach it.', S.gate, 550, 652, 490, 70)
cell('3.  THE HANDLER\nThe browser skips a function call for a tool it does not own.\nBoth sides answering puts two outputs under one call_id.', S.boxGrey, 1070, 652, 480, 70)

cell('WHAT MOVES A TOOL', S.cap, 40, 748, 1500, 16)
cell(
  "One line in src/agent/tools.js:   placement: 'server'   — all three enforcement points follow from it, along with what the model is told while the sideband is still attaching.\nWhere a tool runs is deliberately NOT a model decision. It is set before the conversation starts and lives in the tool list rather than the instructions, because anything the model can be persuaded to do can also be injected into it.",
  S.boxGrey, 40, 770, 1510, 56,
)

cell(
  rtl('<b>עדיין פתוח:</b> ל-POST /api/tool אין אימות. הוא מסרב למזג אוויר לכל קורא, אבל את ששת כלי הקריאה הוא מריץ לכל מי שמגיע לפורט, וה-session id שנרשם ביומן נוצר בדפדפן ולכן אינו ראיה. התיקון: טוקן קצר-חיים שנטבע יחד עם המפתח הזמני ומשמש כמזהה הסשן האמיתי.'),
  S.he, 40, 846, 1510, 74,
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
  wrap('hybrid-placement', '10 - Where the hybrid sits', tab10, 1700, 980) +
  '\n'

writeFileSync(FILE, xml.replace('</mxfile>', added + '</mxfile>'))
console.log('written: 2 tabs')
