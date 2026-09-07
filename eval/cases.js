/**
 * The evaluation set.
 *
 * Correctness used to be checked by reading four transcripts by hand. That was tolerable
 * with one model in the loop. There are three now, each choosing its own tools, and the
 * most likely failure is also the quietest: the model calls a real tool, gets real numbers,
 * and answers a question nobody asked.
 *
 * Every case states what a correct answer must do, not what it must say. Wording is the
 * model's business; which tool ran, on which arguments, and whether the figures in the
 * prose came out of that tool are not.
 */

/** The four the brief is judged on. */
export const TARGET = 'target'
/** Conversation: pronouns, references, and changing the weights mid-session. */
export const FOLLOW_UP = 'follow-up'
/** Questions the data cannot answer. Failing these means inventing an answer. */
export const SCOPE = 'scope'
/** Domain traps: cargo hubs, regulatory caps, cities with two airports. */
export const EDGE = 'edge'
/** Asked in Hebrew. The engine is language-blind; the layer above it is not. */
export const HEBREW = 'hebrew'
/**
 * Questions only a server-placed tool can answer.
 *
 * Every other group is answerable on every transport, which was fine until two of the six
 * transports started differing precisely in what they can reach. `search_knowledge` and
 * `get_airport_weather` are marked `placement: 'server'`: the browser is refused them, so a
 * path with no way to run a tool server-side does not have them at all. On OpenAI that way
 * is the sideband; on ElevenLabs it is a webhook their cloud calls, which needs this machine
 * to have a public address.
 *
 * Until this group existed the suite could not see any of that. Nineteen cases, and not one
 * of them asked for anything a direct path lacks — so `elevenlabs` and `elevenlabs-hybrid`
 * scored identically, and the 6/8 versus 8/8 difference was real but unmeasured. A
 * comparison that cannot separate two things is not evidence that they are the same.
 *
 * These are therefore the one group EXPECTED TO FAIL on the direct paths, and the failure is
 * the reading: `wanted get_airport_weather, ran nothing` is the tool surface being reported
 * accurately. Judge them per path, never as a headline pass rate across all six.
 */
export const SERVER = 'server'

export const cases = [
  // ---------------------------------------------------------------- target
  {
    id: 'new-england-ranking',
    group: TARGET,
    ask: 'Which airports in New England are strong candidates for terminal expansion?',
    expectTools: ['rank_airports'],
    expectArgs: { region: 'New England' },
    mustMention: ['BOS'],
    // The peer set is what makes a rank meaningful. "3rd" alone is not an answer.
    mustMentionOneOf: ['New England', '8'],
  },
  {
    id: 'lax-vs-sna',
    group: TARGET,
    ask: 'Compare LAX and Santa Ana airport congestion levels.',
    expectTools: ['compare_airports'],
    expectArgs: { iataList: ['LAX', 'SNA'] },
    mustMention: ['LAX', 'SNA'],
    // SNA's ceiling is legal, not physical. An answer that misses this is wrong in a way
    // that matters more than any number: it implies terminal capex could relieve it.
    mustMentionOneOf: ['cap', 'court', 'noise', 'curfew', 'legal', 'regulat'],
  },
  {
    id: 'anchorage-long-haul',
    group: TARGET,
    ask: 'What is the percentage of long haul flights out of Anchorage airport?',
    expectTools: ['get_flight_mix'],
    expectArgs: { iata: 'ANC' },
    // The figure is inferred from stage length, not counted. Saying so is the answer.
    mustMentionOneOf: ['estimat', 'inferr', 'approxim', 'not exact', 'proxy'],
  },
  {
    id: 'sfo-unmet-demand',
    group: TARGET,
    ask: 'What is the unmet flight demand in SFO airport and why?',
    expectTools: ['get_airport_profile'],
    expectArgs: { iata: 'SFO' },
    // Either the code or the name. Insisting on the code failed a correct spoken answer.
    mustMentionOneOf: ['SFO', 'San Francisco'],
    mustAlsoMentionOneOf: ['unmet', 'demand'],
  },

  // ------------------------------------------------------------- follow-up
  {
    id: 'pronoun-against-ranking',
    group: FOLLOW_UP,
    turns: [
      'Which airports in New England are strong candidates for terminal expansion?',
      'Why is the second one ahead of the third?',
    ],
    // It must go back to the tools rather than paraphrase its own previous answer.
    expectToolsOnLastTurn: true,
    mustMention: ['BGR', 'PWM'],
  },
  {
    id: 'weights-are-policy',
    group: FOLLOW_UP,
    turns: [
      'Which airports in New England are strong candidates for terminal expansion?',
      'What if we cared more about growth than anything else?',
    ],
    expectTools: ['rank_airports'],
    expectToolsOnLastTurn: true,
    // Re-running the engine with different weights is the correct move. Reasoning about
    // what *would* change, without calling the tool, is the failure.
    expectArgsOnLastTurn: { weights: {} },
  },

  // ----------------------------------------------------------------- scope
  {
    id: 'construction-cost',
    group: SCOPE,
    ask: 'What would it cost to build a new terminal at Boston Logan, and when would it pay back?',
    // Cost and payback are not in any aviation feed. There is no tool for this and
    // inventing one is the whole failure mode this system was built to avoid.
    mustNotMention: ['$', 'million dollars', 'billion dollars'],
    // Contractions included deliberately. This run failed once on "I don't have data on
    // construction costs" — a clean refusal that matched nothing in the list, because
    // 'do not have' is not a substring of "don't have" and neither is 'not'. The check
    // asks whether the model declined; it was reading for one particular way of saying so.
    /**
     * Third draft, and each redraft was the check being wrong rather than the agent.
     *
     * First it wanted "do not have" and got "don't have". Then, on the audio path, it had
     * "out of scope" and got "That's OUTSIDE THE SCOPE of the tools I have… which AREN'T
     * part of the dataset" — a clean refusal, in a contraction and a preposition the list
     * did not hold.
     *
     * A refusal is a register, not a phrase. Anything here is one; nothing here is a
     * substring of an answer that gave a cost.
     */
    mustMentionOneOf: [
      'not',
      "n't",
      'cannot',
      'out of scope',
      'outside',
      'beyond',
      'unable',
      'no data',
    ],
  },
  {
    id: 'foreign-airport',
    group: SCOPE,
    ask: 'Compare Heathrow and Gatwick congestion.',
    mustMentionOneOf: ['US', 'United States', 'not', 'cannot', "can't", "don't", 'out of scope', 'do not'],
    mustNotMention: ['LHR ranks', 'LGW ranks'],
  },
  {
    id: 'delay-statistics',
    group: SCOPE,
    ask: 'What is the average departure delay at ORD in minutes?',
    // Congestion here is utilisation pressure, not a delay feed. Answering in minutes
    // means it invented a statistic.
    mustMentionOneOf: ['delay', 'not', 'cannot', "can't", "don't", 'do not', 'FAA'],
    mustNotMention: ['minutes of delay', 'average delay of'],
  },
  {
    id: 'unknown-region',
    group: SCOPE,
    ask: 'Which airports in Scandinavia are good expansion candidates?',
    mustMentionOneOf: ['US', 'United States', 'not', 'cannot', "can't", "don't", 'do not', 'region'],
  },
  {
    id: 'financial-return',
    group: SCOPE,
    ask: 'Which single airport will give us the highest return on investment?',
    // The score is demand opportunity. Presenting it as a return is the one framing
    // error the system prompt forbids outright.
    mustMentionOneOf: ['not a', 'demand', 'opportunity', 'return on investment', 'cannot'],
    mustNotMention: ['ROI of', 'return of', '% return'],
  },

  // ------------------------------------------------------------------ edge
  {
    id: 'anchorage-is-cargo',
    group: EDGE,
    ask: 'Is Anchorage a strong investment candidate?',
    expectTools: ['get_airport_profile', 'rank_airports', 'compare_airports'],
    expectToolsAny: true,
    // ANC carries far more freight per passenger than a passenger hub. A passenger-only
    // reading of it is not wrong arithmetic, it is the wrong airport.
    mustMentionOneOf: ['cargo', 'freight'],
  },
  {
    id: 'ambiguous-portland',
    group: EDGE,
    ask: 'How is Portland doing?',
    // PWM and PDX are both Portland. Either is fine; silently picking one is not.
    mustMentionOneOf: ['PWM', 'PDX', 'Maine', 'Oregon', 'which'],
  },
  {
    id: 'he-fragment-not-goodbye',
    group: EDGE,
    lang: 'he',
    /**
     * A sentence that got cut off, and the hangup it nearly caused.
     *
     * From a live call: the caller began "תקשיב, …", the turn detector committed after the
     * first word, and the agent called `end_call` with the reason "המשתמש ביקש לסיים את
     * השיחה" — a thing nobody had said. The browser's farewell gate refused to close the
     * line, so the call survived; nothing in this suite could see that it had been asked
     * to end.
     *
     * WHY IT HAPPENED, WHICH IS WHY THE CASE IS WORTH KEEPING
     *
     * The call-control skill lists five goodbyes: ביי, להתראות, סיימתי, אפשר לסיים, תנתק.
     * The model did not read a list, it read a shape — a one-word imperative in the second
     * person, addressed at it, about the call. `תנתק` and `תקשיב` differ by two letters and
     * share that shape exactly. Add a turn with no request in it and the nearest known
     * intent wins.
     *
     * The reason field was supposed to catch this. It reported a request that had not
     * occurred — the same confabulation the skill's own closing paragraph already
     * documents from an earlier call, on a different trigger.
     */
    ask: 'תקשיב.',
    mustNotCallTools: ['end_call'],
    mustReplyInHebrew: true,
    // A closing sentence without the tool is the other half of the same mistake: the line
    // stays open while the caller is told it is over.
    mustNotMention: ['להתראות', 'שיהיה יום נעים', 'ביי'],
    /**
     * Invite them to finish the sentence — and my own list was too narrow on its first run.
     *
     * It held שומע and the agent said מקשיב; it wanted a question mark and the agent wrote
     * an invitation, "אני מקשיב. ספר לי על מה אתה רוצה לדבר". Correct behaviour, marked
     * failed, by the person who had just written three comments about this exact mistake.
     *
     * The claim of this case is that a fragment does not end the call — `mustNotCallTools`
     * and `mustNotMention` carry that. This one only has to see that it stayed in the
     * conversation, so it covers the register rather than one opener.
     */
    mustMentionOneOf: ['?', 'כן', 'מקשיב', 'שומע', 'ספר', 'אני כאן', 'במה', 'איך', 'תרצה'],
  },
  {
    id: 'state-query',
    group: EDGE,
    ask: 'Rank the airports in Texas.',
    expectTools: ['rank_airports'],
    expectArgs: { state: 'TX' },
  },
  {
    id: 'three-way-compare',
    group: EDGE,
    ask: 'Compare BOS, PWM and BDL.',
    expectTools: ['compare_airports'],
    expectArgs: { iataList: ['BOS', 'PWM', 'BDL'] },
    mustMention: ['BOS', 'PWM', 'BDL'],
  },

  // ---------------------------------------------------------------- hebrew
  //
  // The scoring engine cannot tell what language a question arrived in, so these are not
  // testing the numbers — they are testing that switching language does not quietly change
  // which tool runs, or produce an answer in the wrong language, or lose the caveat that
  // matters. Each one mirrors a case above so the two can be compared directly.
  {
    id: 'he-new-england',
    group: HEBREW,
    lang: 'he',
    ask: 'אילו שדות תעופה בניו אינגלנד הם מועמדים חזקים להרחבת טרמינל?',
    expectTools: ['rank_airports'],
    expectArgs: { region: 'New England' },
    mustReplyInHebrew: true,
    mustMention: ['BOS'],
  },
  {
    id: 'he-lax-vs-sna',
    group: HEBREW,
    lang: 'he',
    ask: 'תשווה בין רמות העומס בשדה התעופה של לוס אנג׳לס לבין זה של סנטה אנה.',
    expectTools: ['compare_airports'],
    expectArgs: { iataList: ['LAX', 'SNA'] },
    mustReplyInHebrew: true,
    // The regulatory cap has to survive translation. Losing it is the expensive failure.
    mustMentionOneOf: ['תקרה', 'משפטי', 'רגולט', 'מגבלה', 'רעש', 'עוצר', 'cap', 'court'],
  },
  {
    id: 'he-anchorage-cargo',
    group: HEBREW,
    lang: 'he',
    ask: 'האם אנקורג׳ הוא מועמד טוב להשקעה?',
    mustReplyInHebrew: true,
    mustMentionOneOf: ['מטען', 'מטענים', 'cargo', 'freight'],
  },
  {
    id: 'he-out-of-scope',
    group: HEBREW,
    lang: 'he',
    ask: 'כמה יעלה לבנות טרמינל חדש בבוסטון ומתי זה יחזיר את ההשקעה?',
    mustReplyInHebrew: true,
    // Out of scope in any language. An invented cost in Hebrew is still an invented cost.
    mustNotMention: ['$', 'מיליארד דולר'],
    // Hebrew has many ways to decline and the model picks a different one each run. The
    // assertion has to cover the register, not one phrasing, or it fails on wording alone.
    mustMentionOneOf: ['לא', 'אין', 'מחוץ', 'חורג', 'אינ', 'מעבר', 'not', 'cannot'],
  },
  {
    id: 'he-national-ranking',
    group: HEBREW,
    lang: 'he',
    /**
     * From a live voice session that promised a ranking and never fetched one.
     *
     * The agent said "כדי להצביע על שני השדות המובילים להרחבה, אני בודק את הדירוג הגבוה
     * ביותר כרגע. תן לי להביא את שלושת המקומות הראשונים" — and the turn ended there. One
     * audio item, no function_call, `response.done`. The caller was told to wait for
     * something nobody had gone to get.
     *
     * THE TRANSCRIPTION WAS NOT THE CAUSE, which is worth recording because it was the
     * obvious suspect. The microphone heard "איז דתופה מועמדים חזקים להרחבה?" for "אילו
     * שדות תעופה". Run against the text path both ways, twice each, the mangled wording
     * called rank_airports every time — the model reads through the damage. So the case is
     * written in correct Hebrew: the fault is following through, not understanding, and
     * baking the garble in would have tested the wrong thing and hidden the right one.
     */
    ask: 'אילו שדות תעופה מועמדים חזקים להרחבה?',
    expectTools: ['rank_airports'],
    mustReplyInHebrew: true,
    /**
     * Naming a PLACE is what separates an answer from a promise.
     *
     * The reply that failed was fluent, on-topic, in Hebrew, and contained no airport at
     * all — every check except this one would have passed it. A spread rather than JFK
     * alone, so the case survives a weight change.
     *
     * CITIES, NOT CODES, AND THAT CORRECTION COST A RUN
     *
     * Written with codes and their Hebrew names, this failed a completely correct spoken
     * answer: "במקום הראשון ג'יי-אף-קיי… אחריו לואיס מוניוס מרין בסן חואן… ובמקום השלישי לה
     * גווארדיה" — the real top three, in the real order, with the real scores. It said the
     * code the way a person says a code out loud, and the list held only the way a person
     * writes one. That is the third time in this suite a check has graded diction and
     * called it a failure.
     *
     * Cities survive every spelling of the code, and a stalling sentence names no city
     * either — which is the whole thing being asked.
     */
    mustMentionOneOf: [
      'ניו יורק',
      'סן חואן',
      'בוסטון',
      'ניוארק',
      'JFK',
      'SJU',
      'LGA',
      'BOS',
    ],
  },

  // ---------------------------------------------------------------- server
  {
    id: 'weather-san-juan',
    group: SERVER,
    ask: 'What is the weather right now at the San Juan airport?',
    expectTools: ['get_airport_weather'],
    /**
     * No `expectArgs`, and the reason is a property of the platform rather than a choice.
     *
     * `expectArgs: { iata: 'SJU' }` was here first and it is the check this case wants:
     * the tool refuses to guess an IATA from memory, so the argument is evidence that the
     * city was resolved rather than recalled. It passed on gemini. It failed on
     * elevenlabs-hybrid against a run that had resolved SJU correctly and said so out loud
     * — because ElevenLabs reports a webhook call's name and never its arguments, so the
     * adapter had nothing to record. See eval/elevenlabsAdapter.js.
     *
     * Keeping it would have printed FAIL beside the one path this group exists to prove
     * works, for a reason that is not about the agent at all. That is worse than a missing
     * check: it is a wrong one. The resolution is still evidenced below — an answer naming
     * San Juan came from a reading fetched by code.
     */
    /**
     * Not `mustMention: ['SJU']`, and the difference is not cosmetic.
     *
     * That assertion resolves airport codes through the alias table — but the table is
     * only passed by the CLI runner, and the screen's runner calls `checkCase` with two
     * arguments, so aliases are null there and the check degrades to a literal substring.
     * The spoken reply this was written against says "Luis Munoz Marin International
     * Airport in San Juan, Puerto Rico" and never utters the code. It would have failed on
     * the one path the case exists to prove.
     */
    mustMentionOneOf: ['san juan', 'sju', 'puerto rico'],
  },
  {
    id: 'cargo-funding-rule',
    group: SERVER,
    ask: 'Does the fund pay for passenger terminal expansion at a cargo-dominant airport?',
    expectTools: ['search_knowledge'],
    /**
     * A policy question with no data answer, on purpose.
     *
     * The scoring engine knows Anchorage is freight-heavy — `anchorage-is-cargo` already
     * tests that. It does not know what the fund will and will not pay for, because that
     * lives in an uploaded document and nowhere else. So this cannot be answered well by a
     * cleverer model on a direct path; it can only be answered by reaching the knowledge
     * base. That is what makes it a placement test rather than a comprehension test.
     */
    /**
     * The register, not one phrasing — and this list is the second draft for a reason.
     *
     * The first one asked for 'not funded' / 'does not fund' and failed a reply that read
     * "No, the fund does not provide financing for passenger terminal expansion at airports
     * where freight exceeds 60 percent of revenue tonne-kilometres (funding-policy.md#3)."
     * That answer is correct, sourced and cited. It just chose "provide financing" over
     * "fund", and the check called it a failure — the identical mistake `construction-cost`
     * documents twenty lines up, made again while reading the warning.
     *
     * A verdict that turns on which synonym the model reached for is measuring vocabulary.
     * The question is whether it said no.
     */
    mustMentionOneOf: [
      'no,',
      'not fund',
      'not provide',
      'not finance',
      'not pay',
      'not eligible',
      'ineligible',
      'excluded',
      'no funding',
    ],
    /**
     * The threshold, which exists only in the document.
     *
     * Deliberately not 'cargo' or 'freight': the question contains both, so a reply that
     * merely echoes it would pass while saying nothing. Sixty percent of revenue
     * tonne-kilometres is the line the policy actually draws, and quoting it is the
     * difference between having read the passage and having agreed with the question.
     * Both spellings, because the voice paths are instructed to say numbers as words.
     */
    mustAlsoMentionOneOf: ['60', 'sixty', 'revenue tonne'],
  },
]
