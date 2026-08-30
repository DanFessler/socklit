import type { ClientMessage, ServerMessage } from "../shared/protocol";

const MAX_ENTRIES = 40;

type Direction = "in" | "out";

/**
 * A minimal traffic view, rendered with plain DOM so it cannot interfere with
 * the replicated tree.
 *
 * It exists to make the central claim of the prototype observable: template
 * layout crosses the wire once, and everything afterwards is hole values.
 */
export class ProtocolLog {
  private readonly list: HTMLElement;
  private readonly summary: HTMLElement;
  private templateBytes = 0;
  private patchBytes = 0;
  private templatesSent = 0;

  constructor(list: HTMLElement, summary: HTMLElement) {
    this.list = list;
    this.summary = summary;
    this.renderSummary();
  }

  record(
    direction: Direction,
    message: ServerMessage | ClientMessage,
    bytes: number,
  ): void {
    const templateCount = countTemplates(message);
    if (templateCount > 0) {
      this.templatesSent += templateCount;
      this.templateBytes += bytes;
    } else if (direction === "in") {
      this.patchBytes += bytes;
    }

    const entry = document.createElement("li");
    entry.dataset["direction"] = direction;

    const label = document.createElement("span");
    label.className = "protocol-label";
    label.textContent = `${direction === "in" ? "\u2193" : "\u2191"} ${describe(message)}`;

    const size = document.createElement("span");
    size.className = "protocol-size";
    size.textContent = bytes > 0 ? `${bytes} B` : "";

    entry.append(label, size);
    this.list.prepend(entry);

    while (this.list.childElementCount > MAX_ENTRIES) {
      this.list.lastElementChild?.remove();
    }

    this.renderSummary();
  }

  private renderSummary(): void {
    this.summary.textContent =
      `${this.templatesSent} template(s) / ${this.templateBytes} B layout` +
      ` \u00b7 ${this.patchBytes} B values`;
  }
}

function describe(message: ServerMessage | ClientMessage): string {
  switch (message.type) {
    case "templates":
      return `templates ${message.templates.map((template) => template.id).join(", ")}`;

    case "snapshot":
      return `snapshot r${message.revision}`;

    case "update": {
      const operations = message.operations
        .map((operation) => operation.op)
        .join(", ");
      const templates =
        message.templates.length > 0
          ? ` +${message.templates.length} template(s)`
          : "";
      return `update r${message.revision} [${operations || "none"}]${templates}`;
    }

    case "error":
      return `error ${message.code}`;

    case "event":
      return `event ${message.payload.kind} ${message.instanceId}#${message.hole}`;

    case "island":
      return `island ${message.event} ${message.instanceId}#${message.hole}`;
  }
}

function countTemplates(message: ServerMessage | ClientMessage): number {
  if (message.type === "templates" || message.type === "update") {
    return message.templates.length;
  }
  return 0;
}
