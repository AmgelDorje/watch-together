# Watch Together

Press play on your side, it plays on theirs.

## Pieces
- `server.js` - the room server. Run `node server.js` (no install needed).
- `extension/` - Chrome add-on. Syncs the video player on ANY site, each person on their own site and account.
- `public/index.html` - web page version for YouTube links, direct video links or local files (any browser, incl. iPhone and TV).

## Chrome add-on - install
1. Chrome -> `chrome://extensions` -> turn on "Developer mode" (top right).
2. "Load unpacked" -> pick the `extension` folder.
3. Pin it (puzzle icon -> pin).

## Use
1. Open the episode on your site. Click the add-on -> "Start a new room" -> send the code.
2. Partner opens the same episode on their site -> add-on -> types the code -> Join.
3. Play / pause / skip on either side - the other follows.
4. Sites with different intros: use -0.5s / +0.5s until it lines up.

The server address is under "Server" in the add-on (default https://watch-together-yzqa.onrender.com).
