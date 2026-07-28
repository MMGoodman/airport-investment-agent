/**
 * Voice input and output via the browser's Web Speech API.
 *
 * Deliberately client-side. No audio reaches our server or the model, there is nothing
 * extra to bill, and no new dependency. Chrome and Edge ship both halves; Firefox ships
 * neither, so each hook reports whether it is supported and the UI disables the control
 * rather than offering a button that silently does nothing.
 */
import { useCallback, useEffect, useRef, useState } from 'react'

const Recognition =
  typeof window === 'undefined'
    ? undefined
    : (window.SpeechRecognition ?? window.webkitSpeechRecognition)

export const dictationSupported = Boolean(Recognition)
export const speechSupported = typeof window !== 'undefined' && 'speechSynthesis' in window

const ERRORS = {
  'not-allowed': 'Microphone access was blocked. Allow it in the browser address bar.',
  'service-not-allowed': 'Microphone access was blocked by browser policy.',
  'audio-capture': 'No microphone was found.',
  network: 'Speech recognition needs a network connection.',
  'no-speech': 'Nothing was picked up — try again a little closer to the mic.',
}

/**
 * Dictation. `onTranscript` fires on every interim result with everything heard so far,
 * so the caller can show the words landing live rather than after the pause.
 */
export function useDictation({ onTranscript }) {
  const [listening, setListening] = useState(false)
  const [error, setError] = useState(null)
  const recognitionRef = useRef(null)
  const callbackRef = useRef(onTranscript)

  useEffect(() => {
    callbackRef.current = onTranscript
  })

  const stop = useCallback(() => {
    recognitionRef.current?.stop()
  }, [])

  const start = useCallback(() => {
    if (!dictationSupported || recognitionRef.current) return
    setError(null)

    const recognition = new Recognition()
    recognition.lang = 'en-US'
    recognition.interimResults = true
    recognition.continuous = false // one question per press; ends on a natural pause

    let settled = ''

    recognition.onresult = (event) => {
      let interim = ''
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const result = event.results[i]
        if (result.isFinal) settled += result[0].transcript
        else interim += result[0].transcript
      }
      callbackRef.current?.(`${settled}${interim}`.trim())
    }

    // 'aborted' is what a manual stop reports — not worth showing to anyone.
    recognition.onerror = (event) => {
      if (event.error !== 'aborted') {
        setError(ERRORS[event.error] ?? `Speech recognition failed: ${event.error}`)
      }
    }

    recognition.onend = () => {
      recognitionRef.current = null
      setListening(false)
    }

    recognitionRef.current = recognition
    recognition.start()
    setListening(true)
  }, [])

  useEffect(() => () => recognitionRef.current?.abort(), [])

  return { listening, error, start, stop, supported: dictationSupported }
}

/**
 * Chrome cuts an utterance off after roughly fifteen seconds, which lands mid-sentence
 * on a full answer. Queueing several short utterances instead of one long one keeps the
 * synthesiser alive to the end. Splitting on sentence boundaries keeps the prosody.
 */
function intoChunks(text, limit = 180) {
  const sentences = text.replace(/\s+/g, ' ').match(/[^.!?]+[.!?]*\s*/g) ?? [text]
  const chunks = []
  let current = ''
  for (const sentence of sentences) {
    if (current && current.length + sentence.length > limit) {
      chunks.push(current.trim())
      current = ''
    }
    current += sentence
  }
  if (current.trim()) chunks.push(current.trim())
  return chunks
}

/** Reads answers aloud. Off by default — nobody wants a page that starts talking. */
export function useSpeech() {
  const [speaking, setSpeaking] = useState(false)

  const cancel = useCallback(() => {
    if (!speechSupported) return
    window.speechSynthesis.cancel()
    setSpeaking(false)
  }, [])

  const speak = useCallback((text) => {
    if (!speechSupported || !text?.trim()) return
    window.speechSynthesis.cancel()

    const chunks = intoChunks(text)
    chunks.forEach((chunk, i) => {
      const utterance = new SpeechSynthesisUtterance(chunk)
      utterance.lang = 'en-US'
      utterance.rate = 1.05
      if (i === chunks.length - 1) {
        utterance.onend = () => setSpeaking(false)
        utterance.onerror = () => setSpeaking(false)
      }
      window.speechSynthesis.speak(utterance)
    })
    setSpeaking(true)
  }, [])

  useEffect(() => () => speechSupported && window.speechSynthesis.cancel(), [])

  return { speaking, speak, cancel, supported: speechSupported }
}
