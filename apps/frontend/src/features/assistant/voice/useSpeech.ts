import { useEffect, useRef, useState } from 'react';
import { speak } from '../../../services/voice';

/**
 * Sends the element through an analyser (live spectrum for the orb). A context the browser
 * keeps suspended (autoplay policy) would silence the audio, so then the element plays on
 * its own, without the spectrum.
 */
async function routeThroughAnalyser(
  audio: HTMLAudioElement,
): Promise<{ context: AudioContext | null; node: AnalyserNode | null }> {
  let context: AudioContext | undefined;
  try {
    context = new AudioContext();
    if (context.state === 'suspended') await context.resume().catch(() => undefined);
    if (context.state !== 'running') throw new Error('suspended');
    const node = context.createAnalyser();
    node.fftSize = 256;
    const source = context.createMediaElementSource(audio);
    source.connect(node);
    node.connect(context.destination);
    return { context, node };
  } catch {
    void context?.close().catch(() => undefined);
    return { context: null, node: null };
  }
}

interface Playback {
  audio: HTMLAudioElement;
  url: string;
  context: AudioContext | null;
}

/**
 * Plays replies read aloud by the API. Exposes which message is speaking and the live
 * spectrum of the voice (for the orb). One reply at a time; the audio is held only as an
 * object URL while it plays and is revoked right after.
 */
export function useSpeech({
  rate,
  onError,
}: {
  rate: number;
  onError: (error: unknown) => void;
}) {
  const [speakingId, setSpeakingId] = useState<string | null>(null);
  const [loadingId, setLoadingId] = useState<string | null>(null);
  const [analyser, setAnalyser] = useState<AnalyserNode | null>(null);
  const playback = useRef<Playback | null>(null);
  const request = useRef(0);

  const release = () => {
    const current = playback.current;
    if (!current) return;
    current.audio.pause();
    current.audio.removeAttribute('src');
    URL.revokeObjectURL(current.url);
    void current.context?.close().catch(() => undefined);
    playback.current = null;
  };

  const stop = () => {
    request.current += 1; // a reply still loading must not start afterwards
    release();
    setSpeakingId(null);
    setLoadingId(null);
    setAnalyser(null);
  };

  const play = async (messageId: string) => {
    stop();
    const ticket = request.current;
    setLoadingId(messageId);
    let blob: Blob;
    try {
      blob = await speak(messageId);
    } catch (error) {
      if (ticket === request.current) {
        setLoadingId(null);
        onError(error);
      }
      return;
    }
    if (ticket !== request.current) return;

    const url = URL.createObjectURL(blob);
    const audio = new Audio(url);
    audio.playbackRate = rate;
    const { context, node } = await routeThroughAnalyser(audio);
    if (ticket !== request.current) {
      void context?.close().catch(() => undefined);
      URL.revokeObjectURL(url);
      return;
    }
    playback.current = { audio, url, context };
    audio.onended = () => {
      if (playback.current?.audio === audio) stop();
    };
    audio.onerror = () => {
      if (playback.current?.audio === audio) {
        stop();
        onError(new Error('playback_failed'));
      }
    };
    setLoadingId(null);
    setSpeakingId(messageId);
    setAnalyser(node);
    try {
      await audio.play();
    } catch (error) {
      if (playback.current?.audio === audio) {
        stop();
        onError(error);
      }
    }
  };

  // Speed changes apply to what is playing.
  useEffect(() => {
    if (playback.current) playback.current.audio.playbackRate = rate;
  }, [rate]);

  useEffect(() => () => release(), []);

  return { speakingId, loadingId, analyser, play, stop };
}
