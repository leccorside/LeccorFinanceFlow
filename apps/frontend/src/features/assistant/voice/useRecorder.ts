import { useEffect, useRef, useState } from 'react';

export type RecorderStatus = 'idle' | 'requesting' | 'recording';
export type RecorderError =
  'denied' | 'no_device' | 'unsupported' | 'too_short' | 'failed';

/** Containers the API accepts, in order of preference (Chrome/Edge, Safari, Firefox). */
const PREFERRED_TYPES = [
  'audio/webm;codecs=opus',
  'audio/webm',
  'audio/mp4',
  'audio/ogg;codecs=opus',
  'audio/ogg',
];

/** Shorter than this is a tap, not speech. */
const MIN_RECORDING_MS = 600;

export function recordingSupported(): boolean {
  return (
    typeof window !== 'undefined' &&
    typeof window.MediaRecorder === 'function' &&
    typeof navigator.mediaDevices?.getUserMedia === 'function'
  );
}

function pickType(): string | undefined {
  const isSupported = window.MediaRecorder.isTypeSupported?.bind(window.MediaRecorder);
  return PREFERRED_TYPES.find((type) => isSupported?.(type));
}

function errorOf(error: unknown): RecorderError {
  const name = error instanceof DOMException || error instanceof Error ? error.name : '';
  if (name === 'NotAllowedError' || name === 'SecurityError') return 'denied';
  if (name === 'NotFoundError' || name === 'OverconstrainedError') return 'no_device';
  return 'failed';
}

interface Session {
  recorder: MediaRecorder;
  stream: MediaStream;
  context: AudioContext | null;
  chunks: Blob[];
  startedAt: number;
  discard: boolean;
  timer: number;
}

/**
 * Microphone capture with MediaRecorder. The mic is opened only while recording and fully
 * released afterwards (tracks stopped, audio graph closed). `analyser` exposes the live
 * spectrum for the orb. Recording stops by itself at `maxSeconds`; the result is handed
 * to `onRecorded` (never kept here).
 */
export function useRecorder({
  maxSeconds,
  onRecorded,
}: {
  maxSeconds: number;
  onRecorded: (audio: Blob) => void;
}) {
  const [status, setStatus] = useState<RecorderStatus>('idle');
  const [error, setError] = useState<RecorderError | null>(null);
  const [elapsed, setElapsed] = useState(0);
  const [analyser, setAnalyser] = useState<AnalyserNode | null>(null);
  const session = useRef<Session | null>(null);
  const onRecordedRef = useRef(onRecorded);

  useEffect(() => {
    onRecordedRef.current = onRecorded;
  }, [onRecorded]);

  const release = (current: Session) => {
    window.clearInterval(current.timer);
    current.stream.getTracks().forEach((track) => track.stop());
    void current.context?.close().catch(() => undefined);
    session.current = null;
    setAnalyser(null);
    setStatus('idle');
  };

  const stop = () => {
    const current = session.current;
    if (current && current.recorder.state !== 'inactive') current.recorder.stop();
  };

  const cancel = () => {
    const current = session.current;
    if (!current) return;
    current.discard = true;
    stop();
  };

  const start = async () => {
    if (session.current || status !== 'idle') return;
    setError(null);
    if (!recordingSupported()) {
      setError('unsupported');
      return;
    }
    setStatus('requesting');
    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true },
      });
    } catch (failure) {
      setStatus('idle');
      setError(errorOf(failure));
      return;
    }

    const type = pickType();
    let recorder: MediaRecorder;
    try {
      recorder = new MediaRecorder(stream, type ? { mimeType: type } : undefined);
    } catch {
      stream.getTracks().forEach((track) => track.stop());
      setStatus('idle');
      setError('unsupported');
      return;
    }

    let context: AudioContext | null;
    let node: AnalyserNode | null;
    try {
      context = new AudioContext();
      void context.resume().catch(() => undefined);
      node = context.createAnalyser();
      node.fftSize = 256;
      node.smoothingTimeConstant = 0.6;
      context.createMediaStreamSource(stream).connect(node);
    } catch {
      context = null; // the orb then animates without the real spectrum
      node = null;
    }

    const current: Session = {
      recorder,
      stream,
      context,
      chunks: [],
      startedAt: Date.now(),
      discard: false,
      timer: 0,
    };
    session.current = current;
    recorder.ondataavailable = (event) => {
      if (event.data.size > 0) current.chunks.push(event.data);
    };
    recorder.onstop = () => {
      const duration = Date.now() - current.startedAt;
      const blob = new Blob(current.chunks, {
        type: (recorder.mimeType || type || 'audio/webm').split(';')[0] ?? 'audio/webm',
      });
      current.chunks = [];
      release(current);
      if (current.discard) return;
      if (duration < MIN_RECORDING_MS || blob.size === 0) {
        setError('too_short');
        return;
      }
      onRecordedRef.current(blob);
    };
    recorder.onerror = () => {
      current.discard = true;
      setError('failed');
      stop();
    };
    current.timer = window.setInterval(() => {
      const seconds = Math.floor((Date.now() - current.startedAt) / 1000);
      setElapsed(seconds);
      if (seconds >= maxSeconds) stop();
    }, 250);

    setElapsed(0);
    setAnalyser(node);
    setStatus('recording');
    recorder.start(250);
  };

  // Leaving the page never leaves the microphone open.
  useEffect(
    () => () => {
      const current = session.current;
      if (!current) return;
      current.discard = true;
      if (current.recorder.state !== 'inactive') current.recorder.stop();
      window.clearInterval(current.timer);
      current.stream.getTracks().forEach((track) => track.stop());
      void current.context?.close().catch(() => undefined);
    },
    [],
  );

  return {
    status,
    error,
    elapsed,
    analyser,
    start,
    stop,
    cancel,
    clearError: () => setError(null),
  };
}
