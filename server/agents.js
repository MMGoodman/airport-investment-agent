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
  },
]

export const findAgent = (id) => AGENTS.find((a) => a.id === id) ?? null

export function mountAgentRoutes(app) {
  app.get('/api/agents', (_req, res) =>
    res.json({
      agents: AGENTS,
      note: 'One agent today. A second needs prompt.js, tools.js and the store to become per-agent rather than module-level — a runtime refactor, not a row here.',
    }),
  )

  app.get('/api/agents/:id', (req, res) => {
    const agent = findAgent(req.params.id)
    if (!agent) return res.status(404).json({ error: `no agent called ${req.params.id}` })
    res.json(agent)
  })
}
