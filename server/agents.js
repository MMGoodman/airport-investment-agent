/**
 * The agents this environment holds.
 *
 * Until now there was no such concept. The prompt, the tools and the data were module-level
 * singletons, so "the agent" was whatever those files happened to contain — which is fine
 * for one and impossible for two. This is the record that makes an agent a thing you can
 * list, open, and eventually add a second of.
 *
 * WHAT IS HONEST ABOUT THIS AND WHAT IS NOT
 *
 * The record is real: id, name, what it is for, which model paths it can run on, and what
 * it is made of. The UI can list agents, open one, and show its configuration from this
 * alone.
 *
 * What is NOT yet true is that a second entry here would work. prompt.js, tools.js and the
 * store are still imported directly by voice.js and agent.js, so adding a row would give
 * you a second card pointing at the same brain. Making them per-agent is the next real
 * piece of work, and it is a refactor of the runtime rather than an addition to this file.
 * Saying so here is cheaper than discovering it by adding a row.
 */

/**
 * One agent, described by what it is rather than by which files it lives in.
 *
 * `capabilities` is what the console can offer to configure. A future agent without a
 * vocabulary bias, or without a scoring engine behind it, simply omits those and the
 * sidebar shows fewer sections rather than empty ones.
 */
import { toolSchemas } from '../src/agent/tools.js'
import { cases as evalCases } from '../eval/cases.js'
import { allAgents, getAgent } from './agentStore.js'

export const AGENTS = [
  {
    id: 'airport-investment',
    name: 'Airport Investment Agent',
    tagline: 'US terminal expansion — demand opportunity analysis',
    description:
      'An aviation investment analyst. It computes nothing itself: every figure it states comes from a deterministic scoring engine over BTS T-100 data, reached through tools.',
    /** Which of the switcher entries this agent is built to run on. */
    transports: ['gemini', 'openai', 'openai-hybrid', 'openai-relay', 'elevenlabs', 'elevenlabs-hybrid'],
    defaultTransport: 'openai-hybrid',
    languages: ['he', 'en'],
    capabilities: {
      prompt: true,
      tools: true,
      knowledge: true,
      vocabulary: true,
      evals: true,
    },
    /**
     * The one-line facts a card shows without loading the whole workbench.
     *
     * Counted, not typed. These were literals and both had gone stale: the card said seven
     * tools while the agent carried eight, and the description said "seven tools" in prose
     * where no reader would think to check it. A number that describes the code belongs to
     * the code.
     *
     * airports stays a literal because reading it means loading the store, which is the
     * one thing a card is supposed to avoid — `npm run verify` asserts it instead.
     */
    summary: {
      tools: toolSchemas.length,
      airports: 158,
      evalCases: evalCases.length,
    },
    /**
     * The empty conversation, as data rather than as a constant in App.jsx.
     *
     * It was three literals in the chat component — a heading about US airport expansion, a
     * paragraph about BTS T-100, and four sample questions — which meant every agent opened
     * as this one. A travel-insurance agent created five minutes earlier greeted its first
     * caller by offering to compare LAX and SNA congestion.
     *
     * The text is unchanged, only moved. An empty screen is the first thing anyone sees of
     * an agent, so it belongs to the agent.
     */
    welcome: {
      title: 'Ask about US airport expansion candidates',
      blurb:
        'Every figure comes from a deterministic scoring engine over BTS T-100 data — open the tool trace under any answer to see exactly which call produced it. Follow-up questions work; try “why is the second one ahead of the third?”.',
      questions: [
        'Which airports in New England are strong candidates for terminal expansion?',
        'Compare LAX and SNA congestion levels.',
        'What is the percentage of long-haul flights out of Anchorage (ANC)?',
        'What is the unmet flight demand at SFO, and why?',
      ],
    },
  },
]

export const findAgent = (id) => AGENTS.find((a) => a.id === id) ?? null

export function mountAgentRoutes(app) {
  /**
   * Built-in and created together, from agentStore.
   *
   * The note that used to sit here said a second agent needed a runtime refactor before a
   * row would mean anything. That is what agentStore.js is — so the list now comes from
   * there, and this file keeps only the definition of the one agent that is code rather
   * than data.
   */
  app.get('/api/agents', (_req, res) =>
    res.json({
      agents: allAgents(),
      note: 'סוכן שנוצר כאן מקבל זהות, פייפליין, פרומפט, סקילים ובחירת כלים משלו. הכלים עצמם משותפים — הם מגיעים למנוע הניקוד.',
    }),
  )

  app.get('/api/agents/:id', (req, res) => {
    const agent = getAgent(req.params.id)
    if (!agent) return res.status(404).json({ error: `no agent called ${req.params.id}` })
    res.json(agent)
  })
}
