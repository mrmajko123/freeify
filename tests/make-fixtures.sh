#!/usr/bin/env bash
# Generates small test songs (MP3 + FLAC with tags, cover art and lyrics) into tests/.fixtures.
# Requires ffmpeg and python3.
set -euo pipefail
cd "$(dirname "$0")"
OUT=.fixtures
rm -rf "$OUT"
mkdir -p "$OUT/Neon Coast/Night Drive" "$OUT/loose"
cd "$OUT"
q() { ffmpeg -loglevel error -y "$@"; }

q -f lavfi -i "gradients=s=800x800:c0=#ff3d7f:c1=#4b2fd1:seed=3" -frames:v 1 cover1.jpg
q -f lavfi -i "gradients=s=500x500:c0=#ffd166:c1=#ef476f:seed=9" -frames:v 1 cover2.png
q -f lavfi -i "gradients=s=300x300:c0=#06d6a0:c1=#118ab2:seed=5" -frames:v 1 cover3.jpg

# ID3v2.3 album with embedded cover art
i=1
for t in "Midnight Highway:220" "City Lights:330" "Afterglow:440"; do
  name=${t%%:*}; f=${t##*:}
  q -f lavfi -i "sine=frequency=$f:duration=6" -i cover1.jpg -map 0:a -map 1:v -c:a libmp3lame -b:a 96k -c:v copy -id3v2_version 3 \
    -metadata title="$name" -metadata artist="Neon Coast" -metadata album="Night Drive" -metadata track="$i/3" \
    -metadata date=2021 -metadata genre="Synthwave" -metadata:s:v comment="Cover (front)" "Neon Coast/Night Drive/0$i $name.mp3"
  i=$((i+1))
done

# FLAC with Vorbis comments and a picture block
for t in "1:Sunrise Walk:523" "2:Coffee & Rain:587"; do
  n=${t%%:*}; rest=${t#*:}; name=${rest%%:*}; f=${rest##*:}
  q -f lavfi -i "sine=frequency=$f:duration=5" -i cover2.png -map 0:a -map 1:v -c:a flac -c:v copy -disposition:v attached_pic \
    -metadata title="$name" -metadata artist="Ana Ruiz" -metadata album="Morning Light" -metadata track="$n" \
    -metadata date=2019 -metadata genre="Acoustic" "loose/Ana Ruiz - $name.flac"
done

# No tags at all: metadata must come from the file name
q -f lavfi -i "sine=frequency=660:duration=4" -c:a libmp3lame -b:a 64k -write_id3v2 0 -map_metadata -1 "loose/07 - Lo Fi Crew - Rainy Window.mp3"

# Hand-built ID3v2.4 tag: UTF-16 + UTF-8 text, multi-value artist, genre code, USLT lyrics, APIC with data-length indicator
q -f lavfi -i "sine=frequency=392:duration=5" -c:a libmp3lame -b:a 64k -write_id3v2 0 -map_metadata -1 raw.mp3
python3 ../mkid3.py raw.mp3 cover3.jpg "loose/unicode-v24.mp3"
rm raw.mp3

# Synced lyrics that should attach to "02 City Lights.mp3"
cat > "Neon Coast/Night Drive/02 City Lights.lrc" <<'LRC'
[ar:Neon Coast]
[ti:City Lights]
[00:00.50]Windows open, city lights
[00:02.00]Every signal turning green
[00:03.50]We don't stop until the morning
[00:05.00]Somewhere in between
LRC

echo "hello" > loose/notes.txt
echo "Fixtures written to tests/$OUT"
