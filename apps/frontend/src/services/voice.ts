import { api } from './api';

export interface VoiceCapabilities {
  transcription: boolean;
  speech: boolean;
  maxAudioBytes: number;
  maxAudioSeconds: number;
  audioTypes: string[];
}

export async function getVoiceCapabilities(): Promise<VoiceCapabilities> {
  return (await api.get<VoiceCapabilities>('/voice/capabilities')).data;
}

/** Sends the recording as the raw body (its own audio/* type); the API keeps nothing. */
export async function transcribe(
  audio: Blob,
): Promise<{ text: string; provider: string }> {
  return (
    await api.post<{ text: string; provider: string }>('/voice/transcriptions', audio, {
      headers: { 'Content-Type': audio.type || 'audio/webm' },
    })
  ).data;
}

/** One of the user's assistant replies, read aloud with the profile's voice. */
export async function speak(messageId: string): Promise<Blob> {
  return (await api.post<Blob>('/voice/speech', { messageId }, { responseType: 'blob' }))
    .data;
}
