import './ComparisonSheet.css'

/**
 * The four questions to ask on every path, kept on screen while you ask them.
 *
 * WHY IT IS NOT IN THE WELCOME SCREEN
 *
 * The suggestion chips vanish the moment a conversation starts, which is exactly when a
 * comparison run begins. On a voice path there is nothing to click and nothing to read from:
 * you are speaking, the pane fills with the transcript, and the questions you were going to
 * ask are three scrolls up in another window. So this sits above the composer and stays.
 *
 * WHY THESE FOUR
 *
 * A comparison where each path gets different questions measures the questions. These are
 * chosen so that each one isolates a different axis the paths actually differ on — and the
 * third is the only one that produces a different ANSWER rather than a different time, which
 * is what makes it the one to run first when there is no time for the rest.
 */
const QUESTIONS = [
  {
    ask: 'אילו שדות תעופה מועמדים חזקים להרחבה?',
    isolates: 'כלי אחד זול — קו הבסיס',
  },
  {
    ask: 'תשווה בין פורטלנד, אלבקרקי וגרינוויל על ניצולת, צמיחה וביקוש',
    isolates: 'מטען 7.2 KB — הגורם הבודד הגדול ביותר',
  },
  {
    ask: 'מה מזג האוויר בבוסטון לוגן?',
    isolates: 'כלי מושם — כאן הישיר מסרב וההיברידי עונה',
  },
  {
    ask: 'ספר לי על בנגור',
    isolates: 'מלכודת תמלול — "בנגור" יצא "בורגר" בקסקייד',
  },
]

/**
 * @param live   a voice path, so the questions are read aloud rather than clicked
 * @param onPick fills the composer, on the paths that have one
 */
export default function ComparisonSheet({ live, onPick }) {
  return (
    <details className="cs" open={live}>
      <summary>
        <span className="cs-title">השוואת נתיבים</span>
        <span className="cs-note">
          {live ? 'הקרא אותן כלשונן' : 'לחץ כדי למלא'} · פעמיים כל אחת
        </span>
      </summary>

      <p className="cs-why">
        אותן שאלות, באותו סדר, בכל נתיב. אחרת מדדת את השאלות ולא את הנתיבים.
      </p>

      <ol className="cs-list">
        {QUESTIONS.map((q, at) => (
          <li key={q.ask}>
            {/* On a voice path this is a line to read, not a control — but it stays a button
                so the same markup serves both, and a stray click on the text path is useful
                rather than inert. */}
            <button type="button" onClick={() => onPick?.(q.ask)} disabled={live}>
              <span className="cs-n mono">{at + 1}</span>
              <span className="cs-ask">{q.ask}</span>
              <span className="cs-isolates">{q.isolates}</span>
            </button>
          </li>
        ))}
      </ol>
    </details>
  )
}
