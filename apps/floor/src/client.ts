import { registerIsland } from "socklit/client";
import { IncidentBoard } from "./incident-board.island";

registerIsland("IncidentBoard", IncidentBoard as never);

import "socklit/client/styles.css";
import "./floor.css";
import "socklit/client";
