# CaptionForge

CaptionForge is a native Android video editor designed around expressive, precisely timed captions.

## Features

- Import videos using Android's system file picker (no broad storage permission required)
- Unlimited timed captions with start/end controls
- Drag captions directly on the video preview
- Clean, Bold, Neon and Minimal presets
- Sans, serif and monospace typography; uppercase, alignment and background options
- Five caption animations: none, fade, pop, rise and typewriter
- Size, text color, timing and multiline wrapping controls
- Smart Split turns a paragraph into several timed captions
- Duplicate captions and seek using the caption timeline
- Automatic local project saving
- Hardware-accelerated Media3 MP4 export with original audio
- Output dimensions capped at 1080p for reliable mobile rendering

## Build

Requires JDK 17 and Android SDK 35.

```bash
gradle assembleDebug
```

The APK is generated at `app/build/outputs/apk/debug/app-debug.apk`.

## Notes

The debug APK is signed with Android's standard debug key and can be installed directly after allowing installs from your browser/file manager. Caption rendering uses Android Media3 Transformer. Some unusual source codecs may need to be converted to H.264/H.265 before import.
