import os
import sys
import unittest
import wave

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
from clubdesk import sound  # noqa: E402


class SoundTest(unittest.TestCase):
    def test_chime_file_is_a_valid_wav(self):
        with wave.open(sound.chime_file()) as wav:
            self.assertEqual(wav.getnchannels(), 1)
            self.assertGreater(wav.getnframes() / wav.getframerate(), 0.3)
        data = sound.chime_samples()
        self.assertTrue(any(data))  # not silence

    def test_play_never_raises(self):
        sound.play_notification_sound()


if __name__ == "__main__":
    unittest.main()
