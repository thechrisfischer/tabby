#!/usr/bin/env bash
# Re-downloads bundled interstitial heroes per persona (Unsplash — unsplash.com/license).
# Photo IDs must match src/heroes.json order for each persona.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
DIR="$ROOT/src/assets"
mkdir -p "$DIR"
fetch() {
  local out="$1" id="$2"
  curl -fsSL "https://images.unsplash.com/${id}?ixlib=rb-4.0.3&auto=format&fit=crop&w=1920&q=82" -o "$out"
}

# --- landscape ---
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

# --- cats (playful, in motion) ---
fetch "$DIR/cats-01.jpg" photo-1566513317351-c6d7be11505e
fetch "$DIR/cats-02.jpg" photo-1773813080602-d5967f0e6ddb
fetch "$DIR/cats-03.jpg" photo-1685712108226-c7f960765bbd
fetch "$DIR/cats-04.jpg" photo-1771495551703-ceeca3810750
fetch "$DIR/cats-05.jpg" photo-1708979346023-eac4a9fd8d93
fetch "$DIR/cats-06.jpg" photo-1747978970389-cedfca8954b4
fetch "$DIR/cats-07.jpg" photo-1770751857462-4954bffba866
fetch "$DIR/cats-08.jpg" photo-1768859409234-f491d229ffdc

# --- fractals / hyper-digital art ---
fetch "$DIR/fractals-01.jpg" photo-1620421681758-cd89f531661f
fetch "$DIR/fractals-02.jpg" photo-1620421680010-0766ff230392
fetch "$DIR/fractals-03.jpg" photo-1567360425618-1594206637d2
fetch "$DIR/fractals-04.jpg" photo-1684777475700-aa3a825765b8
fetch "$DIR/fractals-05.jpg" photo-1721791256304-f86b84fbfa97
fetch "$DIR/fractals-06.jpg" photo-1621238986077-29ec5bafe661
fetch "$DIR/fractals-07.jpg" photo-1635438004811-54b5864e57eb
fetch "$DIR/fractals-08.jpg" photo-1621974639426-4cbecbd347eb

echo "Wrote heroes → $DIR"
