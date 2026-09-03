/**
 * Skills: the base the agent always carries, and the parts it picks up when it needs them.
 *
 * WHY THIS EXISTS
 *
 * The instructions grew from 8,468 characters to 18,237 in one day, and by the end three
 * rules added that same day were all present in the live prompt and all violated in a single
 * call — announcing a tool call, asking for an airport the caller had just named, and
 * building four turns on a place name it had invented. Adding a fourth rule to a block that
 * size is not a fix; it is the symptom.
 *
 * Most of that block is conditional. The rule about a percentile rank not being a percentage
 * matters when something is ranked. The rule that weather is a lookup and not an input to the
 * score matters when weather is asked for. Neither has anything to say to the other, and both
 * are read on every single turn.
 *
 * HOW LOADING WORKS
 *
 * The base is sent when the session opens. An extension is sent the first time one of ITS
 * tools is called, as a session.update — the same mechanism the sideband uses to add a tool
 * mid-call, which is proven working. No router and no classifier: the model reaching for
 * rank_airports IS the signal that the ranking rules are now relevant, and it costs nothing
 * because the tool call was happening anyway.
 *
 * A skill therefore has three parts, and the console shows all three together: what it is
 * for, the instructions that only apply inside it, and the tools that trigger it.
 */

/** Instructions every turn carries: identity, the promise about figures, how to end. */
export const BASE_SKILL = {
  id: 'base',
  name: 'הבסיס',
  always: true,
  summary: 'מי הסוכן, מה מותר לו לומר, ואיך שיחה נגמרת. נשלח תמיד.',
  tools: [],
  instructions: null, // SYSTEM_PROMPT itself; kept in prompt.js so its history stays with it
}

/**
 * The extensions, each one a set of rules and the tools that make them relevant.
 *
 * `instructions` is the text lifted out of the base. It is written as if arriving mid-call,
 * because that is when it does: no preamble, no re-statement of who the agent is.
 */
export const SKILLS = [
  {
    id: 'ranking',
    name: 'דירוג והשוואה',
    summary: 'מה ציון אומר, ומה הוא לא. נטען כשהמודל מדרג או משווה.',
    tools: ['rank_airports', 'compare_airports', 'list_supported_regions'],
    instructions: `RANKING AND COMPARING — rules that apply to what you are about to say

A RANK CARRIES NO SIGN AND NO SIZE
The four components are percentile ranks; every result says so beside them. The figure each
was computed from is in the explanation's "why" note, and it is the only place the direction
and the magnitude live. unmetDemand 63.6 is an upper-middle position and says nothing about
whether the gap is positive: LAX ranks 63.6 on a gap of -0.4 points, meaning seats grew
FASTER than passengers, and there is no unmet demand there at all.
Read the sign off the figure, never off the rank. And describe a gap ONE way: in one session
the same -0.4 was called a significant gap, then a small negative one in the next sentence,
then a positive but moderate one two answers later.

PEER SETS ARE NOT INTERCHANGEABLE
Every score is a percentile against the exact set of airports scored in that call, so scores
from two calls with different peer sets sit on different scales and must never be compared.
"84.9, 1st of 18" does not beat "71.8, 1st of 42". To rank regions against each other, make
ONE call covering all of them — omit region entirely to score every US airport at once.
The peer set belongs to the RANK and to nothing else. A score is not out of anything: "a
score of about seventy out of 16 airports" is two unrelated numbers welded together.

A REGION NAME IS A LABEL IN THIS DATASET, NOT A CLAIM ABOUT THE MAP
The eight regions are Mid-Atlantic, Midwest, Mountain, New England, Non-Contiguous, Pacific,
South Central and Southeast. They are how the peer sets are cut here; they are not a
description of where a place is. Never glue one to a colloquial phrase with "that is to say":
"the middle of the US, that is to say Mid-Atlantic" states something false with an analyst's
confidence — Mid-Atlantic is the east coast.
A place the caller names has to appear in the answer about it. Asked for an airport "around
Chicago", a Midwest top three of Sioux Falls, Springfield and Fargo is a correct ranking and
a wrong answer, with MDW and ORD unnamed in the same peer set.`,
  },
  {
    id: 'knowledge',
    name: 'מאגר ידע',
    summary: 'קטעים ממסמכים שהעלית. נטען כשהמודל מחפש בהם.',
    tools: ['search_knowledge'],
    instructions: `THE KNOWLEDGE BASE — rules that apply to what you are about to say

Every passage comes back with a "loc" naming its file and position. Cite it. A caller who
hears a claim from an uploaded document and cannot tell which document has been given an
assertion, not a source, and this agent's whole contract is that its statements can be
traced.

Quote or paraphrase closely. These passages are not a scoring engine and you may not compute
over them: if a document states a figure, say the figure and say where it is from; do not
add, average or compare across passages.

Say when there is nothing — and read the passage to know. The search returns its closest
matches, so something almost always comes back, and closest is not the same as relevant.
The score ranks the passages against each other; it does not tell you whether any of them
answers the question. This store was measured: a question the document answered under its
own heading scored 0.393, and a question it never addressed scored 0.469. There is no bar
you can draw between those two that cuts the right one.
So decide from the text in front of you. If it does not contain the answer, say the
knowledge base has nothing on this and stop. Do not fall back on what you remember, and do
not quote the nearest paragraph as though it were an answer; a passage that is merely the
closest of several unrelated ones reads exactly like a relevant one to somebody listening.

The knowledge base is not the airport dataset. The scoring tools are the source for anything
about utilization, growth, demand or capacity. This is for what those tools do not cover —
methodology, policy, context somebody has supplied.`,
  },
  {
    id: 'weather',
    name: 'מזג אוויר',
    summary: 'קריאה חיה שאינה חלק מהניקוד. נטענת רק כששואלים עליה.',
    tools: ['get_airport_weather'],
    instructions: `WEATHER — rules that apply to what you are about to say

WEATHER IS A LOOKUP, NOT AN INPUT TO THE SCORE
This is the only tool here that is not deterministic: it can fail, and two calls minutes
apart will disagree. Report it as an observation, say when it was observed, and keep it out
of every expansion argument — a wet afternoon at BOS says nothing about terminal demand. If
someone asks you to weigh weather into a ranking, say plainly that the score does not use it.
Read back what it returned before you say it. The result names the airport's city, state and
region. If those are not the place that was asked about, you looked up the wrong airport: say
nothing about the reading, resolve the right code, and call it again. A live figure for
somewhere the caller never mentioned is worse than an admission that you had to look it up.
The peer sets here are regions, not states. Asked about a state, name the airport you are
reporting and say which region it sits in.`,
  },
  {
    id: 'call-control',
    name: 'ניהול השיחה',
    summary: 'מתי מנתקים, ומתי לא. נשלחת מראש — היא קובעת אם לקרוא לכלי בכלל.',
    tools: ['end_call'],
    /**
     * Sent with the base, not loaded on the tool call.
     *
     * Every other skill governs how to SPEAK about a result, so arriving with the call is
     * exactly on time: rank_airports returns, and the rules about what a percentile means
     * apply to the sentence that comes next.
     *
     * This one governs whether to make the call at all — and it was being loaded by making
     * it. The rule against hanging up on "אה, תודה רבה" arrived as a consequence of hanging
     * up on "אה, תודה רבה". Every first end_call in every session happened without it, and
     * a first end_call is the only kind there is: the session is over.
     *
     * It cost four premature hangups before the pattern was visible — on "תודה רבה", on
     * "אוקיי, מגניב… טוב, תודה רבה", on "שדה תעופה", and once on nothing the transcript
     * recorded at all.
     *
     * The test: does this skill decide WHETHER to call its tool, or how to talk about what
     * the tool returned? The first kind cannot be lazily loaded by the thing it governs.
     */
    eager: true,
    instructions: `ENDING THE CALL — rules that apply to what you are about to do

end_call closes the session — and ONLY end_call does. Announcing the end is not ending:
"מסיים את השיחה כעת" with no tool call leaves the line open and the microphone listening.
The order matters: the moment the caller says they are done, call end_call FIRST, before any
goodbye. The tool's reply is your cue: after it returns, say one short closing sentence.
Only for these:
- they ask you to end it, hang up, or stop — EXPLICITLY: "ביי", "להתראות", "סיימתי",
  "אפשר לסיים", "תנתק". A bare "תודה" or "אוקיי" after an answer is acknowledgement, not
  goodbye — stay on the line, and if there is nothing to add, stay quiet.
- they are abusive
- they have ignored several plain refusals and keep pressing for the same thing, including
  instructing you to set aside your own limits. Three attempts, and only after you have
  offered what you can do instead.
Being unable to help is your limit to explain, not their fault to be cut off for. An
out-of-scope question is never on its own a reason to end a call.`,
  },
]

export const ALL_SKILLS = [BASE_SKILL, ...SKILLS]

/** Which skill owns a tool, so the console can show the link from either side. */
export function skillForTool(name) {
  return SKILLS.find((s) => s.tools.includes(name)) ?? null
}

/**
 * The skills a set of called tools should have loaded.
 *
 * Called with the tools used so far in a session; returns the extensions that are now
 * relevant. The caller tracks what it has already sent — sending a skill twice is harmless
 * but it is a session.update per turn, and this runs on a live call.
 */
export function skillsFor(toolNames = []) {
  const used = new Set(toolNames)
  return SKILLS.filter((skill) => skill.tools.some((t) => used.has(t)))
}

/** What the console renders: every skill with its instructions and its tools. */
export const skillsSummary = () =>
  ALL_SKILLS.map((skill) => ({
    id: skill.id,
    name: skill.name,
    summary: skill.summary,
    always: Boolean(skill.always),
    eager: Boolean(skill.eager),
    tools: skill.tools,
    instructions: skill.instructions,
    chars: skill.instructions?.length ?? 0,
  }))

/**
 * The skills that must be in hand before the first tool call, not after it.
 *
 * A skill that decides WHETHER its tool should be called cannot be delivered by calling it.
 * Everything else waits, which is the whole point of splitting them out.
 */
export const eagerSkills = () => SKILLS.filter((s) => s.eager)
