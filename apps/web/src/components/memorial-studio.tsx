'use client';

import { useEffect, useRef, useState } from 'react';
import type { MemorialProfile, MemorialReply, MemorialStatus } from '@everecho/contracts';
import { api, API_URL, csrfToken } from '@/lib/api';

interface Recognition {
  lang: string;
  interimResults: boolean;
  continuous: boolean;
  onresult:
    ((event: { results: { isFinal: boolean; 0: { transcript: string } }[] }) => void) | null;
  onerror: ((event: { error: string }) => void) | null;
  onend: (() => void) | null;
  start(): void;
  abort(): void;
}
type SpeechWindow = Window & {
  SpeechRecognition?: new () => Recognition;
  webkitSpeechRecognition?: new () => Recognition;
};
type Message = {
  role: 'user' | 'assistant';
  content: string;
  mode?: MemorialReply['mode'];
  audio?: string | null;
};
const blankProfile: MemorialProfile = {
  name: '',
  relationship: '',
  language: 'en',
  personality: '',
  memories: '',
  phrases: '',
  tone: 'warm',
};

async function encodeFile(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).split(',')[1] ?? '');
    reader.onerror = () => reject(new Error('The audio file could not be read.'));
    reader.readAsDataURL(file);
  });
}

export function MemorialStudio() {
  const [profile, setProfile] = useState<MemorialProfile>(blankProfile);
  const [status, setStatus] = useState<MemorialStatus | null>(null);
  const [acknowledged, setAcknowledged] = useState(false);
  const [allowCloud, setAllowCloud] = useState(false);
  const [allowMicrophone, setAllowMicrophone] = useState(false);
  const [voiceConsent, setVoiceConsent] = useState(false);
  const [sample, setSample] = useState<File | null>(null);
  const [voiceToken, setVoiceToken] = useState<string | null>(null);
  const [voiceNote, setVoiceNote] = useState('No recreated voice connected');
  const [voiceBusy, setVoiceBusy] = useState(false);
  const [messages, setMessages] = useState<Message[]>([]);
  const [draft, setDraft] = useState('');
  const [phase, setPhase] = useState('Ready when you are');
  const [error, setError] = useState('');
  const [active, setActive] = useState(false);
  const [busy, setBusy] = useState(false);
  const [speechSupported, setSpeechSupported] = useState(false);
  const audio = useRef<HTMLAudioElement | null>(null);
  const recognition = useRef<Recognition | null>(null);
  const alive = useRef(true);
  const listeningSession = useRef(false);
  const request = useRef<AbortController | null>(null);
  const sequence = useRef(0);
  const inFlight = useRef(false);
  const restartTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const history = useRef<Message[]>([]);
  const sendRef = useRef<(text: string) => Promise<void>>(async () => {});
  const endOfMessages = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    alive.current = true;
    const speechWindow = window as SpeechWindow;
    setSpeechSupported(
      Boolean(speechWindow.SpeechRecognition ?? speechWindow.webkitSpeechRecognition),
    );
    void api
      .get<MemorialStatus>('/v1/memorial/status')
      .then((result) => {
        if (alive.current) setStatus(result);
      })
      .catch(() => {
        if (alive.current)
          setError('Could not reach the API. Check that the local server is running.');
      });
    return () => {
      alive.current = false;
      listeningSession.current = false;
      sequence.current += 1;
      request.current?.abort();
      recognition.current?.abort();
      audio.current?.pause();
      window.speechSynthesis?.cancel();
      if (restartTimer.current) clearTimeout(restartTimer.current);
    };
  }, []);

  useEffect(() => {
    endOfMessages.current?.scrollIntoView({ block: 'nearest' });
  }, [messages]);

  function stop() {
    sequence.current += 1;
    listeningSession.current = false;
    inFlight.current = false;
    request.current?.abort();
    recognition.current?.abort();
    recognition.current = null;
    audio.current?.pause();
    window.speechSynthesis?.cancel();
    if (restartTimer.current) clearTimeout(restartTimer.current);
    setActive(false);
    setBusy(false);
    setPhase('Session ended');
  }

  function resumeListening() {
    if (!alive.current || !listeningSession.current) return;
    const speechWindow = window as SpeechWindow;
    const Constructor = speechWindow.SpeechRecognition ?? speechWindow.webkitSpeechRecognition;
    if (!Constructor) {
      stop();
      setError('This browser does not support voice input. You can still type.');
      return;
    }
    const rec = new Constructor();
    recognition.current = rec;
    rec.lang = profile.language === 'hi' ? 'hi-IN' : 'en-IN';
    rec.continuous = false;
    rec.interimResults = false;
    let received = false;
    rec.onresult = (event) => {
      const text = event.results[0]?.[0]?.transcript?.trim();
      if (text && listeningSession.current) {
        received = true;
        void sendRef.current(text);
      }
    };
    rec.onerror = (event) => {
      if (event.error === 'aborted' || event.error === 'no-speech') return;
      stop();
      setError(
        event.error === 'not-allowed'
          ? 'Microphone permission was not granted. Type a message or allow it in your browser.'
          : 'Voice recognition could not connect. You can continue by typing.',
      );
    };
    rec.onend = () => {
      if (!received && listeningSession.current && !inFlight.current)
        restartTimer.current = setTimeout(resumeListening, 600);
    };
    try {
      rec.start();
      setPhase('Listening to you');
    } catch {
      stop();
      setError('The microphone could not start. Please try again.');
    }
  }

  function speak(reply: MemorialReply, turn: number) {
    const done = () => {
      if (!alive.current || sequence.current !== turn) return;
      setPhase('Ready when you are');
      if (listeningSession.current) restartTimer.current = setTimeout(resumeListening, 450);
    };
    if (!listeningSession.current) {
      done();
      return;
    }
    setPhase(reply.audio ? 'Speaking · recreated AI voice' : 'Speaking · device voice');
    if (reply.audio) {
      const player = new Audio(`data:audio/mpeg;base64,${reply.audio}`);
      audio.current = player;
      player.onended = done;
      player.onerror = () => {
        setError('Audio could not play. The reply is available below.');
        done();
      };
      void player.play().catch(() => {
        setError('Your browser blocked audio playback. Read the reply below.');
        done();
      });
    } else if ('speechSynthesis' in window) {
      const utterance = new SpeechSynthesisUtterance(reply.text);
      utterance.lang = profile.language === 'hi' ? 'hi-IN' : 'en-IN';
      utterance.rate =
        profile.tone === 'reflective' ? 0.85 : profile.tone === 'cheerful' ? 1.05 : 0.94;
      utterance.onend = done;
      utterance.onerror = done;
      window.speechSynthesis.speak(utterance);
    } else {
      setError('Speech playback is not supported here. Read the reply below.');
      done();
    }
  }

  async function send(text: string) {
    if (!text.trim() || inFlight.current) return;
    if (!profile.name.trim() || !profile.memories.trim() || !acknowledged) {
      setError('Add a name and at least one memory, then acknowledge the simulation disclosure.');
      return;
    }
    const turn = ++sequence.current;
    if (restartTimer.current) clearTimeout(restartTimer.current);
    inFlight.current = true;
    setBusy(true);
    setError('');
    setPhase('Preparing a reply');
    recognition.current?.abort();
    audio.current?.pause();
    window.speechSynthesis?.cancel();
    const before = history.current.slice(-12).map(({ role, content }) => ({ role, content }));
    const current: Message = { role: 'user', content: text.trim() };
    history.current = [...history.current, current];
    setMessages([...history.current]);
    setDraft('');
    const controller = new AbortController();
    request.current = controller;
    const timeout = setTimeout(() => controller.abort(), 80_000);
    try {
      const response = await fetch(`${API_URL}/v1/memorial/respond`, {
        method: 'POST',
        credentials: 'include',
        signal: controller.signal,
        headers: { 'content-type': 'application/json', 'x-csrf-token': csrfToken() ?? '' },
        body: JSON.stringify({
          profile,
          message: text.trim(),
          history: before,
          acknowledged,
          allowCloud,
          voiceToken,
        }),
      });
      const body = (await response.json()) as MemorialReply & { error?: { message?: string } };
      if (!response.ok)
        throw new Error(body.error?.message ?? 'The conversation could not continue.');
      if (!alive.current || sequence.current !== turn) return;
      history.current = [
        ...history.current,
        { role: 'assistant', content: body.text, mode: body.mode, audio: body.audio },
      ];
      setMessages([...history.current]);
      inFlight.current = false;
      setBusy(false);
      if (body.voiceError) setError(body.voiceError);
      speak(body, turn);
    } catch (caught) {
      if (!alive.current || sequence.current !== turn) return;
      stop();
      setError(
        caught instanceof Error && caught.name !== 'AbortError'
          ? caught.message
          : 'The reply timed out. Please try again.',
      );
    } finally {
      clearTimeout(timeout);
    }
  }
  sendRef.current = send;

  async function connectVoice() {
    if (!sample || !voiceConsent || !profile.name.trim()) return;
    setVoiceBusy(true);
    setError('');
    try {
      if (sample.size > 1_048_576) throw new Error('Please use an audio sample under 1 MB.');
      const mime = sample.type === 'audio/x-m4a' ? 'audio/mp4' : sample.type;
      const result = await api.post<{
        voiceToken: string | null;
        voiceId: string;
        requiresVerification: boolean;
      }>('/v1/memorial/voice', {
        name: profile.name,
        mime,
        audio: await encodeFile(sample),
        authorized: voiceConsent,
        allowCloud: voiceConsent,
      });
      if (!alive.current) return;
      setVoiceToken(result.voiceToken);
      setVoiceNote(
        result.requiresVerification
          ? `Provider verification required for voice ${result.voiceId}. Finish verification in ElevenLabs; the voice is not enabled here.`
          : `Recreated AI voice connected for this session · ${result.voiceId}`,
      );
    } catch (caught) {
      if (alive.current) setError(caught instanceof Error ? caught.message : 'Voice setup failed.');
    } finally {
      if (alive.current) setVoiceBusy(false);
    }
  }

  const ready = Boolean(
    status?.available &&
    profile.name.trim() &&
    profile.memories.trim() &&
    acknowledged &&
    !voiceBusy,
  );
  const field = <K extends keyof MemorialProfile>(key: K, value: MemorialProfile[K]) => {
    history.current = [];
    setMessages([]);
    setProfile((previous) => ({ ...previous, [key]: value }));
  };

  return (
    <div className="memorial-studio">
      <header className="memorial-heading">
        <div>
          <span className="memorial-eyebrow">EVERECHO / EXPERIMENTAL STUDIO</span>
          <h1>
            A familiar voice.
            <br />
            <em>A space to remember.</em>
          </h1>
          <p>
            Shape an imagined conversation from the memories, expressions and personality you choose
            to share.
          </p>
        </div>
        <span className="memorial-pill">AI memorial simulation</span>
      </header>
      <div className="memorial-disclosure">
        <strong>A simulation, always.</strong> This is not the person, their consciousness, or their
        actual feelings. Generated replies are imagined and are never added to the original archive
        as facts.
      </div>
      <div className="memorial-grid">
        <section className="memorial-profile" aria-labelledby="profile-title">
          <span className="memorial-eyebrow">01 / THEIR STORY</span>
          <h2 id="profile-title">Begin with what you know</h2>
          <p className="small muted">
            Notes and chat stay in this tab and clear when you reload. Original archive data is
            never imported automatically.
          </p>
          <fieldset disabled={active || busy || voiceBusy}>
            <label htmlFor="memorial-name">Their name</label>
            <input
              id="memorial-name"
              value={profile.name}
              maxLength={100}
              placeholder="The name you remember"
              onChange={(event) => {
                field('name', event.target.value);
                setVoiceToken(null);
                setVoiceNote('No recreated voice connected');
              }}
            />
            <label htmlFor="memorial-relationship">Your relationship</label>
            <input
              id="memorial-relationship"
              value={profile.relationship}
              maxLength={100}
              placeholder="For example, my grandfather"
              onChange={(event) => field('relationship', event.target.value)}
            />
            <label htmlFor="memorial-personality">What were they like?</label>
            <textarea
              id="memorial-personality"
              rows={3}
              maxLength={2000}
              value={profile.personality}
              placeholder="Patient, playful, quietly encouraging…"
              onChange={(event) => field('personality', event.target.value)}
            />
            <label htmlFor="memorial-memories">Memories and things they told you</label>
            <textarea
              id="memorial-memories"
              rows={5}
              maxLength={8000}
              value={profile.memories}
              placeholder="One memory per line. Include places, people and details you actually know."
              onChange={(event) => field('memories', event.target.value)}
            />
            <label htmlFor="memorial-phrases">Their familiar expressions</label>
            <textarea
              id="memorial-phrases"
              rows={2}
              maxLength={1000}
              value={profile.phrases}
              placeholder="A greeting, a saying, a way they encouraged you…"
              onChange={(event) => field('phrases', event.target.value)}
            />
            <div className="memorial-two">
              <div>
                <label htmlFor="memorial-language">Language</label>
                <select
                  id="memorial-language"
                  value={profile.language}
                  onChange={(event) =>
                    field('language', event.target.value as MemorialProfile['language'])
                  }
                >
                  <option value="en">English</option>
                  <option value="hi">Hindi</option>
                </select>
              </div>
              <div>
                <label htmlFor="memorial-tone">Emotional delivery</label>
                <select
                  id="memorial-tone"
                  value={profile.tone}
                  onChange={(event) => field('tone', event.target.value as MemorialProfile['tone'])}
                >
                  <option value="warm">Warm</option>
                  <option value="gentle">Gentle</option>
                  <option value="reflective">Reflective</option>
                  <option value="cheerful">Cheerful</option>
                </select>
              </div>
            </div>
            <p className="small muted">
              Delivery is a creative choice, not an inference about how they really felt.
            </p>
          </fieldset>
          <details className="memorial-voice-setup">
            <summary>02 / Recreate an authorized voice</summary>
            <p className="small">
              Choose a clear recording of one speaker, under 1 MB: MP3, WAV, M4A or WebM. Selecting
              a file does not upload it.
            </p>
            <input
              aria-label="Authorized voice recording"
              type="file"
              accept="audio/mpeg,audio/wav,audio/x-wav,audio/mp4,audio/webm"
              disabled={active || busy || voiceBusy}
              onChange={(event) => {
                setSample(event.target.files?.[0] ?? null);
                setVoiceToken(null);
                setVoiceNote('No recreated voice connected');
              }}
            />
            <label className="memorial-check">
              <input
                type="checkbox"
                checked={voiceConsent}
                disabled={active || voiceBusy}
                onChange={(event) => setVoiceConsent(event.target.checked)}
              />
              <span>
                I have authorization to recreate this voice and to upload this recording to
                ElevenLabs. The provider retains the created voice; manage or delete it in that
                account. Provider charges may apply.
              </span>
            </label>
            <button
              type="button"
              disabled={
                !status?.voiceReady ||
                !sample ||
                !voiceConsent ||
                !profile.name.trim() ||
                active ||
                busy ||
                voiceBusy
              }
              onClick={() => void connectVoice()}
            >
              {voiceBusy ? 'Creating voice…' : 'Upload to ElevenLabs & create voice'}
            </button>
            <p className="small" role="status">
              {voiceNote}
            </p>
            {!status?.voiceReady && (
              <p className="small muted">
                Voice provider is not configured. No recording will be uploaded.
              </p>
            )}
          </details>
        </section>
        <section className="memorial-conversation" aria-labelledby="conversation-title">
          <div className="memorial-room">
            <span className="memorial-eyebrow">03 / A MOMENT TOGETHER</span>
            <div className={`memorial-orb ${active ? 'is-active' : ''}`} aria-hidden="true">
              <span>{profile.name.trim().slice(0, 1).toUpperCase() || 'E'}</span>
            </div>
            <h2 id="conversation-title">
              {profile.name.trim()
                ? `Remembering ${profile.name}`
                : 'Who would you like to remember?'}
            </h2>
            <p role="status">{phase}</p>
            <span className="memorial-pill">
              {status?.conversationReady && allowCloud
                ? 'AI conversation'
                : 'Local reference preview'}{' '}
              · {voiceToken ? 'Recreated voice' : 'Device voice'}
            </span>
            <p className="small">
              {status?.conversationReady
                ? 'Generated dialogue is imagined, not an original quotation.'
                : 'Preview matches your notes. Open-ended dialogue needs a conversation provider.'}
            </p>
          </div>
          <div className="memorial-permissions">
            <label className="memorial-check">
              <input
                type="checkbox"
                checked={acknowledged}
                disabled={active || busy}
                onChange={(event) => setAcknowledged(event.target.checked)}
              />
              <span>
                I understand this is an AI simulation. I have permission to use the notes I supply.
              </span>
            </label>
            <label className="memorial-check">
              <input
                type="checkbox"
                checked={allowCloud}
                disabled={active || busy || !status?.conversationReady}
                onChange={(event) => setAllowCloud(event.target.checked)}
              />
              <span>
                Allow notes and conversation to be sent to Anthropic; generated replies go to
                ElevenLabs when a recreated voice is connected. Provider charges may apply.
              </span>
            </label>
            <label className="memorial-check">
              <input
                type="checkbox"
                checked={allowMicrophone}
                disabled={active || busy || !speechSupported}
                onChange={(event) => setAllowMicrophone(event.target.checked)}
              />
              <span>
                Enable microphone input. This browser’s speech service may process audio remotely.
              </span>
            </label>
            <div className="memorial-actions">
              <button
                className="button primary"
                type="button"
                disabled={!ready || busy || !allowMicrophone || !speechSupported || active}
                onClick={() => {
                  setError('');
                  listeningSession.current = true;
                  setActive(true);
                  resumeListening();
                }}
              >
                Start voice session
              </button>
              <button type="button" disabled={!active && !busy} onClick={stop}>
                Stop session
              </button>
            </div>
            {!speechSupported && (
              <p className="small muted">
                Voice input is unavailable in this browser. Text conversation remains available.
              </p>
            )}
            {error && (
              <p className="memorial-error" role="alert">
                {error}
              </p>
            )}
          </div>
          <div
            className="memorial-transcript"
            role="log"
            aria-live="polite"
            aria-label="Memorial conversation"
          >
            {messages.length === 0 ? (
              <div className="memorial-empty">
                <h3>Your conversation begins here</h3>
                <p>Add a name and a memory, then type a question or start a voice session.</p>
                <span>Every generated reply is labeled.</span>
              </div>
            ) : (
              messages.map((message, index) => (
                <article className={`memorial-message ${message.role}`} key={index}>
                  <span>
                    {message.role === 'user'
                      ? 'You'
                      : message.mode === 'local-preview'
                        ? 'Local reference preview'
                        : 'AI · imagined dialogue'}
                  </span>
                  <p>{message.content}</p>
                  {message.audio && !active && (
                    <audio
                      controls
                      preload="none"
                      aria-label="Play recreated AI voice reply"
                      src={`data:audio/mpeg;base64,${message.audio}`}
                    />
                  )}
                </article>
              ))
            )}
            <div ref={endOfMessages} />
          </div>
          <form
            className="memorial-compose"
            onSubmit={(event) => {
              event.preventDefault();
              void send(draft);
            }}
          >
            <label className="sr-only" htmlFor="memorial-message">
              Your message
            </label>
            <input
              id="memorial-message"
              maxLength={1500}
              placeholder="What would you like to talk about?"
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              disabled={busy}
            />
            <button type="submit" disabled={!ready || busy || !draft.trim()}>
              Send
            </button>
          </form>
          <div className="memorial-bottom">
            <span>Turn-based voice · you speak, then listen</span>
            <button
              type="button"
              disabled={busy || active}
              onClick={() => {
                history.current = [];
                setMessages([]);
              }}
            >
              Clear conversation
            </button>
          </div>
        </section>
      </div>
    </div>
  );
}
