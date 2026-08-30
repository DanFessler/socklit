import { registerIsland } from "socklit/client";

import { PieceHand } from "./piece-hand.island";

registerIsland("PieceHand", PieceHand as never);

import "socklit/client/styles.css";
import "./lobby.css";
import "socklit/client";
