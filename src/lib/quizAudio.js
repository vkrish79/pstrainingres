import { signedQuizFileUrl } from './quizImages.js';

export const QUIZ_AUDIO_BUCKET = 'quiz-audio';

// 20MB, matching the bucket's own limit. Checked here as well as there so a
// trainer who picks the wrong file is told what is wrong with it, rather than
// waiting out the upload of twelve megabytes to be shown a 400.
const MAX_BYTES = 20 * 1024 * 1024;

// Browsers report .mp3 as audio/mpeg; a few report audio/mp3, and Windows has
// been known to hand over an empty type for a file dragged out of an old
// folder — so the extension is the fallback rather than a hard refusal.
const ACCEPTED = ['audio/mpeg', 'audio/mp3'];

// NO RE-ENCODING, deliberately, and this is the one place the audio path
// differs in shape from the picture path.
//
// prepareQuizImage shrinks every picture because a 4MB phone screenshot and a
// 150KB WebP look identical at the back of a room. Sound has no equivalent
// trade: re-compressing a clip to save a megabyte costs exactly the clarity
// that decides whether the question is answerable, and the browser APIs that
// could do it (decode to PCM, re-encode) would hold the whole clip in memory
// to produce something worse. Validate, and send the file as it is.
export function prepareQuizAudio(file) {
  if (!file) return { error: new Error('Pick a sound clip first.') };

  const looksMp3 = ACCEPTED.includes(file.type)
    || (!file.type && /\.mp3$/i.test(file.name || ''));
  if (!looksMp3) {
    return { error: new Error('Sound clips must be MP3 files.') };
  }
  if (file.size > MAX_BYTES) {
    return { error: new Error('That clip is over 20MB — too big to upload. A question is 5 to 120 seconds long, so a shorter clip is almost certainly the right fix.') };
  }

  return { data: { blob: file, contentType: 'audio/mpeg', ext: 'mp3' } };
}

export function signedQuizAudioUrl(path) {
  return signedQuizFileUrl(QUIZ_AUDIO_BUCKET, path);
}
