#!/usr/bin/env bash
# Generate short arcade SFX + loopable music stems for public/audio/.
# Requires ffmpeg. Re-run when tweaking the procedural recipe.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
OUT="$ROOT/public/audio"
mkdir -p "$OUT"

gen() {
  local out="$1"
  shift
  ffmpeg -y -hide_banner -loglevel error "$@" "$out"
}

# SFX — keep each clip short for <50 KB OGG targets
gen "$OUT/flipper.ogg" \
  -f lavfi -i "anoisesrc=d=0.08:color=white:seed=3" \
  -af "highpass=f=900,lowpass=f=5000,afade=t=out:st=0:d=0.08,volume=0.45"

gen "$OUT/bumper.ogg" \
  -f lavfi -i "sine=frequency=440:duration=0.22" \
  -af "asubboost=dry=0.8:wet=0.4:decay=0.4,afade=t=out:st=0.05:d=0.17,volume=0.55"

gen "$OUT/drain.ogg" \
  -f lavfi -i "sine=frequency=280:duration=0.45" \
  -af "tremolo=f=8:d=0.6,afade=t=out:st=0.1:d=0.35,volume=0.5"

gen "$OUT/gold-collect.ogg" \
  -f lavfi -i "sine=frequency=880:duration=0.35" \
  -af "asetrate=48000*1.2,aresample=48000,afade=t=out:st=0.08:d=0.27,volume=0.5"

gen "$OUT/jackpot-phase1.ogg" \
  -f lavfi -i "sine=frequency=620:duration=0.55" \
  -af "tremolo=f=6:d=0.9,afade=t=out:st=0.2:d=0.35,volume=0.55"

gen "$OUT/jackpot-phase2.ogg" \
  -f lavfi -i "aevalsrc=0.5*sin(2*PI*180*t)*exp(-0.4*t):d=1.2:sample_rate=48000" \
  -af "asetrate=48000*1.08,aresample=48000,afade=t=out:st=0.4:d=0.8,volume=0.45"

gen "$OUT/jackpot-phase3.ogg" \
  -f lavfi -i "anoisesrc=d=0.9:color=pink:seed=9" \
  -af "lowpass=f=1800,afade=t=out:st=0.15:d=0.75,volume=0.6"

gen "$OUT/portal.ogg" \
  -f lavfi -i "sine=frequency=523:duration=0.4" \
  -af "chorus=0.5:0.9:50:0.4:0.25:2,afade=t=out:st=0.1:d=0.3,volume=0.5"

gen "$OUT/slot-stop.ogg" \
  -f lavfi -i "sine=frequency=520:duration=0.1" \
  -af "afade=t=out:st=0:d=0.1,volume=0.4"

# Music stems — short loopable beds
gen "$OUT/music-attract.ogg" \
  -f lavfi -i "sine=frequency=110:duration=8" \
  -af "chorus=0.4:0.8:40:0.3:0.2:2,volume=0.35" \
  -c:a libvorbis

gen "$OUT/music-fever.ogg" \
  -f lavfi -i "aevalsrc=0.4*sin(2*PI*220*t)*sin(2*PI*3*t):d=8:sample_rate=48000" \
  -af "lowpass=f=2400,chorus=0.5:0.9:55:0.35:0.25:2,volume=0.38" \
  -c:a libvorbis

echo "Generated $(ls -1 "$OUT"/*.ogg | wc -l) files in public/audio/"
