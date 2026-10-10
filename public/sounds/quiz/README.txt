The music for the Live Quiz: the three tracks a trainer chooses between on the
projector (src/lib/quizMusic.js, RECORDED). Licensed for use in this app.
Re-encoded from the 256 kbps originals to 128 kbps stereo (lamejs) to halve
the download; the loudness curve matches the originals within 0.6 dB.

  countdown.mp3      "Quiz Countdown" by Paolo Argento (Pixabay 194417)
                     About 88s of music that swells and fades. The app starts
                     it late so the ending lands as the clock reaches zero.
  news-desk.mp3      "Quiz background loop - thinking (news)" by Sonican (Pixabay 275636)
  thinking-time.mp3  "Quiz evaluation loop - thinking time" by Sonican (Pixabay 231582)
                     The two loops pick up where the last question stopped and
                     wrap round with a short crossfade.

Only the projector downloads a track, and only once it has been picked. If a
file is missing or unreadable, the quiz runs without music and says so; the
short cues (count-in, reveal, time up, podium) and the last-seconds tick still play.

Replacing a file: keep the name. The ending of countdown.mp3 is set in code
(RECORDED.countdown.end, in seconds); change it if the new file ends elsewhere.
