import { defineIsland } from "../server/island";

/**
 * Contract only. Chrome is React; the people list is `<slot>`, not a prop.
 */
export const AssigneePicker = defineIsland<{ label: string }>("AssigneePicker");
