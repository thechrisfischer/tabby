#!/usr/bin/env bash
# Re-downloads bundled interstitial heroes (Unsplash — unsplash.com/license).
# Photo IDs must match src/heroes.json order.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
DIR="$ROOT/src/assets"
mkdir -p "$DIR"
fetch() {
  local out="$1" id="$2"
  curl -fsSL "https://images.unsplash.com/${id}?ixlib=rb-4.0.3&auto=format&fit=crop&w=1920&q=82" -o "$out"
}
fetch "$DIR/bg-01.jpg" photo-1506905925346-21bda4d32df4
fetch "$DIR/bg-02.jpg" photo-1472214103451-9374bd1c798e
fetch "$DIR/bg-03.jpg" photo-1447752875215-b2761acb3c5d
fetch "$DIR/bg-04.jpg" photo-1433086966358-54859d0ed716
fetch "$DIR/bg-05.jpg" photo-1469474968028-56623f02e42e
fetch "$DIR/bg-06.jpg" photo-1483729558449-99ef09a8c325
fetch "$DIR/bg-07.jpg" photo-1464822759023-fed622ff2c3b
fetch "$DIR/bg-08.jpg" photo-1439066615861-d1af74d74000
fetch "$DIR/bg-09.jpg" photo-1494500764479-0c8f2919a3d8
fetch "$DIR/bg-10.jpg" photo-1518173946687-a4c8892bbd9f
echo "Wrote 10 images → $DIR"
