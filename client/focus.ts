import { nothing, type ElementPart } from "lit-html";
import {
  Directive,
  directive,
  PartType,
  type PartInfo,
} from "lit-html/directive.js";

/**
 * Applies a server-declared focus transition to the element carrying the hole.
 *
 * This is a directive rather than a value because focus is an action, and the
 * only place in the pipeline that knows *which element* a hole belongs to is
 * the part that binds it. lit hands that over for element-position bindings and
 * nowhere else, which is why `focusWhen()` has to be written in element
 * position on the server.
 *
 * Directive instances live as long as their part, so the previous state is kept
 * here rather than in a map keyed by address: the part is the identity.
 */
class FocusDirective extends Directive {
  private wasActive = false;
  private lastNonce: number | undefined = undefined;
  private started = false;

  constructor(partInfo: PartInfo) {
    super(partInfo);
    if (partInfo.type !== PartType.ELEMENT) {
      throw new Error(
        "focusWhen() must be bound in element position, as in " +
          "html`<div ${focusWhen(open)}>`",
      );
    }
  }

  render(_active: boolean, _nonce?: number): typeof nothing {
    return nothing;
  }

  override update(
    part: ElementPart,
    [active, nonce]: [boolean, number | undefined],
  ): typeof nothing {
    // An element that arrives already asking for focus is a transition too:
    // a dialog is mounted and focused in the same frame, and there is no
    // earlier render in which it was inactive.
    const becameActive = active && (!this.started || !this.wasActive);
    const nonceMoved = active && this.started && nonce !== this.lastNonce;

    this.started = true;
    this.wasActive = active;
    this.lastNonce = nonce;

    if (becameActive || nonceMoved) {
      const element = part.element;
      if (element instanceof HTMLElement) {
        // After the current render commits, so focusing cannot race the DOM
        // that is still being written around it.
        queueMicrotask(() => {
          if (element.isConnected) element.focus();
        });
      }
    }

    return nothing;
  }
}

export const focusTarget = directive(FocusDirective);
