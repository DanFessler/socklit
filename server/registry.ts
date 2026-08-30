import { ComponentError, type ComponentFactory } from "./component";

/**
 * A visible catalog of components that may appear as tags.
 *
 * Function calls never consult this table. `CardRow({ card })` works
 * with no catalog entry. `<CardRow .card=${card}>` looks the name up
 * here, so the string in the template can become the function in scope.
 * That is the whole reason this file exists — lit-html tags are not
 * identifiers.
 *
 * The key is the string passed to `component.tag("CardRow", fn)`, not a
 * name inferred from the function. Islands do not belong here.
 * They stay `<mount .Island=${…}>` or `mount()`, so a tag is never
 * ambiguous.
 */

const TAG = /^[A-Z][A-Za-z0-9]*$/;

const byName = new Map<string, ComponentFactory<object>>();

/** Called from `component.tag()`. Not an author API. */
export function bindTag(
  handle: ComponentFactory<object>,
  name: string,
): void {
  if (!TAG.test(name)) {
    throw new ComponentError(
      `component.tag() name "${name}" must be a PascalCase identifier`,
    );
  }

  const existing = byName.get(name);
  if (existing && existing !== handle) {
    throw new ComponentError(
      `<${name}> is already tagged to a different component`,
    );
  }
  byName.set(name, handle);
}

export function lookupComponent(
  name: string,
): ComponentFactory<object> | undefined {
  return byName.get(name);
}
