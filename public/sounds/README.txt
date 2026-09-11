Drop a drum roll here, named exactly:

    drumroll.mp3

NO TRIMMING NEEDED — ANY LENGTH WORKS
  The app measures the recording when it loads it, finds the LOUDEST moment,
  and plays the second and a half running up to that. So a twelve-second roll
  that crescendos, crashes and fades is handled the same as a tidy two-second
  one: the build always resolves exactly as the plinth lands, and whatever
  comes after the peak is simply never heard.

  That also means a crash at the end of the recording is fine. The app stops
  where that crash would have been and fires its own instead.

FORMAT
  Keep the name drumroll.mp3 whatever you actually have. The browser decodes
  by reading the bytes, not the extension, so a WAV, OGG or M4A renamed to
  .mp3 decodes perfectly well. Under about 300KB keeps it snappy.

WHERE TO GET ONE
  Any library you are entitled to use. freesound.org and pixabay.com both have
  CC0 drum rolls, which are the least trouble — no attribution, no expiry.
  Deliberately not shipped with the app: a sound file is a licensing question,
  and it is yours to answer.

IF SOMETHING SOUNDS WRONG
  The browser console prints one line when the file loads:

      [quiz] drum roll: 12.02s, peaks at 9.84s

  Those two numbers are the whole diagnosis. A peak at or very near the total
  length means the recording ends on its loudest point; a peak near zero means
  it opens loud and fades, which is not a roll the app can build to.

IF THIS FILE IS MISSING
  Nothing breaks. The podium falls back to a synthesised roll, which is the
  one that sounded like a creaking door — so the fallback is a safety net,
  not an alternative.
