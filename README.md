# Retro board

A team retrospective board in the Sparta Global style, hosted on GitHub Pages.

- **Six formats:** Went well / To improve / Actions, Start / Stop / Continue, Mad / Sad / Glad, the 4 Ls, Sailboat and Starfish. A board's format can be changed at any time. Cards from a column the new format doesn't have move to "Unsorted".
- **Cards:** anyone with the link can add cards, vote on them, and sort by votes. Leave your name blank to post anonymously.
- **Emotional seismograph:** optional per board. Everyone plots how they felt on each day of the sprint (−5 to +5) by clicking or dragging on the chart, or with the sliders. Each person gets their own line, and a dashed line shows the team average.

No build step: it's plain HTML, CSS and JavaScript modules.

## Make boards shared (Firebase, about 5 minutes)

Out of the box the board saves to **this browser only** (localStorage), so it works but nobody else sees your cards. To share boards between everyone, connect a free Firebase Firestore database:

1. Go to <https://console.firebase.google.com>, click **Add project**, and follow the steps (Google Analytics isn't needed).
2. In the project, open **Build → Firestore Database → Create database**. Pick a location near your team and start in **production mode**.
3. Open the **Rules** tab, paste in the contents of [`firestore.rules`](firestore.rules), and click **Publish**.
4. Go to **Project settings (⚙) → General → Your apps**, click the **Web** icon (`</>`), register an app (no hosting needed), and copy the `firebaseConfig` object it shows.
5. Paste it into [`js/config.js`](js/config.js) in place of `null`, then commit and push. GitHub Pages redeploys in a minute or two.

The Firebase web config isn't a secret: it identifies the project, and the Firestore rules decide what's allowed. The included rules let anyone with a board's link read and add to it, so don't put confidential information on a board.

## How it's put together

| File | What it does |
|---|---|
| `index.html` | Page shell, fonts, header |
| `styles.css` | Brand colours (charcoal `#2d2a2b`, pink `#d42a57`), Zilla Slab / Source Sans 3, light and dark mode |
| `js/app.js` | Boards, formats, cards, votes and the emotional seismograph |
| `js/store.js` | Storage layer: Firestore when configured, localStorage otherwise |
| `js/config.js` | Your Firebase config (or `null`) |
| `firestore.rules` | Database rules to paste into Firebase |

Data shape:

```
boards/{boardId}                 { name, theme, seismo, days, createdAt, createdBy }
boards/{boardId}/cards/{cardId}  { column, text, authorId, authorName, votes: [personId], createdAt }
boards/{boardId}/moods/{personId}{ name, values: [number|null per day], updatedAt }
```

There are no accounts. Each browser gets a random id (stored in localStorage) so you can delete your own cards and keep your own seismograph line. Whoever creates a board can delete it and any card on it from the same browser.

To add a format, add an entry to `THEMES` at the top of `js/app.js`.

### Test hooks

Interactive elements carry `data-testid`s (`create-board`, `card-input-<column>`, `add-card-<column>`, `vote-card-<id>`, `seismo-chart`, `mood-day-<n>` and so on).
