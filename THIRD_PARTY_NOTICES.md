# Third-party notices

Chess Trainer is licensed under the GNU General Public License v3.0 or later (see [LICENSE](LICENSE)).
It includes or loads the following third-party software and data.

## Bundled with the app

### Stockfish 19 (lite, single-threaded WASM) — GPL-3.0

Files: `public/engine/stockfish-19-lite-single.js`, `public/engine/stockfish-19-lite-single.wasm` (from the npm package [`stockfish`](https://www.npmjs.com/package/stockfish) 19.0.1).

- Stockfish is free software by the Stockfish developers, licensed under the GNU GPL v3. Source code: https://github.com/official-stockfish/Stockfish
- The WebAssembly build is [Stockfish.js](https://github.com/nmrugg/stockfish.js) by Nathan Rugg (GPL-3.0). Source code of the exact build: https://github.com/nmrugg/stockfish.js/tree/v19.0.1
- The full license text is in [LICENSE](LICENSE) (the same GPL v3 text that ships with Stockfish).

### chess.js 1.4.0 — BSD-2-Clause

https://github.com/jhlywa/chess.js

```
Copyright (c) 2025, Jeff Hlywa (jhlywa@gmail.com)
All rights reserved.

Redistribution and use in source and binary forms, with or without
modification, are permitted provided that the following conditions are met:

1. Redistributions of source code must retain the above copyright notice,
   this list of conditions and the following disclaimer.
2. Redistributions in binary form must reproduce the above copyright notice,
   this list of conditions and the following disclaimer in the documentation
   and/or other materials provided with the distribution.

THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS "AS IS"
AND ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE
IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE
ARE DISCLAIMED. IN NO EVENT SHALL THE COPYRIGHT OWNER OR CONTRIBUTORS BE
LIABLE FOR ANY DIRECT, INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, OR
CONSEQUENTIAL DAMAGES (INCLUDING, BUT NOT LIMITED TO, PROCUREMENT OF
SUBSTITUTE GOODS OR SERVICES; LOSS OF USE, DATA, OR PROFITS; OR BUSINESS
INTERRUPTION) HOWEVER CAUSED AND ON ANY THEORY OF LIABILITY, WHETHER IN
CONTRACT, STRICT LIABILITY, OR TORT (INCLUDING NEGLIGENCE OR OTHERWISE)
ARISING IN ANY WAY OUT OF THE USE OF THIS SOFTWARE, EVEN IF ADVISED OF THE
POSSIBILITY OF SUCH DAMAGE.
```

### React 19.3.1 and react-dom 19.3.1 — MIT

Copyright (c) Meta Platforms, Inc. and affiliates. https://github.com/facebook/react

### react-chessboard 5.12.1 — MIT

Copyright (c) 2022 Ryan Gregory. https://github.com/Clariity/react-chessboard (also the source of the board pieces).

### Firebase JavaScript SDK 13.4.0 — Apache-2.0

Copyright Google LLC. https://github.com/firebase/firebase-js-sdk — loaded only when the optional Google sign-in is configured.

The MIT and Apache-2.0 license texts are included with each package in `node_modules` and are available at https://opensource.org/license/mit and https://www.apache.org/licenses/LICENSE-2.0.

## Data

### Lichess puzzle database — CC0 1.0

`public/puzzles-v2.json` is a selection from the [Lichess puzzle database](https://database.lichess.org/#puzzles), released into the public domain (CC0). Thanks to Lichess and its players.

## Loaded at runtime (not in this repository)

- **Heebo font** — SIL Open Font License 1.1, served by Google Fonts.
- **Chess.com published-data API** — the review screen reads a player's public games from https://api.chess.com in the browser; nothing from it is stored in this repository.
