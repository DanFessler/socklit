# Journal

Not a changelog and not a bug list. Write as you go, in order.

## 1. After reading getting-started, before any app code

The manual is short and oddly confident. Components run next to the data. Clicks are addresses. The browser is a replica. I keep waiting for the chapter that explains the real API — the one with routes and a client store — and it does not come.

What I think the product is: a server that paints HTML and re-paints it when a shared JSON file changes. Identity is a cookie you mint yourself. An “island” is a React escape hatch for the one gesture that cannot wait for the wire.

Mood: skeptical-curious. This is either a real way to write a game lobby or a demo that will fall apart the moment two people sit down. I am about to find out which. I am not going to invent a client-side rules engine and “sync it later.” If the server cannot be the referee, the product is a lie and I want that in writing.

The island rule is the one that makes me nervous. The board has to be server markup. The piece in hand can be React. That split is either elegant or a mess of overlays. I am going to try the overlay: the squares are still `html`, and the island is only the hand.

I almost used `?user=` because it is right there in `session.params`. The manual says that is not a person. Fine. Directory of names, a form, `grant`. Two browsers or it does not count.

## 2. After replacing the starter, before sitting

The shared list died without ceremony. That felt correct. A hall is not a second surface on top of a todo app.

I split the board from the hand on purpose: squares are `html`, the island is an invisible grid on top so picking up a piece does not write the store. If that overlay is clumsy I will know the moment I click. I froze a mid-game stand instead of resetting — I want the abandoned position to sit there looking unfinished. The banner has to make that obvious or it is a bug.

The island callback does not, in the manual, receive `session`. I closed over the replica’s user and still refuse inside `mutate`. That is the first place I wanted a sentence the docs did not give me.

5173 and 8787 were occupied. I moved both ports. The manual was clear. I still muttered.

## 3. After sitting

I signed the book as Ada Vale. The socket dropped and came back — I landed in the hall again, not on the table I had been watching. `useState` died with the reconnect. I did not love that, but I understood it.

Then I sat dark at The Oak. The seat said my name. Stand appeared. Light stayed empty. “Seated at The Oak” showed up in the header without a refresh. That was the first moment it felt like a room and not a form.

I was alone at a table. Slightly ceremonial. Slightly lonely. The board was already painted, twelve and twelve, waiting. I did not move. I am not the referee.

## 4. After the other seat fills

Ben sat light. I did not refresh. The Oak badge flipped to live — dark to move — and his name appeared on the chair. A second tab I had already opened as Ada was still Ada, still seated. That is the cookie, not a query string. Two browsers, one person per browser. The manual was not bluffing.

The feeling was physical: someone sat down across from me. Not a “presence” API. A name on a seat and a turn. I would show this to a client.

## 5. After a spectator’s board moves

I picked up the man on 5,2. The gold ring appeared before anything came back from the server. The status line did not flicker. That is the island doing what the manual promised.

I put it on 4,3. Ben’s window said light to move. The guest watching The Oak said the same. I did not refresh either of them. The squares are server markup; they just arrived again. I felt a little smug. This is why you do not let the browser be the referee — the spectator never had a chance to disagree.

## 6. After an illegal move is refused

Light’s turn. I picked up my own man anyway and dropped it on a cream square. The gold ring vanished. The man did not move. The badge still said light to move. Nothing to undo. I tried a non-diagonal. Same nothing.

Ben clicked my piece. Same nothing. I had been afraid the island would “succeed” locally and then snap back — a lying highlight. It does not keep the ring. The destination is a hope. `mutate` is the law. That is the moment the product stopped feeling like a demo of templates.

## 7. After a capture

Ben stepped onto 3,4. I jumped him. Eleven cream pieces. The jumped square empty on my screen, on his, on the guest’s. No refresh. A little mean. A little perfect.

I would ship a club night on this. I would not yet ship a rated ladder — the book is a Map I had to write to disk myself, and signing in kills the tab’s `useState`. For a hall of tables, that is a scar, not a deal-breaker.

## 8. After putting dnd-kit on the hand

I almost dragged the whole board into React. The first dnd-kit example in my head is a sortable list that owns its items. That would have been a betrayal of the split. I stopped. The squares stay `html`. The island is still an invisible grid, plus a `DragOverlay` that is allowed to be a piece.

The overlay-versus-squares split got easier, not worse. HTML5 drag was a ghost that did not belong to anyone. dnd-kit’s overlay is a disc that follows the pointer and dies when I let go. The server man stays on its square until `mutate` says otherwise. I cover the source with felt so it looks lifted. That cover is a lie about paint, not about permission.

Drop does not hit a server square. It hits my overlay cell, which calls `onMove`. I almost treated that as a hole. It is the contract. The square is markup. The hand is the gesture.

Illegal drop: the disc vanished. No snap-back. No leftover ring. I exhaled. If it had animated home I would have written a rude paragraph.

It felt local. It felt like holding something. The rest of the page did not flinch. I would not go back to click-then-click as the main motion. Click is still there for a tap. The hand is the drag.

## 9. After giving dnd-kit the board

The reviewer was right. I had written a little sermon about squares staying `html` and then painted felt over the stale man so I would not have to see my own lie. That is not a split. That is a cover-up.

I put the whole board in the island. Drop lands on a cell that already owns the man. On let-go the overlay dies and the piece is already on the destination in local paint. I watched the turn line — it still said light to move, so the store had not spoken yet — and the source square was empty. No flash. No jump. I felt slightly embarrassed for the last version.

Illegal drop: the disc sat on a cream square like it had gotten away with it. Then `men` did not change, and the paint walked home. That snap-back is honest. The earlier “nothing happens” was the overlay dying onto a server man that had never left.

Does the model still click? Yes, with a bruise. Socklit owns the position. React owns the squares it is dragging across. I am closer to “a client tree driven by a store” than I wanted to admit in section 8. I did not write a rules engine. I did not write a move route. I would still tell another engineer the referee is `mutate`. I would no longer tell them the board is server markup. The hall is. The board is a replica of `men`. That is enough.
