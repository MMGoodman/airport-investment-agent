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
    mustMentionOneOf: ['not', 'cannot', "can't", 'out of scope', 'do not have', 'unable'],
  },
  {
    id: 'foreign-airport',
    group: SCOPE,
    ask: 'Compare Heathrow and Gatwick congestion.',
    mustMentionOneOf: ['US', 'United States', 'not', 'cannot', 'out of scope', 'do not'],
    mustNotMention: ['LHR ranks', 'LGW ranks'],
  },
  {
    id: 'delay-statistics',
    group: SCOPE,
    ask: 'What is the average departure delay at ORD in minutes?',
    // Congestion here is utilisation pressure, not a delay feed. Answering in minutes
    // means it invented a statistic.
    mustMentionOneOf: ['delay', 'not', 'cannot', 'do not', 'FAA'],
    mustNotMention: ['minutes of delay', 'average delay of'],
  },
  {
    id: 'unknown-region',
    group: SCOPE,
    ask: 'Which airports in Scandinavia are good expansion candidates?',
    mustMentionOneOf: ['US', 'United States', 'not', 'cannot', 'do not', 'region'],
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
]
