/**
 * Audio checks that do not need a decoder: the declared type must be an accepted container
 * AND the bytes must start like that container (a renamed file or a text body is refused).
 */

type Container = 'webm' | 'ogg' | 'mp4' | 'mpeg' | 'wav';

/** Accepted MIME types (what browsers' MediaRecorder produces, plus common uploads). */
const TYPES: Record<string, Container> = {
  'audio/webm': 'webm',
  'audio/ogg': 'ogg',
  'audio/mp4': 'mp4',
  'audio/m4a': 'mp4',
  'audio/x-m4a': 'mp4',
  'audio/aac': 'mp4',
  'audio/mpeg': 'mpeg',
  'audio/mp3': 'mpeg',
  'audio/wav': 'wav',
  'audio/x-wav': 'wav',
  'audio/wave': 'wav',
};

export const ACCEPTED_AUDIO_TYPES = Object.keys(TYPES);

/** "audio/webm;codecs=opus" → "audio/webm"; undefined when not an accepted type. */
export function acceptedType(contentType: string | undefined): string | undefined {
  const type = (contentType ?? '').split(';')[0]?.trim().toLowerCase() ?? '';
  return type in TYPES ? type : undefined;
}

function startsWith(audio: Buffer, offset: number, bytes: number[] | string): boolean {
  const expected =
    typeof bytes === 'string' ? Buffer.from(bytes, 'latin1') : Buffer.from(bytes);
  return (
    audio.length >= offset + expected.length &&
    audio.subarray(offset, offset + expected.length).equals(expected)
  );
}

/** Whether the bytes look like the container of `mimeType`. */
export function matchesSignature(audio: Buffer, mimeType: string): boolean {
  switch (TYPES[mimeType]) {
    case 'webm':
      return startsWith(audio, 0, [0x1a, 0x45, 0xdf, 0xa3]); // EBML
    case 'ogg':
      return startsWith(audio, 0, 'OggS');
    case 'mp4':
      return startsWith(audio, 4, 'ftyp') || startsWith(audio, 0, [0xff, 0xf1]); // MP4 / ADTS AAC
    case 'mpeg':
      return (
        startsWith(audio, 0, 'ID3') ||
        (audio.length >= 2 && audio[0] === 0xff && ((audio[1] ?? 0) & 0xe0) === 0xe0)
      );
    case 'wav':
      return startsWith(audio, 0, 'RIFF') && startsWith(audio, 8, 'WAVE');
    default:
      return false;
  }
}

/** File extension providers use to recognize the format. */
export function extensionOf(mimeType: string): string {
  const container = TYPES[mimeType];
  if (container === 'mp4') return 'm4a';
  if (container === 'mpeg') return 'mp3';
  return container ?? 'bin';
}

/** Wraps 16-bit little-endian mono PCM in a WAV header so browsers can play it. */
export function pcmToWav(pcm: Buffer, sampleRate: number): Buffer {
  const header = Buffer.alloc(44);
  header.write('RIFF', 0, 'latin1');
  header.writeUInt32LE(36 + pcm.length, 4);
  header.write('WAVE', 8, 'latin1');
  header.write('fmt ', 12, 'latin1');
  header.writeUInt32LE(16, 16); // PCM chunk size
  header.writeUInt16LE(1, 20); // PCM format
  header.writeUInt16LE(1, 22); // mono
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(sampleRate * 2, 28); // byte rate
  header.writeUInt16LE(2, 32); // block align
  header.writeUInt16LE(16, 34); // bits per sample
  header.write('data', 36, 'latin1');
  header.writeUInt32LE(pcm.length, 40);
  return Buffer.concat([header, pcm]);
}
